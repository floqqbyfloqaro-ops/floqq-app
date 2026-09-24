-- One active ride per passenger, and cancellation that doesn't leave a ghost member behind.
--
-- Before this, creating a new ride always INSERTed a second row and My Ride only showed the
-- newest one, so the old ride vanished from the app while staying 'pending' in the matching
-- pool. And cancelling only flipped status to 'cancelled', leaving a grouped ride attached to
-- its unconfirmed group with a stale score/fare split for the others.

-- 1. The single definition of "active", used by both the insert guard and the app's lookup.
--    'matched' rides stay active until 6h after arrival because nothing marks a ride as
--    completed; without the cut-off a finished trip would block the passenger forever.
--    (Pending/unconfirmed rides are already moved to 'expired' by expire_overdue_requests().)
create or replace function public.is_active_request(p_status text, p_arrival_at timestamptz)
returns boolean
language sql
stable
as $$
  select p_status = 'pending'
      or (p_status = 'matched' and p_arrival_at > now() - interval '6 hours');
$$;

-- 2. Database-side guard: refuses a second active ride regardless of what the client does
--    (double-tap, two devices, an older app build). The per-user transaction lock makes two
--    simultaneous inserts serialize instead of both passing the check.
create or replace function public.enforce_one_active_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

  if exists (
    select 1 from public.passenger_requests
    where user_id = new.user_id
      and public.is_active_request(status, arrival_at)
  ) then
    raise exception 'active_ride_exists' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists passenger_requests_one_active on public.passenger_requests;
create trigger passenger_requests_one_active
  before insert on public.passenger_requests
  for each row execute function public.enforce_one_active_request();

-- 3. The app's lookup: the caller's active ride (if any) plus its group's status, so the app
--    can tell a confirmed group (only "View my ride") from a cancellable one. Runs as the
--    caller, so RLS keeps it to their own rows.
create or replace function public.get_my_active_request()
returns table (id uuid, group_id uuid, group_status text)
language sql
stable
security invoker
set search_path = public
as $$
  select r.id, r.group_id, g.status
  from public.passenger_requests r
  left join public.taxi_groups g on g.id = r.group_id
  where r.user_id = auth.uid()
    and public.is_active_request(r.status, r.arrival_at)
  order by r.created_at desc
  limit 1;
$$;

grant execute on function public.get_my_active_request() to authenticated;

-- 4. Audit event for passenger cancellations.
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
    'member_removed', 'group_recalculated', 'group_dissolved', 'ride_requeued', 'ride_expired', 'ride_cancelled'
  ));

-- 5. Group-aware cancel - phase A of the same A/B/C flow as begin_passenger_request_edit()
--    (20260923010000_group_rebalance_on_edit.sql). Called from the cancel-passenger-request
--    Edge Function, which does the Google Routes rescore (phase B) and apply_group_rescore()
--    (phase C) when the group survives with 2+ members.
create or replace function public.begin_passenger_request_cancel(p_request_id uuid)
returns jsonb
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
    raise exception 'not authorized to cancel this request' using errcode = '42501';
  end if;

  if v_request.status not in ('pending', 'matched') then
    return jsonb_build_object('blocked', true, 'reason', 'not_active');
  end if;

  if v_request.group_id is not null then
    select * into v_group from public.taxi_groups where id = v_request.group_id for update;

    if found and v_group.status = 'confirmed' then
      return jsonb_build_object('blocked', true, 'reason', 'group_confirmed');
    end if;
  end if;

  update public.passenger_requests
  set status = 'cancelled', group_id = null, distance_km = null, extra_detour_minutes = null,
      waiting_minutes = null, individual_score = null
  where id = p_request_id;

  insert into public.group_events (group_id, request_id, event_type, details)
  values (v_request.group_id, p_request_id, 'ride_cancelled',
          jsonb_build_object('reason', 'passenger_cancelled', 'previous_status', v_request.status));

  if v_request.group_id is null then
    return jsonb_build_object('blocked', false, 'needs_recalc', false, 'dissolved', false);
  end if;

  insert into public.group_events (group_id, request_id, event_type, details)
  values (v_request.group_id, p_request_id, 'member_removed', jsonb_build_object('reason', 'cancelled'));

  select coalesce(array_agg(id), '{}') into v_remaining_ids
  from public.passenger_requests
  where group_id = v_request.group_id;

  v_remaining_count := coalesce(array_length(v_remaining_ids, 1), 0);

  if v_remaining_count < 2 then
    update public.passenger_requests
    set status = 'pending', group_id = null, distance_km = null, extra_detour_minutes = null,
        waiting_minutes = null, individual_score = null
    where group_id = v_request.group_id;

    update public.taxi_groups
    set status = 'dissolved', version = version + 1
    where id = v_request.group_id;

    insert into public.group_events (group_id, request_id, event_type, details)
    values (v_request.group_id, null, 'group_dissolved',
            jsonb_build_object('reason', 'below_min_members', 'remaining_count', v_remaining_count));

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
    'group_version', v_group.version
  );
end;
$$;

revoke all on function public.begin_passenger_request_cancel(uuid) from public;
grant execute on function public.begin_passenger_request_cancel(uuid) to authenticated;

-- 6. Close the side door: the old policy let a client flip ANY of its own rows to 'cancelled'
--    directly, which is exactly how grouped rides ended up as ghost members. Direct cancel is
--    now only allowed where there's no group to rebalance; everything else goes through
--    begin_passenger_request_cancel() above.
drop policy if exists "Users can cancel their own passenger requests" on public.passenger_requests;

create policy "Users can cancel their own ungrouped pending passenger requests"
  on public.passenger_requests
  for update
  using (auth.uid() = user_id and status = 'pending' and group_id is null)
  with check (auth.uid() = user_id and status = 'cancelled' and group_id is null);
