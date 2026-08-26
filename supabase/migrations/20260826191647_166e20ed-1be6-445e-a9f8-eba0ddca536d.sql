SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'email-summaries-dispatch'),
  schedule := '*/5 * * * *'
);