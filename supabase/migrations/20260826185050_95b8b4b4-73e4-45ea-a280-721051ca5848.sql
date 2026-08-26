ALTER TABLE public.families
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Los_Angeles';

CREATE TYPE public.email_summary_frequency AS ENUM ('daily', 'weekly', 'monthly');

CREATE TABLE public.email_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  name text NOT NULL,
  frequency public.email_summary_frequency NOT NULL DEFAULT 'weekly',
  send_time time NOT NULL DEFAULT '18:00',
  enabled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_schedules TO authenticated;
GRANT ALL ON public.email_schedules TO service_role;
ALTER TABLE public.email_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_schedules_select ON public.email_schedules
  FOR SELECT TO authenticated USING (public.is_family_owner(family_id));
CREATE POLICY email_schedules_write_owner ON public.email_schedules
  FOR ALL TO authenticated
  USING (public.is_family_owner(family_id))
  WITH CHECK (public.is_family_owner(family_id));

CREATE TRIGGER email_schedules_updated_at BEFORE UPDATE ON public.email_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.email_schedule_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.email_schedules(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  family_member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL,
  name text NOT NULL,
  email text NOT NULL,
  unsubscribe_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  unsubscribed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, email)
);

CREATE UNIQUE INDEX email_schedule_recipients_token_idx
  ON public.email_schedule_recipients (unsubscribe_token);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_schedule_recipients TO authenticated;
GRANT ALL ON public.email_schedule_recipients TO service_role;
ALTER TABLE public.email_schedule_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_schedule_recipients_select ON public.email_schedule_recipients
  FOR SELECT TO authenticated USING (public.is_family_owner(family_id));
CREATE POLICY email_schedule_recipients_write_owner ON public.email_schedule_recipients
  FOR ALL TO authenticated
  USING (public.is_family_owner(family_id))
  WITH CHECK (public.is_family_owner(family_id));

CREATE TRIGGER email_schedule_recipients_updated_at BEFORE UPDATE ON public.email_schedule_recipients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.email_schedule_recipient_calendars (
  recipient_id uuid NOT NULL REFERENCES public.email_schedule_recipients(id) ON DELETE CASCADE,
  calendar_source_id uuid NOT NULL REFERENCES public.calendar_sources(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recipient_id, calendar_source_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_schedule_recipient_calendars TO authenticated;
GRANT ALL ON public.email_schedule_recipient_calendars TO service_role;
ALTER TABLE public.email_schedule_recipient_calendars ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_schedule_recipient_calendars_select ON public.email_schedule_recipient_calendars
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.email_schedule_recipients r
    WHERE r.id = email_schedule_recipient_calendars.recipient_id
      AND public.is_family_owner(r.family_id)
  ));
CREATE POLICY email_schedule_recipient_calendars_write_owner ON public.email_schedule_recipient_calendars
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.email_schedule_recipients r
    WHERE r.id = email_schedule_recipient_calendars.recipient_id
      AND public.is_family_owner(r.family_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.email_schedule_recipients r
    WHERE r.id = email_schedule_recipient_calendars.recipient_id
      AND public.is_family_owner(r.family_id)
  ));

CREATE TABLE public.email_summary_sends (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  schedule_id uuid NOT NULL REFERENCES public.email_schedules(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.email_schedule_recipients(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recipient_id, period_key)
);

GRANT SELECT ON public.email_summary_sends TO authenticated;
GRANT ALL ON public.email_summary_sends TO service_role;
ALTER TABLE public.email_summary_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY email_summary_sends_select ON public.email_summary_sends
  FOR SELECT TO authenticated USING (public.is_family_owner(family_id));

INSERT INTO public.email_schedules (family_id, name, frequency, send_time, enabled, created_by)
SELECT f.id, 'Family Weekly Summary', 'weekly', '18:00', false, f.created_by
FROM public.families f
WHERE NOT EXISTS (SELECT 1 FROM public.email_schedules s WHERE s.family_id = f.id);