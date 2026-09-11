alter table public.taxi_groups
  add column if not exists status text not null default 'unconfirmed' check (status in ('unconfirmed', 'confirmed')),
  add column if not exists worst_individual_score numeric,
  add column if not exists total_route_distance_km numeric,
  add column if not exists total_route_duration_minutes numeric;

alter table public.passenger_requests
  add column if not exists extra_detour_minutes numeric,
  add column if not exists waiting_minutes numeric,
  add column if not exists individual_score numeric;

-- Overlap guard for the new recheck-landing-times job, reusing the same single-row-per-job
-- lock table match-and-group already uses instead of a session-level Postgres advisory lock.
insert into public.match_engine_lock (id, locked_at)
values (2, null)
on conflict (id) do nothing;
