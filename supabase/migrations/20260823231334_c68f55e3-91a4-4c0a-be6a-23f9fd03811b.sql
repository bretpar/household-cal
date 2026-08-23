revoke all on function public.update_updated_at_column() from anon, authenticated, public;
revoke all on function public.assert_event_member_same_family() from anon, authenticated, public;
revoke all on function public.assert_activity_member_same_family() from anon, authenticated, public;
revoke all on function public.family_role_of(uuid) from anon, authenticated, public;

revoke all on function public.has_family_access(uuid) from anon, public;
revoke all on function public.can_edit_family(uuid) from anon, public;
revoke all on function public.is_family_owner(uuid) from anon, public;
grant execute on function public.has_family_access(uuid) to authenticated;
grant execute on function public.can_edit_family(uuid) to authenticated;
grant execute on function public.is_family_owner(uuid) to authenticated;
