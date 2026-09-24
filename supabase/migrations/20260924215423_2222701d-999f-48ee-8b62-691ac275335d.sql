ALTER TABLE public.account_deletion_jobs DROP CONSTRAINT IF EXISTS account_deletion_jobs_status_check;
ALTER TABLE public.account_deletion_jobs ADD CONSTRAINT account_deletion_jobs_status_check
  CHECK (status IN ('pending','data_removed','completed','failed','rolled_back'));
UPDATE public.account_deletion_jobs SET status = 'rolled_back' WHERE status = 'failed';

-- True while an account is being (or has been partly) deleted.
CREATE OR REPLACE FUNCTION public.account_deletion_blocked(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.account_deletion_jobs
     WHERE user_id = _user_id AND status IN ('pending','data_removed','failed'));
$$;
REVOKE ALL ON FUNCTION public.account_deletion_blocked(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_blocked(uuid) TO service_role;

-- Database-level guard so an already-issued token cannot recreate data directly.
CREATE OR REPLACE FUNCTION public.reject_writes_during_account_deletion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND public.account_deletion_blocked(auth.uid()) THEN
    RAISE EXCEPTION 'this account is being deleted';
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.reject_writes_during_account_deletion() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER families_reject_deleting_account BEFORE INSERT ON public.families
  FOR EACH ROW EXECUTE FUNCTION public.reject_writes_during_account_deletion();
CREATE TRIGGER family_users_reject_deleting_account BEFORE INSERT OR UPDATE ON public.family_users
  FOR EACH ROW EXECUTE FUNCTION public.reject_writes_during_account_deletion();
CREATE TRIGGER profiles_reject_deleting_account BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.reject_writes_during_account_deletion();
CREATE TRIGGER user_preferences_reject_deleting_account BEFORE INSERT OR UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION public.reject_writes_during_account_deletion();

-- Validate-everything-first, then mutate.
CREATE OR REPLACE FUNCTION public.delete_account_data(
  _user_id uuid, _email text, _transfers jsonb, _delete_households uuid[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  m record;
  other_owners int;
  other_members int;
  target uuid;
  em text := nullif(lower(trim(coalesce(_email, ''))), '');
  actions jsonb := '[]'::jsonb;
  a jsonb;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_user');
  END IF;

  -- Pass 0: lock every affected household and all their memberships.
  PERFORM 1 FROM public.families f
   WHERE f.id IN (SELECT family_id FROM public.family_users WHERE user_id = _user_id)
   ORDER BY f.id FOR UPDATE;
  PERFORM 1 FROM public.family_users
   WHERE family_id IN (SELECT family_id FROM public.family_users WHERE user_id = _user_id)
   ORDER BY id FOR UPDATE;

  -- Pass 1: validate all households; no mutations.
  FOR m IN SELECT family_id, role FROM public.family_users WHERE user_id = _user_id ORDER BY family_id LOOP
    SELECT count(*) FILTER (WHERE role = 'owner'), count(*) INTO other_owners, other_members
      FROM public.family_users WHERE family_id = m.family_id AND user_id <> _user_id;

    IF m.role <> 'owner' OR other_owners > 0 THEN
      actions := actions || jsonb_build_object('family_id', m.family_id, 'kind', 'leave');
    ELSIF other_members = 0 THEN
      IF NOT (m.family_id = ANY(coalesce(_delete_households, '{}'))) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'needs_delete_confirmation', 'family_id', m.family_id);
      END IF;
      actions := actions || jsonb_build_object('family_id', m.family_id, 'kind', 'delete');
    ELSE
      BEGIN
        target := nullif(_transfers ->> m.family_id::text, '')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN target := NULL;
      END;
      IF target IS NULL OR target = _user_id OR NOT EXISTS (
        SELECT 1 FROM public.family_users WHERE family_id = m.family_id AND user_id = target
      ) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'needs_transfer', 'family_id', m.family_id);
      END IF;
      actions := actions || jsonb_build_object('family_id', m.family_id, 'kind', 'transfer', 'to', target);
    END IF;
  END LOOP;

  -- Pass 2: apply.
  FOR a IN SELECT * FROM jsonb_array_elements(actions) LOOP
    IF a->>'kind' = 'delete' THEN
      DELETE FROM public.families WHERE id = (a->>'family_id')::uuid;
    ELSE
      IF a->>'kind' = 'transfer' THEN
        UPDATE public.family_users SET role = 'owner'
         WHERE family_id = (a->>'family_id')::uuid AND user_id = (a->>'to')::uuid;
      END IF;
      DELETE FROM public.family_users WHERE family_id = (a->>'family_id')::uuid AND user_id = _user_id;
    END IF;
  END LOOP;

  UPDATE public.email_schedules SET created_by = NULL WHERE created_by = _user_id;
  UPDATE public.events SET created_by = NULL WHERE created_by = _user_id;
  UPDATE public.families SET created_by = NULL WHERE created_by = _user_id;
  UPDATE public.google_connections SET connected_by = NULL WHERE connected_by = _user_id;
  UPDATE public.family_invitations SET invited_by = NULL WHERE invited_by = _user_id;
  DELETE FROM public.family_invitations WHERE accepted_by = _user_id OR (em IS NOT NULL AND lower(email) = em);
  DELETE FROM public.email_schedule_recipients WHERE user_id = _user_id OR (em IS NOT NULL AND lower(email) = em);
  DELETE FROM public.native_auth_handoffs WHERE user_id = _user_id;
  DELETE FROM public.user_preferences WHERE user_id = _user_id;
  DELETE FROM public.profiles WHERE id = _user_id;

  UPDATE public.account_deletion_jobs SET status = 'data_removed'
   WHERE user_id = _user_id AND status IN ('pending','data_removed','failed');
  RETURN jsonb_build_object('ok', true);
END; $$;
REVOKE ALL ON FUNCTION public.delete_account_data(uuid, text, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_account_data(uuid, text, jsonb, uuid[]) TO service_role;