-- Prevents overlapping match-and-group runs (e.g. a slow run still in progress when the next
-- cron tick fires) from both reading the same 'pending' passengers and double-booking one into
-- two groups. A single-row table with an atomic UPDATE is used instead of a Postgres advisory
-- lock, because Supabase's pooled connections don't guarantee the session affinity that
-- session-level advisory locks (pg_advisory_lock) depend on.
create table if not exists public.match_engine_lock (
  id smallint primary key default 1,
  locked_at timestamptz
);

insert into public.match_engine_lock (id, locked_at)
values (1, null)
on conflict (id) do nothing;

alter table public.match_engine_lock enable row level security;
-- No policies: this table is only ever touched by the match-and-group Edge Function's
-- service-role client, which bypasses RLS. No anon/authenticated access is intended.
