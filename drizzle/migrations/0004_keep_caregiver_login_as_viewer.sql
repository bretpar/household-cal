CREATE OR REPLACE FUNCTION public.keep_caregiver_login_as_viewer(_member_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _family uuid;
  _role member_role;
  _ids uuid[];
  _n integer;
BEGIN
  SELECT family_id, role INTO _family, _role FROM family_members WHERE id = _member_id AND removed_at IS NULL;
  IF _family IS NULL THEN RAISE EXCEPTION 'Caregiver not found'; END IF;
  IF _role <> 'caregiver' THEN RAISE EXCEPTION 'This person isn''t a caregiver'; END IF;
  IF NOT public.is_family_owner(_family) THEN RAISE EXCEPTION 'Only household owners can change app access'; END IF;

  SELECT array_agg(id) INTO _ids FROM family_users
   WHERE family_id = _family AND family_member_id = _member_id AND role = 'viewer';
  IF _ids IS NULL THEN RAISE EXCEPTION 'This caregiver has no linked login'; END IF;

  -- Keep shift history on the person; detach only the login link.
  UPDATE babysitter_shifts s
     SET family_user_id = NULL,
         assignee_member_id = COALESCE(s.assignee_member_id, _member_id)
   WHERE s.family_user_id = ANY(_ids);

  UPDATE families SET default_babysitter_family_user_id = NULL,
         default_babysitter_member_id = COALESCE(default_babysitter_member_id, _member_id)
   WHERE id = _family AND default_babysitter_family_user_id = ANY(_ids);

  DELETE FROM babysitter_access_calendars WHERE family_user_id = ANY(_ids);
  DELETE FROM babysitter_access_profiles WHERE family_user_id = ANY(_ids);

  UPDATE family_users SET family_member_id = NULL WHERE id = ANY(_ids);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.keep_caregiver_login_as_viewer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.keep_caregiver_login_as_viewer(uuid) TO authenticated;