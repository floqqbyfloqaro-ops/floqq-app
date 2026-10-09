-- "Find your group": a member is at the meeting point. Mostly said by the member themselves ("I'm
-- at the meeting point" - the primary signal, whatever the GPS says), sometimes detected by their
-- phone when the GPS is good enough. Stored so the other members see it even when nobody shares
-- their location:
--   - WHEN they arrived and HOW it was established (MANUAL button or AUTO detection, to see after
--     the pilot how often each is used);
--   - never WHERE: no coordinate is stored, here or in the audit trail.
-- It can be undone until the ride starts, and doesn't carry over to another group.
--
-- The 'arrived_at_meeting_point' and 'arrival_undone' audit events already exist
-- (20261011000000_group_badge_and_meetup.sql).
--
-- Safe to run more than once.

alter table public.passenger_requests
  add column if not exists meeting_point_arrived_at timestamptz,
  add column if not exists meeting_point_arrival_source text
    check (meeting_point_arrival_source in ('MANUAL', 'AUTO'));

-- Leaving a group clears what was said at its meetup: the confirmation and the arrival.
create or replace function public.reset_meetup_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.group_id is distinct from old.group_id then
    new.found_group_at := null;
    new.meeting_point_arrived_at := null;
    new.meeting_point_arrival_source := null;
  end if;
  return new;
end;
$$;

-- Marks the caller's own ride as arrived. Safe to repeat: an arrival that is already recorded
-- stays as it was (a later AUTO detection doesn't overwrite a MANUAL tap, or the other way round).
create or replace function public.member_mark_arrived(p_request_id uuid, p_source text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.passenger_requests%rowtype;
  v_group public.taxi_groups%rowtype;
begin
  if p_source not in ('MANUAL', 'AUTO') then
    raise exception 'invalid source %', p_source using errcode = '22023';
  end if;

  select * into v_request from public.passenger_requests where id = p_request_id for update;
  if not found or v_request.user_id <> auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_request.group_id is null or v_request.status <> 'matched' then
    return jsonb_build_object('arrived', false, 'reason', 'no_group');
  end if;

  select * into v_group from public.taxi_groups where id = v_request.group_id;
  if not found or v_group.status <> 'confirmed' then
    return jsonb_build_object('arrived', false, 'reason', 'group_not_confirmed');
  end if;
  if v_group.ride_started_at is not null then
    return jsonb_build_object('arrived', false, 'reason', 'ride_started');
  end if;

  if v_request.meeting_point_arrived_at is null then
    update public.passenger_requests
    set meeting_point_arrived_at = now(), meeting_point_arrival_source = p_source
    where id = p_request_id;

    insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
    values (v_group.id, p_request_id, 'arrived_at_meeting_point', jsonb_build_object('source', p_source),
            'passenger', auth.uid());

    -- Touches the group row so the other members' apps (which follow their group, not each
    -- other's rides) hear that something changed.
    update public.taxi_groups set meetup_completed_at = meetup_completed_at where id = v_group.id;
  end if;

  return jsonb_build_object('arrived', true);
end;
$$;

revoke all on function public.member_mark_arrived(uuid, text) from public, anon;
grant execute on function public.member_mark_arrived(uuid, text) to authenticated;

-- "Undo": takes the arrival back - a mistaken tap, or a detection that was wrong. Until the ride
-- starts.
create or replace function public.member_undo_arrival(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.passenger_requests%rowtype;
  v_group public.taxi_groups%rowtype;
begin
  select * into v_request from public.passenger_requests where id = p_request_id for update;
  if not found or v_request.user_id <> auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_request.group_id is null or v_request.meeting_point_arrived_at is null then
    return jsonb_build_object('undone', true);
  end if;

  select * into v_group from public.taxi_groups where id = v_request.group_id;
  if found and v_group.ride_started_at is not null then
    return jsonb_build_object('undone', false, 'reason', 'ride_started');
  end if;

  update public.passenger_requests
  set meeting_point_arrived_at = null, meeting_point_arrival_source = null
  where id = p_request_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (v_request.group_id, p_request_id, 'arrival_undone',
          jsonb_build_object('source', v_request.meeting_point_arrival_source), 'passenger', auth.uid());

  update public.taxi_groups set meetup_completed_at = meetup_completed_at where id = v_request.group_id;

  return jsonb_build_object('undone', true);
end;
$$;

revoke all on function public.member_undo_arrival(uuid) from public, anon;
grant execute on function public.member_undo_arrival(uuid) to authenticated;
