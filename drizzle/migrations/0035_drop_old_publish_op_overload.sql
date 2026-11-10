-- The 8-argument overload from migration 0033 remains executable by
-- authenticated callers; remove it so only the hardened 9-argument,
-- service-role-only function exists.
DROP FUNCTION IF EXISTS public.apply_schedule_publish_op(uuid, uuid, integer, uuid, jsonb, jsonb, uuid, text);