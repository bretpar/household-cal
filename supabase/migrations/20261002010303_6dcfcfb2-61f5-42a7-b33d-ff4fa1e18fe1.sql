ALTER TABLE public.timesheet_entries
  ADD COLUMN IF NOT EXISTS owner_edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_edited_by uuid,
  ADD COLUMN IF NOT EXISTS caregiver_actual_start timestamptz,
  ADD COLUMN IF NOT EXISTS caregiver_actual_end timestamptz,
  ADD COLUMN IF NOT EXISTS caregiver_note text;
ALTER TABLE public.timesheets
  ADD COLUMN IF NOT EXISTS submitted_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS owner_edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS owner_edited_by uuid;