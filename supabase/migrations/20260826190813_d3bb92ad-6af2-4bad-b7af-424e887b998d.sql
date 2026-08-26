ALTER TABLE public.email_schedule_recipients
  ADD COLUMN weekdays text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.email_schedule_recipients
  ADD CONSTRAINT email_schedule_recipients_weekdays_valid
  CHECK (weekdays <@ ARRAY['MO','TU','WE','TH','FR','SA','SU']::text[]);

COMMENT ON COLUMN public.email_schedule_recipients.weekdays IS 'Weekday codes this recipient receives; empty array = all days.';