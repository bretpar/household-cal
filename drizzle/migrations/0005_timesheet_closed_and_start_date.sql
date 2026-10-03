ALTER TABLE public.timesheets DROP CONSTRAINT timesheets_status_check;
ALTER TABLE public.timesheets ADD CONSTRAINT timesheets_status_check CHECK (status = ANY (ARRAY['draft','submitted','needs_correction','approved','closed']));
ALTER TABLE public.timesheets ADD COLUMN IF NOT EXISTS closed_at timestamptz, ADD COLUMN IF NOT EXISTS closed_by uuid;
ALTER TABLE public.family_members ADD COLUMN IF NOT EXISTS timesheet_start_date date;
COMMENT ON COLUMN public.family_members.timesheet_start_date IS 'Earliest date Timesheets apply for this caregiver; NULL = no limit (existing history kept).';