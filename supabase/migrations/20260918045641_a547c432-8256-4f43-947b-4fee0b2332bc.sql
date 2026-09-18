ALTER TABLE public.calendar_sources
  ADD COLUMN IF NOT EXISTS google_channel_last_notified_at timestamp with time zone;