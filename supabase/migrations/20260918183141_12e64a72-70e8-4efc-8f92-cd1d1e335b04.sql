-- lovable-cron-fallback-reviewed: 48 runs/day; Apple/iCloud ICS subscription feeds offer no webhook or push notification, so periodic re-fetch is the only way to detect changes; 30 minutes bounds staleness for household schedules.
ALTER TYPE public.calendar_provider ADD VALUE IF NOT EXISTS 'ics';

ALTER TABLE public.calendar_sources
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS subscription_member_id uuid REFERENCES public.family_members(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.ics_subscription_secrets (
  source_id uuid PRIMARY KEY REFERENCES public.calendar_sources(id) ON DELETE CASCADE,
  url_ciphertext text NOT NULL,
  url_hint text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT ALL ON public.ics_subscription_secrets TO service_role;

ALTER TABLE public.ics_subscription_secrets ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_ics_subscription_secrets_updated_at ON public.ics_subscription_secrets;
CREATE TRIGGER update_ics_subscription_secrets_updated_at
  BEFORE UPDATE ON public.ics_subscription_secrets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

SELECT cron.schedule(
  'ics-subscriptions-refresh',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://ourfamilycalendar.com/api/public/ics/refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select token from public.scheduler_credentials where name = 'scheduler')
    ),
    body := '{}'::jsonb
  );
  $$
);