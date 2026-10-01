ALTER TABLE public.timesheet_settings
  ADD COLUMN IF NOT EXISTS notify_ready boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_reminder boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_owner_submit boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_correction boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_approved boolean NOT NULL DEFAULT true;

ALTER TABLE public.family_members
  ADD COLUMN IF NOT EXISTS timesheet_emails_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.timesheet_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES public.families(id) ON DELETE CASCADE,
  timesheet_id uuid REFERENCES public.timesheets(id) ON DELETE CASCADE,
  family_member_id uuid REFERENCES public.family_members(id) ON DELETE CASCADE,
  kind text NOT NULL,
  version_key text NOT NULL,
  recipient text NOT NULL,
  status text NOT NULL DEFAULT 'claimed',
  detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (family_id, kind, version_key, recipient)
);
GRANT ALL ON public.timesheet_notifications TO service_role;
ALTER TABLE public.timesheet_notifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS timesheet_notifications_sheet_idx ON public.timesheet_notifications (timesheet_id, kind);
CREATE TRIGGER update_timesheet_notifications_updated_at
  BEFORE UPDATE ON public.timesheet_notifications
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

SELECT cron.schedule(
  'timesheet-notifications',
  '7 * * * *',
  $$
  select net.http_post(
    url := 'https://ourfamilycalendar.com/api/public/timesheets/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select token from public.scheduler_credentials where name = 'scheduler')
    ),
    body := '{}'::jsonb
  );
  $$
);