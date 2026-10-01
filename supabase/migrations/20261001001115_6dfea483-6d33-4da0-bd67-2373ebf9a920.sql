CREATE TABLE public.timesheet_settings (
  family_id uuid PRIMARY KEY REFERENCES public.families(id) ON DELETE CASCADE,
  frequency text NOT NULL DEFAULT 'biweekly' CHECK (frequency IN ('weekly','biweekly','semimonthly','monthly')),
  anchor_date date NOT NULL DEFAULT DATE '2026-01-04',
  semimonthly_first_end smallint NOT NULL DEFAULT 15 CHECK (semimonthly_first_end BETWEEN 1 AND 27),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.timesheet_settings TO authenticated;
GRANT ALL ON public.timesheet_settings TO service_role;
ALTER TABLE public.timesheet_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Household members read pay period" ON public.timesheet_settings
  FOR SELECT TO authenticated USING (public.has_family_access(family_id));
CREATE TRIGGER update_timesheet_settings_updated_at BEFORE UPDATE ON public.timesheet_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.timesheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  family_member_id uuid NOT NULL REFERENCES public.family_members(id) ON DELETE CASCADE,
  caregiver_name text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','needs_correction','approved')),
  parent_note text,
  snapshot jsonb,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_member_id, period_start)
);
GRANT SELECT ON public.timesheets TO authenticated;
GRANT ALL ON public.timesheets TO service_role;
ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.my_caregiver_member_id(_family_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT fu.family_member_id FROM public.family_users fu
  JOIN public.babysitter_access_profiles p ON p.family_user_id = fu.id
  WHERE fu.family_id = _family_id AND fu.user_id = auth.uid() AND fu.family_member_id IS NOT NULL
  LIMIT 1
$$;

CREATE POLICY "Owners and own caregiver read timesheets" ON public.timesheets
  FOR SELECT TO authenticated USING (
    public.is_family_owner(family_id)
    OR family_member_id = public.my_caregiver_member_id(family_id)
  );
CREATE TRIGGER update_timesheets_updated_at BEFORE UPDATE ON public.timesheets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.timesheet_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id uuid NOT NULL REFERENCES public.timesheets(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  occurrence_key text,
  work_date date NOT NULL,
  scheduled_title text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  actual_start timestamptz NOT NULL,
  actual_end timestamptz NOT NULL,
  is_manual boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actual_end > actual_start),
  UNIQUE (timesheet_id, occurrence_key)
);
CREATE INDEX timesheet_entries_timesheet_idx ON public.timesheet_entries(timesheet_id);
GRANT SELECT ON public.timesheet_entries TO authenticated;
GRANT ALL ON public.timesheet_entries TO service_role;
ALTER TABLE public.timesheet_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners and own caregiver read entries" ON public.timesheet_entries
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.timesheets t WHERE t.id = timesheet_id AND (
      public.is_family_owner(t.family_id)
      OR t.family_member_id = public.my_caregiver_member_id(t.family_id)))
  );
CREATE TRIGGER update_timesheet_entries_updated_at BEFORE UPDATE ON public.timesheet_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();