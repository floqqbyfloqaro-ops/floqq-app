-- Schedules the automatic matching run: every 5 minutes, pg_cron fires an HTTP POST (via pg_net)
-- at the match-and-group Edge Function, authenticating with the `x-cron-secret` header that
-- supabase/functions/_shared/auth.ts checks against the function's CRON_SECRET env var.
-- Overlapping ticks are harmless: the function takes an advisory lock (LOCK_ID = 1) and a
-- second concurrent run just returns { skipped: true }.
--
-- Neither the project URL nor the secret is hardcoded here, so this file is safe to commit.
-- Both are read from Supabase Vault at run time and must be created once per project (SQL
-- editor), with the secret matching the value set via `supabase secrets set CRON_SECRET=...`:
--
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<same value as CRON_SECRET>', 'cron_secret');
--
-- Until those exist the job still fires but the request goes nowhere / gets a 401, so nothing
-- is grouped by mistake. cron.schedule() upserts by job name, so re-running is safe.

select cron.schedule(
  'match-and-group',
  '*/5 * * * *', -- every 5 minutes
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/match-and-group',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb,
      -- Matching calls out to Google Routes per candidate group, so allow well beyond
      -- pg_net's 5s default before the request is abandoned.
      timeout_milliseconds := 60000
    );
  $$
);
