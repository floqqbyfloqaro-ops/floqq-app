-- Same terminal is a hard matching rule: a taxi group only ever holds passengers arriving at the
-- same terminal (T1 with T1, T2 with T2 - T2A/T2B/T2C all count as T2). T1 and T2 are kilometres
-- apart, so a group must be able to meet in one place.
--   1. Every ride knows its arrival terminal: from the flight data when there is a flight number
--      and the data has one, otherwise chosen by the passenger. Flight data wins once it's there.
--   2. The database itself refuses to put a ride into a group at another terminal (or with an
--      unknown one) - whichever path tries: the matching job, a late join, or the admin by hand.
--   3. The flight re-check job follows a schedule per flight (see _shared/flightRefresh.ts) and
--      needs to remember when it last looked, when the flight leaves and whether it has landed.
--   4. When flight data later reports another terminal: a passenger in an offer (unconfirmed
--      group) is taken out of it and re-matched ('terminal_changed'); for a confirmed group
--      nothing changes by itself - the conflict is recorded for the admin ('terminal_conflict').
--
-- A ride no longer needs a flight number (a passenger already at the airport, or who doesn't know
-- it): flight_number stays a required column and is simply empty then.
--
-- Safe to run more than once.

-- 1. The ride's terminal and what the flight re-check knows.
alter table public.passenger_requests
  add column if not exists arrival_terminal text check (arrival_terminal in ('T1', 'T2')),
  -- 'flight': from flight data. 'passenger': chosen in the request form.
  add column if not exists arrival_terminal_source text check (arrival_terminal_source in ('flight', 'passenger')),
  -- When the flight was last looked up by the re-check job. Null: never.
  add column if not exists flight_checked_at timestamptz,
  -- The flight's scheduled departure: from then on it is looked up more often.
  add column if not exists flight_scheduled_departure_at timestamptz,
  -- Set once the flight has landed: nothing more to look up.
  add column if not exists flight_landed_at timestamptz,
  -- The terminal flight data now reports for a ride in a CONFIRMED group whose terminal is
  -- different. Null: no conflict. Shown to the admin; nothing is changed automatically.
  add column if not exists terminal_conflict text check (terminal_conflict in ('T1', 'T2'));

-- 2. A new ride always comes with a terminal. (A trigger, not a constraint: rides from before
-- this existed have none, and they are still updated now and then - expired, settled.)
create or replace function public.require_arrival_terminal()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.arrival_terminal is null then
    raise exception 'arrival_terminal_required' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists passenger_requests_require_terminal on public.passenger_requests;
create trigger passenger_requests_require_terminal
  before insert on public.passenger_requests
  for each row execute function public.require_arrival_terminal();

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
    new.terminal_conflict := null;
  end if;
  return new;
end;
$$;

drop trigger if exists passenger_requests_reset_flight_tracking on public.passenger_requests;
create trigger passenger_requests_reset_flight_tracking
  before update on public.passenger_requests
  for each row execute function public.reset_flight_tracking();

-- 3. The guarantee. Fires when a ride is put into a group (not when a grouped ride's terminal
-- changes - that is step 4's job to act on). After the statement's rows are written, so a group
-- created in one statement is checked as a whole.
create or replace function public.enforce_group_same_terminal()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.group_id is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.group_id is not distinct from old.group_id then
    return null;
  end if;

  if new.arrival_terminal is null then
    raise exception 'terminal_unknown' using errcode = '23514',
      detail = 'A ride without a known arrival terminal cannot be put into a group.';
  end if;

  if exists (
    select 1 from public.passenger_requests pr
    where pr.group_id = new.group_id
      and pr.id <> new.id
      and pr.arrival_terminal is distinct from new.arrival_terminal
  ) then
    raise exception 'terminal_mismatch' using errcode = '23514',
      detail = 'A group can only hold passengers arriving at the same terminal.';
  end if;

  return null;
end;
$$;

drop trigger if exists passenger_requests_same_terminal on public.passenger_requests;
create trigger passenger_requests_same_terminal
  after insert or update of group_id on public.passenger_requests
  for each row execute function public.enforce_group_same_terminal();

-- 4. Audit trail: the two terminal events, and the meeting point assignment that follows in the
-- next step.
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
    'terminal_changed', 'terminal_conflict', 'meeting_point_assigned'
  ));

-- Taking a passenger out of an offer now has a third reason: 'terminal_changed' (flight data
-- reports another terminal than the group's). Otherwise unchanged from
-- 20261008010000_match_offer_answers.sql. Service role only.
create or replace function public.system_remove_offer_member(
  p_group_id uuid,
  p_request_id uuid,
  p_event text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
  v_request public.passenger_requests%rowtype;
  v_remaining_ids uuid[];
  v_remaining_count integer;
  v_actor text;
begin
  if p_event not in ('match_declined', 'offer_expired', 'terminal_changed') then
    raise exception 'invalid event %', p_event using errcode = '22023';
  end if;
  v_actor := case when p_event = 'match_declined' then 'passenger' else 'system' end;

  select * into v_group from public.taxi_groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'P0002';
  end if;

  if v_group.status <> 'unconfirmed' then
    return jsonb_build_object('blocked', true, 'reason', 'group_not_offered');
  end if;

  select * into v_request from public.passenger_requests where id = p_request_id for update;
  if not found or v_request.group_id is distinct from p_group_id then
    return jsonb_build_object('blocked', true, 'reason', 'not_a_member');
  end if;

  -- A passenger who secured their spot in the meantime keeps it: the deadline no longer applies.
  if p_event = 'offer_expired' and v_request.spot_secured_group_id = p_group_id then
    return jsonb_build_object('blocked', true, 'reason', 'spot_secured');
  end if;

  update public.passenger_requests
  set status = 'pending', group_id = null, distance_km = null, extra_detour_minutes = null,
      waiting_minutes = null, individual_score = null,
      spot_secured_at = null, spot_secured_group_id = null
  where id = p_request_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (p_group_id, p_request_id, p_event, null, v_actor,
          case when v_actor = 'passenger' then v_request.user_id end);

  insert into public.group_events (group_id, request_id, event_type, details, actor_type)
  values (p_group_id, p_request_id, 'ride_requeued', jsonb_build_object('reason', p_event), v_actor);

  select coalesce(array_agg(id), '{}') into v_remaining_ids
  from public.passenger_requests
  where group_id = p_group_id;

  v_remaining_count := coalesce(array_length(v_remaining_ids, 1), 0);

  if v_remaining_count < 2 then
    update public.passenger_requests
    set status = 'pending', group_id = null, distance_km = null, extra_detour_minutes = null,
        waiting_minutes = null, individual_score = null,
        spot_secured_at = null, spot_secured_group_id = null
    where group_id = p_group_id;

    update public.taxi_groups
    set status = 'dissolved', version = version + 1
    where id = p_group_id;

    insert into public.group_events (group_id, request_id, event_type, details, actor_type)
    values (p_group_id, null, 'group_dissolved',
            jsonb_build_object('reason', 'below_min_members', 'remaining_count', v_remaining_count), 'system');

    insert into public.group_events (group_id, request_id, event_type, details, actor_type)
    select p_group_id, id, 'ride_requeued', jsonb_build_object('reason', 'group_dissolved'), 'system'
    from unnest(v_remaining_ids) as id;

    return jsonb_build_object('blocked', false, 'needs_recalc', false, 'dissolved', true,
                              'remaining_ids', to_jsonb(v_remaining_ids));
  end if;

  -- Same as the other removals: the version only moves when the rescore is applied.
  return jsonb_build_object(
    'blocked', false,
    'needs_recalc', true,
    'dissolved', false,
    'group_id', p_group_id,
    'group_version', v_group.version
  );
end;
$$;

revoke all on function public.system_remove_offer_member(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.system_remove_offer_member(uuid, uuid, text) to service_role;

-- 5. The flight re-check now runs every 5 minutes instead of every 15. It no longer looks every
-- flight up on every run: each tick only asks which flights are due (48 h, 24 h, 6 h and 2 h
-- before landing, then about every 10 minutes from the scheduled departure until the flight has
-- landed), so the 5 minutes are just how finely that schedule is followed. cron.schedule()
-- upserts by job name.
select cron.schedule(
  'recheck-landing-times',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/recheck-landing-times',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
