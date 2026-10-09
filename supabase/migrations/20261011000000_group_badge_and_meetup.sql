-- "Find your group", the last few metres: every confirmed group gets a badge (a colour with its
-- own shape, and a two-digit number) that its members hold up to recognise each other, and each
-- member confirms "I've found my group".
--   1. The badge is assigned once, by the match-offer-sweep job, and never changes afterwards.
--   2. The group is "found" only when ALL its members have confirmed. A member who never shows up
--      can be left behind by the others ('member_no_show'), as long as two passengers remain.
--   3. Once found, any member can mark the ride as started ("We're in the taxi"); otherwise it is
--      marked started automatically 45 minutes after the planned departure - but only if the group
--      was found. A group that never met is NOT marked started: it is flagged for the admin
--      (meetup_flagged_at), and while it is flagged no payment step runs for it (the receipt, the
--      estimated-fare fallback, the capture and the cancellation fee all check the flag).
--   4. Live location sharing ends when the group is found (the channel's access rules below).
--
-- Safe to run more than once.

-- 1. The badge, and how far the meetup got.
alter table public.taxi_groups
  add column if not exists badge_color text
    check (badge_color in ('purple', 'teal', 'orange', 'pink', 'yellow', 'blue')),
  add column if not exists badge_number smallint check (badge_number between 10 and 99),
  -- Every member confirmed "I've found my group". Null: not (yet).
  add column if not exists meetup_completed_at timestamptz,
  -- Who or what marked the ride as started (ride_started_at): a member in the taxi, the automatic
  -- close of a found group, a taxi receipt that proves the ride took place, or the admin.
  add column if not exists ride_started_source text
    check (ride_started_source in ('member', 'auto', 'receipt', 'admin')),
  -- The group never met and its ride time is long past: the admin has to look at it. While this
  -- is set, nothing is charged for the ride.
  add column if not exists meetup_flagged_at timestamptz;

alter table public.passenger_requests
  add column if not exists found_group_at timestamptz,
  -- Left behind by the rest of their group because they never showed up at the meeting point.
  add column if not exists no_show_at timestamptz,
  add column if not exists no_show_group_id uuid references public.taxi_groups (id) on delete set null;

-- A confirmation belongs to the group it was given in: it doesn't carry over to another group.
create or replace function public.reset_meetup_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.group_id is distinct from old.group_id then
    new.found_group_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists passenger_requests_reset_meetup_state on public.passenger_requests;
create trigger passenger_requests_reset_meetup_state
  before update on public.passenger_requests
  for each row execute function public.reset_meetup_state();

-- 2. Audit trail. The two arrival events belong to the next step (the arrow screen) and are
-- added here so the list doesn't have to be rebuilt again for them.
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
    'arrived_at_meeting_point', 'arrival_undone'
  ));

-- 3. "I've found my group". Each member confirms for themselves; when the last one does, the
-- group is found. Safe to repeat.
create or replace function public.member_confirm_found(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.passenger_requests%rowtype;
  v_group public.taxi_groups%rowtype;
  v_group_found boolean := false;
begin
  select * into v_request from public.passenger_requests where id = p_request_id for update;
  if not found or v_request.user_id <> auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_request.group_id is null or v_request.status <> 'matched' then
    return jsonb_build_object('confirmed', false, 'reason', 'no_group');
  end if;

  select * into v_group from public.taxi_groups where id = v_request.group_id for update;
  if not found or v_group.status <> 'confirmed' then
    return jsonb_build_object('confirmed', false, 'reason', 'group_not_confirmed');
  end if;
  if v_group.ride_started_at is not null then
    return jsonb_build_object('confirmed', false, 'reason', 'ride_started');
  end if;

  if v_request.found_group_at is null then
    update public.passenger_requests set found_group_at = now() where id = p_request_id;
    insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
    values (v_group.id, p_request_id, 'found_group', null, 'passenger', auth.uid());
  end if;

  if v_group.meetup_completed_at is null and not exists (
    select 1 from public.passenger_requests where group_id = v_group.id and found_group_at is null
  ) then
    update public.taxi_groups set meetup_completed_at = now() where id = v_group.id;
    insert into public.group_events (group_id, request_id, event_type, details, actor_type)
    values (v_group.id, null, 'group_found', null, 'system');
    v_group_found := true;
  else
    -- Touches the group row so the other members' apps (which follow their group, not each
    -- other's rides) hear that something changed.
    update public.taxi_groups set meetup_completed_at = meetup_completed_at where id = v_group.id;
  end if;

  return jsonb_build_object('confirmed', true, 'group_found', v_group_found or v_group.meetup_completed_at is not null);
end;
$$;

revoke all on function public.member_confirm_found(uuid) from public, anon;
grant execute on function public.member_confirm_found(uuid) to authenticated;

-- 4. "We're in the taxi": any member of a group that has been found marks the ride as started.
create or replace function public.member_start_ride(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.passenger_requests%rowtype;
  v_group public.taxi_groups%rowtype;
begin
  select * into v_request from public.passenger_requests where id = p_request_id;
  if not found or v_request.user_id <> auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_request.group_id is null or v_request.status <> 'matched' then
    return jsonb_build_object('started', false, 'reason', 'no_group');
  end if;

  select * into v_group from public.taxi_groups where id = v_request.group_id for update;
  if not found or v_group.status <> 'confirmed' then
    return jsonb_build_object('started', false, 'reason', 'group_not_confirmed');
  end if;
  if v_group.ride_started_at is not null then
    return jsonb_build_object('started', true);
  end if;
  if v_group.meetup_completed_at is null then
    return jsonb_build_object('started', false, 'reason', 'group_not_found');
  end if;

  update public.taxi_groups
  set ride_started_at = now(), ride_started_source = 'member', meetup_flagged_at = null
  where id = v_group.id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (v_group.id, p_request_id, 'ride_started', jsonb_build_object('source', 'member'), 'passenger', auth.uid());

  return jsonb_build_object('started', true);
end;
$$;

revoke all on function public.member_start_ride(uuid) from public, anon;
grant execute on function public.member_start_ride(uuid) to authenticated;

-- 5. "Continue without [name]": the members who found each other leave behind one who never
-- showed up. Same steps as system_remove_unpaid_member, plus the checks that make it fair:
--   - the one asking is in the group and has confirmed "found" themselves;
--   - the one left behind has not;
--   - at least p_wait_minutes have passed since the first confirmation;
--   - at least two passengers remain.
-- The meetup-actions Edge Function (service role) calls this for the passenger it authenticated,
-- then rescores the group and adjusts the card holds.
create or replace function public.system_remove_no_show_member(
  p_group_id uuid,
  p_request_id uuid,
  p_actor_request_id uuid,
  p_wait_minutes integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
  v_request public.passenger_requests%rowtype;
  v_actor public.passenger_requests%rowtype;
  v_first_found timestamptz;
  v_remaining_count integer;
  v_group_found boolean := false;
begin
  select * into v_group from public.taxi_groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'P0002';
  end if;
  if v_group.status <> 'confirmed' or v_group.ride_started_at is not null then
    return jsonb_build_object('blocked', true, 'reason', 'group_not_meeting');
  end if;

  select * into v_actor from public.passenger_requests where id = p_actor_request_id;
  if not found or v_actor.group_id is distinct from p_group_id or v_actor.found_group_at is null then
    return jsonb_build_object('blocked', true, 'reason', 'actor_not_confirmed');
  end if;

  select * into v_request from public.passenger_requests where id = p_request_id for update;
  if not found or v_request.group_id is distinct from p_group_id then
    return jsonb_build_object('blocked', true, 'reason', 'not_a_member');
  end if;
  if v_request.found_group_at is not null then
    return jsonb_build_object('blocked', true, 'reason', 'member_confirmed');
  end if;

  select min(found_group_at) into v_first_found from public.passenger_requests where group_id = p_group_id;
  if v_first_found is null or v_first_found > now() - make_interval(mins => p_wait_minutes) then
    return jsonb_build_object('blocked', true, 'reason', 'too_early');
  end if;

  select count(*) into v_remaining_count
  from public.passenger_requests
  where group_id = p_group_id and id <> p_request_id;
  if v_remaining_count < 2 then
    return jsonb_build_object('blocked', true, 'reason', 'too_few_remaining');
  end if;

  update public.passenger_requests
  set status = 'pending', group_id = null, distance_km = null, extra_detour_minutes = null,
      waiting_minutes = null, individual_score = null,
      no_show_at = now(), no_show_group_id = p_group_id
  where id = p_request_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (p_group_id, p_request_id, 'member_no_show',
          jsonb_build_object('decided_by_request_id', p_actor_request_id), 'passenger', v_actor.user_id);

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (p_group_id, p_request_id, 'member_removed', jsonb_build_object('reason', 'no_show'), 'passenger', v_actor.user_id);

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (p_group_id, p_request_id, 'ride_requeued', jsonb_build_object('reason', 'no_show'), 'passenger', v_actor.user_id);

  -- Everyone who is left may already have confirmed: then the group is found now.
  if v_group.meetup_completed_at is null and not exists (
    select 1 from public.passenger_requests where group_id = p_group_id and found_group_at is null
  ) then
    update public.taxi_groups set meetup_completed_at = now() where id = p_group_id;
    insert into public.group_events (group_id, request_id, event_type, details, actor_type)
    values (p_group_id, null, 'group_found', jsonb_build_object('after', 'member_no_show'), 'system');
    v_group_found := true;
  end if;

  return jsonb_build_object(
    'blocked', false,
    'group_found', v_group_found,
    'group_version', v_group.version,
    'removed_user_id', v_request.user_id
  );
end;
$$;

revoke all on function public.system_remove_no_show_member(uuid, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.system_remove_no_show_member(uuid, uuid, uuid, integer) to service_role;

-- 6. The admin's answer to a flagged group: "the ride did take place". Marks it started and lifts
-- the flag, so its payment steps can run again. (For a ride that did NOT take place there is
-- nothing to do here: it stays flagged and nothing is ever charged for it.)
create or replace function public.admin_confirm_ride_took_place(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
begin
  if (auth.jwt() ->> 'email') is distinct from 'floqqbyfloqaro@gmail.com' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_group from public.taxi_groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'P0002';
  end if;
  if v_group.status <> 'confirmed' then
    return jsonb_build_object('applied', false, 'reason', 'group_not_confirmed');
  end if;

  update public.taxi_groups
  set ride_started_at = coalesce(ride_started_at, now()),
      ride_started_source = coalesce(ride_started_source, 'admin'),
      meetup_flagged_at = null
  where id = p_group_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (p_group_id, null, 'ride_started', jsonb_build_object('source', 'admin', 'was_flagged', v_group.meetup_flagged_at is not null),
          'admin', auth.uid());

  return jsonb_build_object('applied', true);
end;
$$;

revoke all on function public.admin_confirm_ride_took_place(uuid) from public, anon;
grant execute on function public.admin_confirm_ride_took_place(uuid) to authenticated;

-- 7. Live location sharing ends when the group has been found (or its ride has started): the
-- channel's access rules from 20261009010000_find_your_group_sharing.sql, with that added.
drop policy if exists "Group members receive on their meetup channel" on realtime.messages;
create policy "Group members receive on their meetup channel"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and exists (
      select 1
      from public.passenger_requests pr
      join public.taxi_groups g on g.id = pr.group_id
      where pr.user_id = auth.uid()
        and pr.status = 'matched'
        and g.status = 'confirmed'
        and g.ride_started_at is null
        and g.meetup_completed_at is null
        and realtime.topic() = 'meetup:' || g.id::text
    )
  );

drop policy if exists "Group members send on their meetup channel" on realtime.messages;
create policy "Group members send on their meetup channel"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and exists (
      select 1
      from public.passenger_requests pr
      join public.taxi_groups g on g.id = pr.group_id
      where pr.user_id = auth.uid()
        and pr.status = 'matched'
        and g.status = 'confirmed'
        and g.ride_started_at is null
        and g.meetup_completed_at is null
        and realtime.topic() = 'meetup:' || g.id::text
    )
  );
