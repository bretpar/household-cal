CREATE TABLE public.babysitter_coverage_settings (
  family_id uuid PRIMARY KEY REFERENCES public.families(id) ON DELETE CASCADE,
  parent_one_label text NOT NULL DEFAULT 'Dad' CHECK (length(trim(parent_one_label)) BETWEEN 1 AND 40),
  parent_one_source_id uuid REFERENCES public.calendar_sources(id) ON DELETE SET NULL,
  parent_two_label text NOT NULL DEFAULT 'Mom' CHECK (length(trim(parent_two_label)) BETWEEN 1 AND 40),
  parent_two_source_id uuid REFERENCES public.calendar_sources(id) ON DELETE SET NULL,
  buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_before_minutes BETWEEN 0 AND 240),
  buffer_after_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_after_minutes BETWEEN 0 AND 240),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.babysitter_coverage_settings TO authenticated;
GRANT ALL ON public.babysitter_coverage_settings TO service_role;
ALTER TABLE public.babysitter_coverage_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read coverage settings" ON public.babysitter_coverage_settings FOR SELECT TO authenticated USING (public.is_family_owner(family_id));
CREATE POLICY "Owners create coverage settings" ON public.babysitter_coverage_settings FOR INSERT TO authenticated WITH CHECK (public.is_family_owner(family_id));
CREATE POLICY "Owners edit coverage settings" ON public.babysitter_coverage_settings FOR UPDATE TO authenticated USING (public.is_family_owner(family_id)) WITH CHECK (public.is_family_owner(family_id));