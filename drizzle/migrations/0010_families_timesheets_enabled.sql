ALTER TABLE public.families ADD COLUMN IF NOT EXISTS timesheets_enabled boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.families.timesheets_enabled IS 'Household master switch for Timesheets. Off stops new tracking; history stays readable.';
UPDATE public.families f SET timesheets_enabled = true
WHERE EXISTS (SELECT 1 FROM public.timesheets t WHERE t.family_id = f.id)
   OR EXISTS (SELECT 1 FROM public.timesheet_settings s WHERE s.family_id = f.id)
   OR EXISTS (SELECT 1 FROM public.family_members m WHERE m.family_id = f.id AND m.role = 'caregiver' AND m.timesheets_enabled = true AND m.removed_at IS NULL AND m.timesheet_start_date IS NOT NULL);