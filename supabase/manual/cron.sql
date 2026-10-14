-- Run once in the Supabase SQL editor AFTER deploying the functions.
-- Do not commit a filled-in copy of this file: it contains your cron secret.
--
-- 1) Replace the three placeholders below.
--    project_url : https://<project-ref>.supabase.co
--    anon_key    : the public anon key (only used to pass the function gateway's JWT check)
--    cron_secret : a long random string. Set the SAME value as the Edge Function secret:
--                  npx supabase secrets set CRON_SECRET=<same value>
select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
select vault.create_secret('YOUR_ANON_KEY', 'anon_key');
select vault.create_secret('LONG_RANDOM_STRING', 'cron_secret');

-- 2) Every minute: call process-scheduled, but only when something is actually due.
select cron.schedule(
  'process-scheduled-notifications',
  '* * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/process-scheduled',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'anon_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  )
  where exists (
    select 1 from public.notifications
    where (status = 'scheduled' and scheduled_at <= now())
       or (status = 'sending' and claimed_at < now() - interval '15 minutes')
  );
  $job$
);

-- Inspect / remove:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select * from net._http_response order by created desc limit 10;
--   select cron.unschedule('process-scheduled-notifications');
