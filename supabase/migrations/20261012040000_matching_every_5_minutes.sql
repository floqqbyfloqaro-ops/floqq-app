-- The matching job goes back to every 5 minutes (MATCHING_INTERVAL_MINUTES in
-- supabase/functions/_shared/constants.ts and src/constants.ts - a test fails when this schedule
-- and that constant disagree), and the app can ask when it runs: the "Finding your match" screen
-- tells the passenger how often matches are checked and counts down to the next check.
--
-- Safe to run more than once.

-- 1. Every 5 minutes. cron.schedule() upserts by job name. Overlapping ticks stay harmless: the
-- function takes its lock and a second concurrent run just returns { skipped: true }.
select cron.schedule(
  'match-and-group',
  '*/5 * * * *',
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

-- 2. When does the matching job run? For any logged-in user, and nothing personal: how often it
-- is scheduled (read from the schedule itself, so the app can never show another number than the
-- one in force), when it last finished, and the server's clock (a phone's clock may be off).
create or replace function public.get_matching_schedule()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_schedule text;
  v_interval integer;
  v_last_run timestamptz;
begin
  begin
    select schedule into v_schedule from cron.job where jobname = 'match-and-group' limit 1;
  exception when others then
    v_schedule := null;
  end;

  -- '* * * * *' is every minute, '*/N * * * *' every N minutes; anything else isn't one interval.
  v_interval := case
    when v_schedule = '* * * * *' then 1
    when v_schedule ~ '^\*/[0-9]+ \* \* \* \*$' then substring(v_schedule from '^\*/([0-9]+)')::integer
    else null
  end;

  select last_success_at into v_last_run from public.job_runs where job = 'match-and-group';

  return jsonb_build_object(
    'interval_minutes', v_interval,
    'last_run_at', v_last_run,
    'server_now', now()
  );
end;
$$;

revoke all on function public.get_matching_schedule() from public, anon;
grant execute on function public.get_matching_schedule() to authenticated;
