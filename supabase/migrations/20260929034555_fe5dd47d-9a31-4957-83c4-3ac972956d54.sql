
revoke execute on function public.assert_babysitter_profile_valid() from public, anon, authenticated;
revoke execute on function public.assert_babysitter_calendar_valid() from public, anon, authenticated;
revoke execute on function public.assert_babysitter_shift_valid() from public, anon, authenticated;
revoke execute on function public.drop_babysitter_profile_on_role_change() from public, anon, authenticated;
revoke execute on function public.babysitter_membership(uuid) from public, anon;
revoke execute on function public.is_babysitter(uuid) from public, anon;
revoke execute on function public.can_read_calendar_source(uuid, uuid) from public, anon;
revoke execute on function public.can_read_event(uuid, uuid, uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.babysitter_membership(uuid) to authenticated;
grant execute on function public.is_babysitter(uuid) to authenticated;
grant execute on function public.can_read_calendar_source(uuid, uuid) to authenticated;
grant execute on function public.can_read_event(uuid, uuid, uuid, timestamptz, timestamptz, text) to authenticated;
