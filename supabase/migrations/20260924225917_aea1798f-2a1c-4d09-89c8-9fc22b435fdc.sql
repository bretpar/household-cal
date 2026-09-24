ALTER TABLE public.account_deletion_jobs
  ADD COLUMN IF NOT EXISTS attempt_id uuid,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS sign_in_restored boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.reject_writes_during_account_deletion()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND public.account_deletion_blocked(auth.uid()) THEN
    RAISE EXCEPTION 'this account is being deleted';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $function$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['events','event_members','activities','activity_members','calendar_sources',
    'family_members','event_categories','family_invitations','email_schedules','email_schedule_recipients',
    'email_schedule_recipient_calendars','google_connections'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_reject_deleting_account', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.reject_writes_during_account_deletion()', t || '_reject_deleting_account', t);
  END LOOP;
END $$;

-- Recovery: only a pending job whose lease has expired AND whose row is not
-- locked by a running delete_account_data transaction is rolled back. Because
-- delete_account_data sets data_removed in the same transaction as all data
-- changes, an unlocked "pending" row proves nothing was committed.
CREATE OR REPLACE FUNCTION public.recover_stale_account_deletion(_user_id uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE j record;
BEGIN
  SELECT * INTO j FROM public.account_deletion_jobs WHERE user_id = _user_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN 'busy_or_missing'; END IF;
  IF j.status <> 'pending' THEN RETURN 'not_pending'; END IF;
  IF j.lease_expires_at IS NOT NULL AND j.lease_expires_at > now() THEN RETURN 'lease_active'; END IF;
  UPDATE public.account_deletion_jobs
     SET status = 'rolled_back', sign_in_restored = false, attempt_id = NULL, lease_expires_at = NULL,
         last_error = 'recovered abandoned attempt'
   WHERE user_id = _user_id;
  RETURN 'rolled_back';
END; $function$;
REVOKE ALL ON FUNCTION public.recover_stale_account_deletion(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stale_account_deletion(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_account_data(_user_id uuid, _email text, _transfers jsonb, _delete_households uuid[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  m record;
  other_owners int;
  other_members int;
  target uuid;
  em text := nullif(lower(trim(coalesce(_email, ''))), '');
  actions jsonb := '[]'::jsonb;
  a jsonb;
  job_status text;
BEGIN
  IF _user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_user');
  END IF;

  -- Lock the job row first: blocks concurrent recovery for the whole transaction,
  -- and refuses to run if recovery already rolled this attempt back.
  SELECT status INTO job_status FROM public.account_deletion_jobs WHERE user_id = _user_id FOR UPDATE;
  IF job_status IS NULL OR job_status NOT IN ('pending','data_removed','failed') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_active_job');
  END IF;

  PERFORM 1 FROM public.families f
   WHERE f.id IN (SELECT family_id FROM public.family_users WHERE user_id = _user_id)
   ORDER BY f.id FOR UPDATE;
  PERFORM 1 FROM public.family_users
   WHERE family_id IN (SELECT family_id FROM public.family_users WHERE user_id = _user_id)
   ORDER BY id FOR UPDATE;

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

  UPDATE public.account_deletion_jobs SET status = 'data_removed', lease_expires_at = NULL
   WHERE user_id = _user_id AND status IN ('pending','data_removed','failed');
  RETURN jsonb_build_object('ok', true);
END; $function$;
REVOKE ALL ON FUNCTION public.delete_account_data(uuid, text, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_account_data(uuid, text, jsonb, uuid[]) TO service_role;