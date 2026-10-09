CREATE TABLE public.app_tour_states (
  user_id uuid NOT NULL,
  tour_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('completed', 'dismissed')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tour_version)
);
GRANT SELECT, INSERT, UPDATE ON public.app_tour_states TO authenticated;
GRANT ALL ON public.app_tour_states TO service_role;
ALTER TABLE public.app_tour_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own tour state" ON public.app_tour_states FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users create own tour state" ON public.app_tour_states FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own tour state" ON public.app_tour_states FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);