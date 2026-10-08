-- "Match found" screen, step 1: what the passenger needs to see a proposed group and answer it.
-- An unconfirmed taxi_group IS the offer (no new group status): the matching job proposed it and
-- it isn't locked yet. Each passenger answers for themselves (spot_secured_*), within the offer's
-- response window (offer_expires_at). Nothing here changes how existing groups behave: every
-- column is new and unused until the app and the match-offer function read it.
--
-- Safe to run more than once.

-- 1. The planned route's line for the map, and the response window.
alter table public.taxi_groups
  -- Google encoded polyline: airport, then each drop-off in route order.
  add column if not exists route_polyline text,
  -- The stops route_polyline was drawn for, so it's redrawn when the group changes.
  add column if not exists route_polyline_key text,
  -- When passengers who haven't secured their spot are removed. Null: no window running.
  add column if not exists offer_expires_at timestamptz;

-- 2. Per passenger: the neighbourhood other passengers see instead of the address, the flight's
-- scheduled landing (to tell "on time" from "delayed"), and their answer to the current offer.
alter table public.passenger_requests
  add column if not exists destination_neighborhood text,
  add column if not exists scheduled_arrival_at timestamptz,
  add column if not exists spot_secured_at timestamptz,
  -- The group that answer was for: it doesn't carry over to another group.
  add column if not exists spot_secured_group_id uuid references public.taxi_groups (id) on delete set null;

-- A changed destination has another neighbourhood: forget the stored one, it's looked up again.
create or replace function public.reset_destination_neighborhood()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.destination_lat is distinct from old.destination_lat
     or new.destination_lng is distinct from old.destination_lng then
    new.destination_neighborhood := null;
  end if;
  return new;
end;
$$;

drop trigger if exists passenger_requests_reset_neighborhood on public.passenger_requests;
create trigger passenger_requests_reset_neighborhood
  before update on public.passenger_requests
  for each row execute function public.reset_destination_neighborhood();

-- 3. Audit trail: the offer's own events.
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.group_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%event_type%'
  loop
    execute format('alter table public.group_events drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.group_events
  add constraint group_events_event_type_check
  check (event_type in (
    'member_removed', 'member_added', 'group_recalculated', 'group_dissolved', 'ride_requeued',
    'ride_expired', 'ride_cancelled', 'payer_assigned',
    'match_offered', 'spot_secured', 'match_declined', 'offer_expired'
  ));

-- 4. Realtime: the app moves from "Finding your match" to "Match found" the moment the
-- passenger's ride gets a group, and follows the group while the offer is open. Row level
-- security still applies - a passenger only receives their own ride and their own group.
do $$
declare
  t text;
begin
  foreach t in array array['passenger_requests', 'taxi_groups']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
