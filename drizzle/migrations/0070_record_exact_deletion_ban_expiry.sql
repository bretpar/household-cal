ALTER TABLE public.account_deletion_jobs
  ADD COLUMN IF NOT EXISTS deletion_ban_expires_at timestamptz;

COMMENT ON COLUMN public.account_deletion_jobs.deletion_ban_expires_at IS
  'Exact Auth banned_until returned for this deletion attempt; recovery lifts only an exact match.';