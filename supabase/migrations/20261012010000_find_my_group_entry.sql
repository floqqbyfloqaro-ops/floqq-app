-- "Find my group": the way into the meetup screen from the confirmed group, and what tells a
-- passenger they have landed.
--   1. A ride remembers its flight's latest estimated landing - also in a confirmed group, whose
--      own times are never changed - and that its "You've landed" notification was sent.
--   2. The audit trail records that a passenger opened "Find your group" (never where they are).
--
-- Safe to run more than once.

-- 1. The ride.
alter table public.passenger_requests
  -- The flight's latest estimated (or actual) landing, from the flight re-check. Null: no flight
  -- data; the ride's own arrival_at then stands in for it.
  add column if not exists flight_estimated_arrival_at timestamptz,
  -- Set when the "You've landed" notification went out: it is sent once per ride.
  add column if not exists landed_push_sent_at timestamptz;

-- Another flight number is another flight: what was known about the old one no longer applies.
create or replace function public.reset_flight_tracking()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.flight_number is distinct from old.flight_number then
    new.flight_checked_at := null;
    new.flight_scheduled_departure_at := null;
    new.flight_landed_at := null;
    new.flight_operator_iata := null;
    new.flight_estimated_arrival_at := null;
    new.terminal_conflict := null;
  end if;
  return new;
end;
$$;

-- 2. Audit trail.
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
    'match_offered', 'spot_secured', 'match_declined', 'offer_expired',
    'location_sharing_started', 'location_sharing_stopped',
    'terminal_changed', 'terminal_conflict', 'meeting_point_assigned',
    'badge_assigned', 'found_group', 'group_found', 'member_no_show', 'ride_started', 'meetup_flagged',
    'arrived_at_meeting_point', 'arrival_undone',
    'find_group_opened'
  ));

-- The passenger's own app reports that it opened "Find your group". Takes a state and a source
-- from fixed lists and nothing else, so a coordinate can't end up in the audit trail through here.
create or replace function public.log_find_group_opened(
  p_request_id uuid,
  p_state text,
  p_source text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.passenger_requests%rowtype;
begin
  if p_state not in ('preview', 'landed') then
    raise exception 'invalid state %', p_state using errcode = '22023';
  end if;
  if p_source not in ('button', 'notification', 'app_open') then
    raise exception 'invalid source %', p_source using errcode = '22023';
  end if;

  select * into v_request from public.passenger_requests where id = p_request_id;
  if not found or v_request.user_id <> auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (v_request.group_id, p_request_id, 'find_group_opened',
          jsonb_build_object('state', p_state, 'source', p_source),
          'passenger', auth.uid());
end;
$$;

revoke all on function public.log_find_group_opened(uuid, text, text) from public, anon;
grant execute on function public.log_find_group_opened(uuid, text, text) to authenticated;
