ALTER TABLE public.account_deletion_jobs
  ADD COLUMN IF NOT EXISTS rolled_back_at timestamptz,
  ADD COLUMN IF NOT EXISTS sign_in_restored_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS restoration_reason text,
  ADD COLUMN IF NOT EXISTS requeue_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_requeued_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts_before_requeue integer,
  ADD COLUMN IF NOT EXISTS error_before_requeue text;

CREATE OR REPLACE FUNCTION public.recover_stale_account_deletion(_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE j record;
BEGIN
  SELECT * INTO j FROM public.account_deletion_jobs WHERE user_id = _user_id FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN 'busy_or_missing'; END IF;
  IF j.status <> 'pending' THEN RETURN 'not_pending'; END IF;
  IF j.lease_expires_at IS NOT NULL AND j.lease_expires_at > now() THEN RETURN 'lease_active'; END IF;
  UPDATE public.account_deletion_jobs
     SET status = 'rolled_back', sign_in_restored = false, lease_expires_at = NULL,
         last_error = 'recovered abandoned attempt', rolled_back_at = now(),
         sign_in_restored_at = NULL, restoration_reason = NULL
   WHERE user_id = _user_id;
  RETURN 'rolled_back';
END; $function$;