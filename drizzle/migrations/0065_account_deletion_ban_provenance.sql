ALTER TABLE public.account_deletion_jobs
  ADD COLUMN IF NOT EXISTS ban_provenance text,
  ADD COLUMN IF NOT EXISTS deletion_ban_applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS prior_banned_until timestamptz;
ALTER TABLE public.account_deletion_jobs DROP CONSTRAINT IF EXISTS account_deletion_jobs_ban_provenance_check;
ALTER TABLE public.account_deletion_jobs ADD CONSTRAINT account_deletion_jobs_ban_provenance_check
  CHECK (ban_provenance IS NULL OR ban_provenance IN ('deletion','preexisting','superseded'));