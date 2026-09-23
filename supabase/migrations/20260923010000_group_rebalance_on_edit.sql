-- Fixes the edge case where editing a ride that belongs to an unconfirmed group left the old
-- group's member list, score and fare split stale for whoever was left behind. Editing now goes
-- through begin_passenger_request_edit() / apply_group_rescore() (called from the
-- edit-passenger-request Edge Function) instead of a plain client-side UPDATE.

-- No richer group state machine exists in this schema (only 'unconfirmed'/'confirmed' before this
-- migration) - adding 'dissolved' rather than inventing SEARCHING/CANDIDATE_FOUND/OFFERED/LOCKED/
-- MEETING, which nothing else in the codebase models.
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.taxi_groups'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.taxi_groups drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.taxi_groups
  add constraint taxi_groups_status_check check (status in ('unconfirmed', 'confirmed', 'dissolved'));

-- Optimistic-concurrency guard between phase A (begin_passenger_request_edit, which may finish
-- immediately or hand off to the Edge Function for a Google Routes recalculation) and phase C
-- (apply_group_rescore, applied after that external call returns). If another edit on the same
-- group commits in between, the version bump makes the stale apply a safe no-op instead of an
-- overwrite.
alter table public.taxi_groups
  add column if not exists version integer not null default 0;

create table if not exists public.group_events (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.taxi_groups (id) on delete set null,
  request_id uuid references public.passenger_requests (id) on delete set null,
  event_type text not null check (event_type in ('member_removed', 'group_recalculated', 'group_dissolved', 'ride_requeued')),
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.group_events enable row level security;
-- Only written by the SECURITY DEFINER functions below (or the service role) - no client policies,
-- this is an internal audit trail, not a passenger-facing activity feed.

-- Phase A: locks the passenger's row (and, if grouped, the group row) before making any change,
-- so two members of the same group editing at once serialize on the group row lock rather than
-- racing. Runs as SECURITY DEFINER because it must be able to update OTHER members' rows and the
-- taxi_groups row, neither of which a passenger has RLS UPDATE rights on - so it authorizes
-- itself explicitly against auth.uid() instead of relying on RLS.
create or replace function public.begin_passenger_request_edit(
  p_request_id uuid,
  p_flight_number text,
  p_arrival_at timestamptz,
  p_destination_address text,
  p_destination_lat double precision,
  p_destination_lng double precision,
  p_large_luggage_count integer,
  p_hand_luggage_count integer,
  p_max_wait_minutes integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.passenger_requests%rowtype;
  v_group public.taxi_groups%rowtype;
  v_remaining_ids uuid[];
  v_remaining_count integer;
begin
  select * into v_request from public.passenger_requests where id = p_request_id for update;

  if not found then
    raise exception 'passenger request % not found', p_request_id using errcode = 'P0002';
  end if;

  if v_request.user_id <> auth.uid() then
    raise exception 'not authorized to edit this request' using errcode = '42501';
  end if;

  if v_request.status = 'cancelled' then
    raise exception 'cannot edit a cancelled request' using errcode = 'P0001';
  end if;

  if v_request.group_id is not null then
    select * into v_group from public.taxi_groups where id = v_request.group_id for update;

    if found and v_group.status = 'confirmed' then
      return jsonb_build_object('blocked', true, 'reason', 'group_confirmed');
    end if;
  end if;

  update public.passenger_requests
  set
    flight_number = p_flight_number,
    arrival_at = p_arrival_at,
    destination_address = p_destination_address,
    destination_lat = p_destination_lat,
    destination_lng = p_destination_lng,
    large_luggage_count = p_large_luggage_count,
    hand_luggage_count = p_hand_luggage_count,
    max_wait_minutes = p_max_wait_minutes,
    status = 'pending',
    group_id = null,
    distance_km = null,
    extra_detour_minutes = null,
    waiting_minutes = null,
    individual_score = null
  where id = p_request_id;

  insert into public.group_events (group_id, request_id, event_type, details)
  values (v_request.group_id, p_request_id, 'ride_requeued', jsonb_build_object('reason', 'edited'));

  if v_request.group_id is null then
    return jsonb_build_object('blocked', false, 'needs_recalc', false, 'dissolved', false);
  end if;

  insert into public.group_events (group_id, request_id, event_type, details)
  values (v_request.group_id, p_request_id, 'member_removed', jsonb_build_object('reason', 'edited'));

  select coalesce(array_agg(id), '{}') into v_remaining_ids
  from public.passenger_requests
  where group_id = v_request.group_id;

  v_remaining_count := array_length(v_remaining_ids, 1);
  if v_remaining_count is null then
    v_remaining_count := 0;
  end if;

  if v_remaining_count < 2 then
    update public.passenger_requests
    set status = 'pending', group_id = null, distance_km = null, extra_detour_minutes = null,
        waiting_minutes = null, individual_score = null
    where group_id = v_request.group_id;

    update public.taxi_groups
    set status = 'dissolved', version = version + 1
    where id = v_request.group_id;

    insert into public.group_events (group_id, request_id, event_type, details)
    values (v_request.group_id, null, 'group_dissolved', jsonb_build_object('reason', 'below_min_members', 'remaining_count', v_remaining_count));

    insert into public.group_events (group_id, request_id, event_type, details)
    select v_request.group_id, id, 'ride_requeued', jsonb_build_object('reason', 'group_dissolved')
    from unnest(v_remaining_ids) as id;

    return jsonb_build_object('blocked', false, 'needs_recalc', false, 'dissolved', true);
  end if;

  return jsonb_build_object(
    'blocked', false,
    'needs_recalc', true,
    'dissolved', false,
    'group_id', v_request.group_id,
    'group_version', v_group.version,
    'remaining_member_ids', to_jsonb(v_remaining_ids)
  );
end;
$$;

revoke all on function public.begin_passenger_request_edit(uuid, text, timestamptz, text, double precision, double precision, integer, integer, integer) from public;
grant execute on function public.begin_passenger_request_edit(uuid, text, timestamptz, text, double precision, double precision, integer, integer, integer) to authenticated;

-- Phase C: called by the Edge Function after it recomputes the surviving group's score via
-- Google Routes. Re-locks the group row and checks p_expected_version still matches before
-- writing anything - if a second edit on the same group committed in between (bumping the
-- version), this is a stale write and is discarded rather than clobbering newer state.
create or replace function public.apply_group_rescore(
  p_group_id uuid,
  p_expected_version integer,
  p_still_valid boolean,
  p_member_scores jsonb,
  p_group_totals jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
  v_member jsonb;
  v_remaining_ids uuid[];
begin
  select * into v_group from public.taxi_groups where id = p_group_id for update;

  if not found or v_group.status <> 'unconfirmed' or v_group.version <> p_expected_version then
    return jsonb_build_object('applied', false, 'reason', 'stale');
  end if;

  if not p_still_valid then
    select coalesce(array_agg(id), '{}') into v_remaining_ids
    from public.passenger_requests
    where group_id = p_group_id;

    update public.passenger_requests
    set status = 'pending', group_id = null, distance_km = null, extra_detour_minutes = null,
        waiting_minutes = null, individual_score = null
    where group_id = p_group_id;

    update public.taxi_groups
    set status = 'dissolved', version = version + 1
    where id = p_group_id;

    insert into public.group_events (group_id, request_id, event_type, details)
    values (p_group_id, null, 'group_dissolved', jsonb_build_object('reason', 'no_longer_compatible'));

    insert into public.group_events (group_id, request_id, event_type, details)
    select p_group_id, id, 'ride_requeued', jsonb_build_object('reason', 'group_dissolved')
    from unnest(v_remaining_ids) as id;

    return jsonb_build_object('applied', true, 'dissolved', true);
  end if;

  for v_member in select * from jsonb_array_elements(p_member_scores)
  loop
    update public.passenger_requests
    set
      distance_km = (v_member ->> 'distance_km')::numeric,
      extra_detour_minutes = (v_member ->> 'extra_detour_minutes')::numeric,
      waiting_minutes = (v_member ->> 'waiting_minutes')::numeric,
      individual_score = (v_member ->> 'individual_score')::numeric
    where id = (v_member ->> 'id')::uuid and group_id = p_group_id;
  end loop;

  update public.taxi_groups
  set
    total_fare = (p_group_totals ->> 'total_fare')::numeric,
    worst_individual_score = (p_group_totals ->> 'worst_individual_score')::numeric,
    total_route_distance_km = (p_group_totals ->> 'total_route_distance_km')::numeric,
    total_route_duration_minutes = (p_group_totals ->> 'total_route_duration_minutes')::numeric,
    version = version + 1
  where id = p_group_id;

  insert into public.group_events (group_id, request_id, event_type, details)
  values (p_group_id, null, 'group_recalculated', p_group_totals);

  return jsonb_build_object('applied', true, 'dissolved', false);
end;
$$;

revoke all on function public.apply_group_rescore(uuid, integer, boolean, jsonb, jsonb) from public;
grant execute on function public.apply_group_rescore(uuid, integer, boolean, jsonb, jsonb) to authenticated, service_role;
