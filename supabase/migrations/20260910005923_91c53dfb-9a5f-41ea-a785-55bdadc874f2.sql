ALTER TABLE public.google_connections
  ADD COLUMN IF NOT EXISTS manual_sync_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS manual_sync_attempt_id uuid,
  ADD COLUMN IF NOT EXISTS manual_sync_error text;

CREATE OR REPLACE FUNCTION public.try_start_google_manual_sync(
  _family_id uuid,
  _stale_before timestamptz
)
RETURNS TABLE (accepted boolean, attempt_id uuid)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _attempt_id uuid := gen_random_uuid();
BEGIN
  UPDATE public.google_connections
  SET manual_sync_started_at = now(),
      manual_sync_attempt_id = _attempt_id,
      manual_sync_error = NULL,
      updated_at = now()
  WHERE family_id = _family_id
    AND status = 'connected'
    AND (
      manual_sync_started_at IS NULL
      OR manual_sync_started_at < _stale_before
    );

  IF FOUND THEN
    RETURN QUERY SELECT true, _attempt_id;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT false, gc.manual_sync_attempt_id
  FROM public.google_connections AS gc
  WHERE gc.family_id = _family_id;
END;
$$;

REVOKE ALL ON FUNCTION public.try_start_google_manual_sync(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_start_google_manual_sync(uuid, timestamptz) TO service_role;