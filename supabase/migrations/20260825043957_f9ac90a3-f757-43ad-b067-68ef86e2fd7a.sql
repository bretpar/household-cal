ALTER TABLE public.calendar_sources
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS sync_failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sync_paused_at timestamptz;

ALTER TABLE public.calendar_sources
  DROP CONSTRAINT IF EXISTS calendar_sources_sync_status_check;
ALTER TABLE public.calendar_sources
  ADD CONSTRAINT calendar_sources_sync_status_check
  CHECK (sync_status IN ('active','needs_attention'));