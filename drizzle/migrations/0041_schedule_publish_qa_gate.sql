-- Default-off QA allowlist for Schedule Builder publishing. Service-role only:
-- no client can read or write it. An empty table means publishing is off everywhere.
CREATE TABLE public.schedule_publish_qa_gates (
  family_id UUID NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, owner_user_id)
);
GRANT ALL ON public.schedule_publish_qa_gates TO service_role;
REVOKE ALL ON public.schedule_publish_qa_gates FROM anon, authenticated;
ALTER TABLE public.schedule_publish_qa_gates ENABLE ROW LEVEL SECURITY;