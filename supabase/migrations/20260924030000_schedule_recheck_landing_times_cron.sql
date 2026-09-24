-- Schedules the landing-time watcher: every 15 minutes, pg_cron POSTs (via pg_net) to the
-- recheck-landing-times Edge Function with the same `x-cron-secret` auth and the same Vault
-- secrets ('project_url', 'cron_secret') as the match-and-group job in
-- 20260924020000_schedule_match_and_group_cron.sql - see that file for the one-time Vault setup.
--
-- Less frequent than match-and-group on purpose: every run makes one paid FlightAware AeroAPI
-- call per passenger in an unconfirmed group, and 15 minutes still catches a delay well before
-- pickup. Overlapping ticks are harmless (advisory lock LOCK_ID = 2). cron.schedule() upserts by
-- job name, so re-running is safe.

select cron.schedule(
  'recheck-landing-times',
  '*/15 * * * *', -- every 15 minutes
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/recheck-landing-times',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb,
      -- One FlightAware lookup per grouped passenger plus a Google Routes rescore per changed
      -- group, so allow well beyond pg_net's 5s default.
      timeout_milliseconds := 60000
    );
  $$
);
