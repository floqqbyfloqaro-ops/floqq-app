-- The matching job runs every minute instead of every 5, so a passenger hears about a match up to
-- four minutes sooner. Scoring a combination of passengers is a paid Google Routes lookup, so the
-- job now remembers what it turned down: a rejected combination is only asked about again after
-- five minutes (how often the job ran before - routes are traffic-aware, so the answer can change)
-- or when something about it changed. See supabase/functions/_shared/matchRejectionRule.ts.
--
-- Safe to run more than once.

-- 1. What the job turned down, and what that depended on. Service role only: no client policies.
create table if not exists public.match_rejections (
  -- 'new:' or 'join:' and the passengers' ride ids, sorted.
  group_key text primary key,
  -- The members' arrival times, destinations and luggage (and, for a passenger joining an open
  -- offer, the offer's version and fare) at the time of the rejection.
  fingerprint text not null,
  rejected_at timestamptz not null default now()
);

create index if not exists match_rejections_rejected_at_idx on public.match_rejections (rejected_at);

alter table public.match_rejections enable row level security;

-- 2. Every minute. cron.schedule() upserts by job name. Overlapping ticks stay harmless: the
-- function takes its lock and a second concurrent run just returns { skipped: true }.
select cron.schedule(
  'match-and-group',
  '* * * * *',
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
