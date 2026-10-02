CREATE OR REPLACE FUNCTION public.remove_caregiver_app_access(_member_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _family uuid;
  _role member_role;
  _removed integer;
BEGIN
  SELECT family_id, role INTO _family, _role FROM family_members WHERE id = _member_id AND removed_at IS NULL;
  IF _family IS NULL THEN RAISE EXCEPTION 'Caregiver not found'; END IF;
  IF _role <> 'caregiver' THEN RAISE EXCEPTION 'This person isn''t a caregiver'; END IF;
  IF NOT public.is_family_owner(_family) THEN RAISE EXCEPTION 'Only household owners can remove app access'; END IF;

  -- Keep shift history: detach from the login, keep the person.
  UPDATE babysitter_shifts s
     SET family_user_id = NULL,
         assignee_member_id = COALESCE(s.assignee_member_id, _member_id)
   WHERE s.family_user_id IN (
     SELECT id FROM family_users WHERE family_id = _family AND family_member_id = _member_id AND role = 'viewer');

  UPDATE families SET default_babysitter_family_user_id = NULL,
         default_babysitter_member_id = COALESCE(default_babysitter_member_id, _member_id)
   WHERE id = _family AND default_babysitter_family_user_id IN (
     SELECT id FROM family_users WHERE family_id = _family AND family_member_id = _member_id AND role = 'viewer');

  DELETE FROM family_users WHERE family_id = _family AND family_member_id = _member_id AND role = 'viewer';
  GET DIAGNOSTICS _removed = ROW_COUNT;
  IF _removed = 0 THEN RAISE EXCEPTION 'This caregiver has no app access to remove'; END IF;
  RETURN _removed;
END;
$$;
REVOKE ALL ON FUNCTION public.remove_caregiver_app_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_caregiver_app_access(uuid) TO authenticated;