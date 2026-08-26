CREATE TABLE public.email_summary_presyncs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  schedule_id UUID NOT NULL REFERENCES public.email_schedules(id) ON DELETE CASCADE,
  period_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  attempts INTEGER NOT NULL DEFAULT 1,
  detail TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_summary_presyncs_status_check CHECK (status IN ('running','ok','failed','skipped'))
);

CREATE UNIQUE INDEX email_summary_presyncs_period_idx
  ON public.email_summary_presyncs (schedule_id, period_key);

GRANT SELECT ON public.email_summary_presyncs TO authenticated;
GRANT ALL ON public.email_summary_presyncs TO service_role;

ALTER TABLE public.email_summary_presyncs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Household members can view presync history"
  ON public.email_summary_presyncs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.family_users fu
    WHERE fu.family_id = email_summary_presyncs.family_id
      AND fu.user_id = auth.uid()
  ));