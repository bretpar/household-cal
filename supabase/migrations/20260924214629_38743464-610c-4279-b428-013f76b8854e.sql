CREATE TABLE public.account_deletion_jobs (
  user_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','data_removed','completed','failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  google_revoke_failures integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.account_deletion_jobs TO service_role;
ALTER TABLE public.account_deletion_jobs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER account_deletion_jobs_updated_at BEFORE UPDATE ON public.account_deletion_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Atomic, locked, re-validated removal of all database data for one account.
-- Returns {ok:true} or {ok:false, reason, family_id}. Idempotent: a second call
-- after success finds no memberships and only re-runs harmless cleanup.
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
BEGIN
  -- Lock every household this user belongs to, in a stable order.
  PERFORM 1 FROM public.families f
   WHERE f.id IN (SELECT family_id FROM public.family_users WHERE user_id = _user_id)
   ORDER BY f.id FOR UPDATE;

  FOR m IN SELECT family_id, role FROM public.family_users WHERE user_id = _user_id ORDER BY family_id LOOP
    PERFORM 1 FROM public.family_users WHERE family_id = m.family_id FOR UPDATE;
    SELECT count(*) FILTER (WHERE role = 'owner'), count(*) INTO other_owners, other_members
      FROM public.family_users WHERE family_id = m.family_id AND user_id <> _user_id;

    IF m.role <> 'owner' OR other_owners > 0 THEN
      DELETE FROM public.family_users WHERE family_id = m.family_id AND user_id = _user_id;
    ELSIF other_members = 0 THEN
      IF NOT (m.family_id = ANY(coalesce(_delete_households, '{}'))) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'needs_delete_confirmation', 'family_id', m.family_id);
      END IF;
      DELETE FROM public.families WHERE id = m.family_id;
    ELSE
      target := nullif(_transfers ->> m.family_id::text, '')::uuid;
      IF target IS NULL OR target = _user_id OR NOT EXISTS (
        SELECT 1 FROM public.family_users WHERE family_id = m.family_id AND user_id = target
      ) THEN
        -- Also covers: a member joined after the user confirmed deleting the household.
        RETURN jsonb_build_object('ok', false, 'reason', 'needs_transfer', 'family_id', m.family_id);
      END IF;
      UPDATE public.family_users SET role = 'owner' WHERE family_id = m.family_id AND user_id = target;
      DELETE FROM public.family_users WHERE family_id = m.family_id AND user_id = _user_id;
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

  UPDATE public.account_deletion_jobs SET status = 'data_removed' WHERE user_id = _user_id;
  RETURN jsonb_build_object('ok', true);
END; $$;

REVOKE ALL ON FUNCTION public.delete_account_data(uuid, text, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_account_data(uuid, text, jsonb, uuid[]) TO service_role;