CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('google-calendar-reconcile')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'google-calendar-reconcile');

SELECT cron.schedule(
  'google-calendar-reconcile',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--59a26a17-1a46-4d37-bcef-754fd9db6154.lovable.app/api/public/google-calendar/reconcile',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_4ChNZDyXiL5pMdGEw692hg_Razf6F11',
      'Authorization', 'Bearer ' || current_setting('app.settings.cron_secret', true)
    ),
    body := '{}'::jsonb
  );
  $$
);