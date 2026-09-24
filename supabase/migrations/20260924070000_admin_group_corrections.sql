-- Lets the admin correct a manually (or automatically) created group before it's confirmed:
-- remove a member, add one, or dissolve the whole group. Reuses the exact same two-phase
-- lock-then-Google-Routes-rescore shape built for passenger-initiated edits/cancels
-- (20260923010000_group_rebalance_on_edit.sql, 20260924050000_one_active_ride_and_group_aware_cancel.sql)
-- - admin-authorized instead of owner-authorized, and driving the same rescoreGroup() Edge
-- Function helper for the "remove" case. See supabase/functions/admin-manage-group/index.ts.

-- 1. Audit trail: who did this, not just what happened. Existing group_events rows (passenger
-- edits/cancels, system expiry) are left with actor_type/actor_id null rather than backfilled -
-- this only needs to be accurate going forward for the new admin-initiated events.
alter table public.group_events
  add column if not exists actor_type text check (actor_type in ('passenger', 'admin', 'system')),
  add column if not exists actor_id uuid references auth.users (id) on delete set null;

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
    'ride_expired', 'ride_cancelled'
  ));

-- 2. Remove a member - phase A. Structurally identical to begin_passenger_request_edit's detach
-- path (reset the row, dissolve if fewer than 2 members remain) but authorized against the admin
-- account instead of auth.uid() = user_id, since the admin isn't the request's owner.
create or replace function public.admin_begin_remove_group_member(
  p_group_id uuid,
  p_request_id uuid
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
begin
  if (auth.jwt() ->> 'email') is distinct from 'floqqbyfloqaro@gmail.com' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_group from public.taxi_groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'P0002';
  end if;

  if v_group.status = 'confirmed' then
    return jsonb_build_object('blocked', true, 'reason', 'group_confirmed');
  end if;

  select * into v_request from public.passenger_requests where id = p_request_id for update;
  if not found or v_request.group_id is distinct from p_group_id then
    return jsonb_build_object('blocked', true, 'reason', 'not_a_member');
  end if;

  update public.passenger_requests
  set status = 'pending', group_id = null, distance_km = null, extra_detour_minutes = null,
      waiting_minutes = null, individual_score = null
  where id = p_request_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (p_group_id, p_request_id, 'member_removed', jsonb_build_object('reason', 'admin_removed'), 'admin', auth.uid());

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (p_group_id, p_request_id, 'ride_requeued', jsonb_build_object('reason', 'admin_removed'), 'admin', auth.uid());

  select coalesce(array_agg(id), '{}') into v_remaining_ids
  from public.passenger_requests
  where group_id = p_group_id;

  v_remaining_count := coalesce(array_length(v_remaining_ids, 1), 0);

  if v_remaining_count < 2 then
    update public.passenger_requests
    set status = 'pending', group_id = null, distance_km = null, extra_detour_minutes = null,
        waiting_minutes = null, individual_score = null
    where group_id = p_group_id;

    update public.taxi_groups
    set status = 'dissolved', version = version + 1
    where id = p_group_id;

    insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
    values (p_group_id, null, 'group_dissolved',
            jsonb_build_object('reason', 'below_min_members', 'remaining_count', v_remaining_count), 'admin', auth.uid());

    insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
    select p_group_id, id, 'ride_requeued', jsonb_build_object('reason', 'group_dissolved'), 'admin', auth.uid()
    from unnest(v_remaining_ids) as id;

    return jsonb_build_object('blocked', false, 'needs_recalc', false, 'dissolved', true);
  end if;

  return jsonb_build_object(
    'blocked', false,
    'needs_recalc', true,
    'dissolved', false,
    'group_id', p_group_id,
    'group_version', v_group.version
  );
end;
$$;

revoke all on function public.admin_begin_remove_group_member(uuid, uuid) from public;
grant execute on function public.admin_begin_remove_group_member(uuid, uuid) to authenticated;

-- 3. Dissolve a group outright - single phase, no rescoring needed since nothing survives.
create or replace function public.admin_dissolve_group(
  p_group_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
  v_member_ids uuid[];
begin
  if (auth.jwt() ->> 'email') is distinct from 'floqqbyfloqaro@gmail.com' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_group from public.taxi_groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'P0002';
  end if;

  if v_group.status = 'confirmed' then
    return jsonb_build_object('blocked', true, 'reason', 'group_confirmed');
  end if;

  if v_group.status = 'dissolved' then
    return jsonb_build_object('blocked', false, 'already_dissolved', true);
  end if;

  perform 1 from public.passenger_requests where group_id = p_group_id for update;

  select coalesce(array_agg(id), '{}') into v_member_ids
  from public.passenger_requests
  where group_id = p_group_id;

  update public.passenger_requests
  set status = 'pending', group_id = null, distance_km = null, extra_detour_minutes = null,
      waiting_minutes = null, individual_score = null
  where group_id = p_group_id;

  update public.taxi_groups
  set status = 'dissolved', version = version + 1
  where id = p_group_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (p_group_id, null, 'group_dissolved', jsonb_build_object('reason', 'admin_dissolved'), 'admin', auth.uid());

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  select p_group_id, id, 'ride_requeued', jsonb_build_object('reason', 'admin_dissolved'), 'admin', auth.uid()
  from unnest(v_member_ids) as id;

  return jsonb_build_object('blocked', false, 'dissolved', true);
end;
$$;

revoke all on function public.admin_dissolve_group(uuid) from public;
grant execute on function public.admin_dissolve_group(uuid) to authenticated;

-- 4. Add a member - single phase. Unlike remove/dissolve this needs a fresh Google Routes score
-- for the grown group before it can commit, which plain SQL can't compute - the Edge Function
-- (supabase/functions/admin-manage-group) reads the group + candidate, runs computeGroupScore and
-- the same isGroupStillValid compatibility check used everywhere else, then calls this to apply it
-- atomically. Re-validates everything again under lock (group still open, request still free, seat
-- still available) since none of that read-then-score work above happened under a lock - a stale
-- read is discarded here rather than corrupting the group.
create or replace function public.admin_commit_add_group_member(
  p_group_id uuid,
  p_request_id uuid,
  p_member_scores jsonb,
  p_group_totals jsonb,
  p_forced boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
  v_request public.passenger_requests%rowtype;
  v_member_count integer;
  v_member jsonb;
begin
  if (auth.jwt() ->> 'email') is distinct from 'floqqbyfloqaro@gmail.com' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_group from public.taxi_groups where id = p_group_id for update;
  if not found or v_group.status <> 'unconfirmed' then
    return jsonb_build_object('applied', false, 'reason', 'group_not_open');
  end if;

  select * into v_request from public.passenger_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' or v_request.group_id is not null then
    return jsonb_build_object('applied', false, 'reason', 'request_not_available');
  end if;

  -- Kept in sync with MAX_PASSENGERS_PER_TAXI in src/constants.ts and
  -- supabase/functions/_shared/constants.ts.
  select count(*) into v_member_count from public.passenger_requests where group_id = p_group_id;
  if v_member_count >= 3 then
    return jsonb_build_object('applied', false, 'reason', 'group_full');
  end if;

  update public.passenger_requests
  set group_id = p_group_id, status = 'matched'
  where id = p_request_id;

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

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (p_group_id, p_request_id, 'member_added', jsonb_build_object('forced', p_forced), 'admin', auth.uid());

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (p_group_id, null, 'group_recalculated', p_group_totals, 'admin', auth.uid());

  return jsonb_build_object('applied', true);
end;
$$;

revoke all on function public.admin_commit_add_group_member(uuid, uuid, jsonb, jsonb, boolean) from public;
grant execute on function public.admin_commit_add_group_member(uuid, uuid, jsonb, jsonb, boolean) to authenticated;
