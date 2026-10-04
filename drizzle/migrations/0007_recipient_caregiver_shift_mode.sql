ALTER TABLE public.email_schedule_recipients
  ADD COLUMN content_mode text NOT NULL DEFAULT 'calendars'
    CHECK (content_mode IN ('calendars','caregiver_shifts')),
  ADD COLUMN include_related_on_shift_days boolean NOT NULL DEFAULT false;