ALTER TABLE public.timesheet_entries ADD COLUMN paid_hours numeric(6,2), ADD COLUMN paid_note text;
ALTER TABLE public.timesheet_entries ADD CONSTRAINT timesheet_entries_paid_hours_nonneg CHECK (paid_hours IS NULL OR paid_hours >= 0);
ALTER TABLE public.timesheet_entries ADD CONSTRAINT timesheet_entries_paid_note_len CHECK (paid_note IS NULL OR char_length(paid_note) <= 300);