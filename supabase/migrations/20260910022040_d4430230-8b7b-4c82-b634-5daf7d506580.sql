CREATE OR REPLACE FUNCTION public.enqueue_google_manual_sync(
  _callback_url text,
  _family_id uuid,
  _attempt_id uuid,
  _initial boolean DEFAULT false
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, net
AS $$
DECLARE
  _token text;
  _request_id bigint;
BEGIN
  IF _callback_url IS NULL OR _callback_url !~ '^https://[^/]+/api/public/google-calendar/manual-sync$' THEN
    RAISE EXCEPTION 'Invalid manual sync callback URL';
  END IF;

  SELECT token INTO _token
  FROM public.scheduler_credentials
  WHERE name = 'scheduler';

  IF _token IS NULL OR length(_token) = 0 THEN
    RAISE EXCEPTION 'Scheduler credential is not configured';
  END IF;

  SELECT net.http_post(
    url := _callback_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || _token
    ),
    body := jsonb_build_object(
      'family_id', _family_id,
      'attempt_id', _attempt_id,
      'initial', coalesce(_initial, false)
    ),
    timeout_milliseconds := 300000
  ) INTO _request_id;

  RETURN _request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_google_manual_sync(text, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_google_manual_sync(text, uuid, uuid, boolean) TO service_role;