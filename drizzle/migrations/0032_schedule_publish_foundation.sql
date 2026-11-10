CREATE TABLE public.babysitter_schedule_publish_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  draft_id UUID NOT NULL REFERENCES public.babysitter_schedule_drafts(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  draft_revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','applying','applied','failed')),
  started_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
GRANT SELECT, INSERT, UPDATE ON public.babysitter_schedule_publish_runs TO authenticated;
GRANT ALL ON public.babysitter_schedule_publish_runs TO service_role;
ALTER TABLE public.babysitter_schedule_publish_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read publish runs" ON public.babysitter_schedule_publish_runs FOR SELECT TO authenticated USING (public.is_family_owner(family_id));
CREATE POLICY "Owners create publish runs" ON public.babysitter_schedule_publish_runs FOR INSERT TO authenticated WITH CHECK (public.is_family_owner(family_id));
CREATE POLICY "Owners update publish runs" ON public.babysitter_schedule_publish_runs FOR UPDATE TO authenticated USING (public.is_family_owner(family_id)) WITH CHECK (public.is_family_owner(family_id));

CREATE TABLE public.babysitter_schedule_publish_ops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  run_id UUID REFERENCES public.babysitter_schedule_publish_runs(id) ON DELETE SET NULL,
  draft_id UUID NOT NULL REFERENCES public.babysitter_schedule_drafts(id) ON DELETE CASCADE,
  draft_revision INTEGER NOT NULL,
  op_key TEXT NOT NULL,
  draft_shift_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('create','update','exclude')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','applied','needs_attention','failed')),
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  google_status TEXT NOT NULL DEFAULT 'pending' CHECK (google_status IN ('pending','synced','needs_attention','not_applicable')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, op_key),
  UNIQUE (family_id, draft_id, draft_shift_id)
);
GRANT SELECT, INSERT, UPDATE ON public.babysitter_schedule_publish_ops TO authenticated;
GRANT ALL ON public.babysitter_schedule_publish_ops TO service_role;
ALTER TABLE public.babysitter_schedule_publish_ops ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read publish ops" ON public.babysitter_schedule_publish_ops FOR SELECT TO authenticated USING (public.is_family_owner(family_id));
CREATE POLICY "Owners create publish ops" ON public.babysitter_schedule_publish_ops FOR INSERT TO authenticated WITH CHECK (public.is_family_owner(family_id));
CREATE POLICY "Owners update publish ops" ON public.babysitter_schedule_publish_ops FOR UPDATE TO authenticated USING (public.is_family_owner(family_id)) WITH CHECK (public.is_family_owner(family_id));

CREATE TABLE public.google_sync_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  op_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('create','update','delete','exclusion')),
  event_id UUID,
  calendar_source_id UUID,
  google_event_id TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','synced','needs_attention')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (family_id, op_key)
);
GRANT ALL ON public.google_sync_outbox TO service_role;
ALTER TABLE public.google_sync_outbox ENABLE ROW LEVEL SECURITY;