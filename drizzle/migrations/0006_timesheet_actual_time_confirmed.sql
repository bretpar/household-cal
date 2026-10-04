ALTER TABLE public.timesheet_entries ADD COLUMN actual_time_confirmed boolean NOT NULL DEFAULT false;
-- Existing rows: intent is unknowable, so fail safe and never overwrite their Actual time.
UPDATE public.timesheet_entries SET actual_time_confirmed = true;
COMMENT ON COLUMN public.timesheet_entries.actual_time_confirmed IS 'True once Actual time was explicitly saved (caregiver or owner). False = still the automatic copy of Scheduled, which follows calendar changes while the timesheet is editable.';