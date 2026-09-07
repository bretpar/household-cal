ALTER TABLE public.event_sync_links
  ADD COLUMN IF NOT EXISTS google_original_start text;

CREATE INDEX IF NOT EXISTS event_sync_links_occurrence_idx
  ON public.event_sync_links (family_id, calendar_source_id, google_recurring_event_id, google_original_start);