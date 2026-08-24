SELECT cron.unschedule('google-calendar-reconcile');

SELECT cron.schedule(
  'google-calendar-reconcile',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://household-cal.lovable.app/api/public/google-calendar/reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_4ChNZDyXiL5pMdGEw692hg_Razf6F11',
      'Authorization', 'Bearer 1f053c7e00555f3f18a8e3e4f676fa706eb9d607afeee40ece4ccb9b15860aa4'
    ),
    body := '{}'::jsonb
  );
  $$
);