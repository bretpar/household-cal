REVOKE EXECUTE ON FUNCTION public.protect_last_owner() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assert_event_member_same_family() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assert_activity_member_same_family() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;