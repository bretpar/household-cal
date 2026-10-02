CREATE OR REPLACE FUNCTION public.set_caregiver_access(
  _membership_id uuid,
  _family_member_id uuid,
  _date_scope public.babysitter_date_scope,
  _calendar_ids uuid[]
) RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _fu record;
BEGIN
  SELECT id, family_id, role, family_member_id INTO _fu
  FROM public.family_users WHERE id = _membership_id;
  IF _fu.id IS NULL THEN RAISE EXCEPTION 'Household user not found'; END IF;
  IF NOT public.is_family_owner(_fu.family_id) THEN RAISE EXCEPTION 'Only household owners can do that'; END IF;
  IF _fu.role <> 'viewer' THEN RAISE EXCEPTION 'Only viewers can be babysitters'; END IF;
  IF _family_member_id IS NULL THEN RAISE EXCEPTION 'Choose which family member this babysitter is'; END IF;

  IF _family_member_id IS DISTINCT FROM _fu.family_member_id THEN
    UPDATE public.family_users SET family_member_id = _family_member_id WHERE id = _fu.id;
  END IF;

  INSERT INTO public.babysitter_access_profiles (family_user_id, family_id, date_scope)
  VALUES (_fu.id, _fu.family_id, _date_scope)
  ON CONFLICT (family_user_id) DO UPDATE SET date_scope = EXCLUDED.date_scope;

  DELETE FROM public.babysitter_access_calendars WHERE family_user_id = _fu.id;
  IF coalesce(array_length(_calendar_ids, 1), 0) > 0 THEN
    INSERT INTO public.babysitter_access_calendars (family_user_id, calendar_source_id)
    SELECT _fu.id, unnest(_calendar_ids);
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.set_caregiver_access(uuid, uuid, public.babysitter_date_scope, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_caregiver_access(uuid, uuid, public.babysitter_date_scope, uuid[]) TO authenticated;