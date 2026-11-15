ALTER TABLE public.caregiver_work_shifts ADD CONSTRAINT caregiver_work_shifts_id_user_key UNIQUE (id, user_id);
CREATE TABLE public.caregiver_shift_actuals (
 shift_id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES public.caregiver_workspaces(user_id) ON DELETE CASCADE,
 actual_start timestamptz NOT NULL, actual_end timestamptz NOT NULL,
 confirmed boolean NOT NULL DEFAULT true, note text CHECK (note IS NULL OR length(note) <= 2000),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (shift_id, user_id) REFERENCES public.caregiver_work_shifts(id, user_id) ON DELETE CASCADE,
 CHECK (actual_end > actual_start), CHECK (actual_end - actual_start <= interval '48 hours')
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.caregiver_shift_actuals TO authenticated;
GRANT ALL ON public.caregiver_shift_actuals TO service_role;
ALTER TABLE public.caregiver_shift_actuals ENABLE ROW LEVEL SECURITY;
CREATE POLICY caregiver_actuals_self ON public.caregiver_shift_actuals FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER caregiver_actuals_updated BEFORE UPDATE ON public.caregiver_shift_actuals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();