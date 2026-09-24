-- A ride that never gets a confirmed group no longer stays "searching" forever: once
-- arrival_at + that passenger's own max_wait_minutes has passed, it moves to 'expired'.
-- 'expired' is deliberately separate from 'cancelled' so pilot analytics can tell a
-- passenger's own cancellation apart from the system giving up on a match.
--
-- Replaces the hourly delete-stale-pending-requests job, which hard-deleted old pending rows
-- and so destroyed exactly the data these analytics need.

-- 1. Allow the new status. Same dynamic-drop approach as 20260917010000, since this constraint
--    has been replaced before and its name shouldn't be assumed.
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.passenger_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) not ilike '%service_fee_status%'
  loop
    execute format('alter table public.passenger_requests drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.passenger_requests
  add constraint passenger_requests_status_check
  check (status in ('pending', 'matched', 'cancelled', 'expired'));

-- 2. Allow the new audit event (inline constraint again, so found dynamically too).
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
  check (event_type in ('member_removed', 'group_recalculated', 'group_dissolved', 'ride_requeued', 'ride_expired'));

-- 3. 'expired' is terminal. Without this, the passenger's cancel policy or the edit flow
--    (begin_passenger_request_edit, which only rejects 'cancelled') could quietly revive an
--    expired row; the passenger creates a new request instead.
create or replace function public.prevent_expired_request_revival()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'expired' and new.status is distinct from 'expired' then
    raise exception 'request % has expired and cannot change status', old.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists passenger_requests_expired_is_terminal on public.passenger_requests;
create trigger passenger_requests_expired_is_terminal
  before update of status on public.passenger_requests
  for each row execute function public.prevent_expired_request_revival();

-- 4. The expiry pass itself.
--
-- Grouped rides: only 'unconfirmed' groups are touched - a confirmed group is an admin
-- commitment and is left alone. If any member of an unconfirmed group is overdue, the whole
-- group is dissolved rather than rescored in place: rescoring needs a Google Routes call that
-- plain SQL can't make, and match-and-group regroups the requeued members with fresh routes
-- and fares within its next 5-minute tick anyway.
--
-- Takes match-and-group's lock (match_engine_lock id 1, same 2-minute staleness rule as
-- _shared/matchLock.ts) so it never expires a row that an in-flight matching run has already
-- read as 'pending' and is about to put into a group. If matching is running, this pass just
-- skips and the next tick catches up.
create or replace function public.expire_overdue_requests()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_groups_dissolved integer := 0;
  v_expired_count integer := 0;
  v_rows integer;
begin
  update public.match_engine_lock
  set locked_at = now()
  where id = 1
    and (locked_at is null or locked_at < now() - interval '2 minutes');

  if not found then
    return jsonb_build_object('skipped', true, 'reason', 'match-and-group is running');
  end if;

  for v_group_id in
    select distinct g.id
    from public.taxi_groups g
    join public.passenger_requests r on r.group_id = g.id
    where g.status = 'unconfirmed'
      and r.status = 'matched'
      and r.arrival_at + make_interval(mins => r.max_wait_minutes) < now()
  loop
    perform 1 from public.taxi_groups where id = v_group_id and status = 'unconfirmed' for update;
    if not found then
      continue;
    end if;
    perform 1 from public.passenger_requests where group_id = v_group_id for update;

    insert into public.group_events (group_id, request_id, event_type, details)
    select v_group_id, id, 'ride_expired',
           jsonb_build_object('reason', 'max_wait_passed', 'previous_status', status)
    from public.passenger_requests
    where group_id = v_group_id
      and arrival_at + make_interval(mins => max_wait_minutes) < now();

    insert into public.group_events (group_id, request_id, event_type, details)
    select v_group_id, id, 'ride_requeued', jsonb_build_object('reason', 'group_dissolved')
    from public.passenger_requests
    where group_id = v_group_id
      and arrival_at + make_interval(mins => max_wait_minutes) >= now();

    update public.passenger_requests
    set status = case
                   when arrival_at + make_interval(mins => max_wait_minutes) < now() then 'expired'
                   else 'pending'
                 end,
        group_id = null, distance_km = null, extra_detour_minutes = null,
        waiting_minutes = null, individual_score = null
    where group_id = v_group_id;

    update public.taxi_groups
    set status = 'dissolved', version = version + 1
    where id = v_group_id;

    insert into public.group_events (group_id, request_id, event_type, details)
    values (v_group_id, null, 'group_dissolved', jsonb_build_object('reason', 'member_expired'));

    v_groups_dissolved := v_groups_dissolved + 1;
  end loop;

  -- The loop above already expired its overdue members; this catches the ungrouped ones.
  with expired as (
    update public.passenger_requests
    set status = 'expired'
    where status = 'pending'
      and group_id is null
      and arrival_at + make_interval(mins => max_wait_minutes) < now()
    returning id
  )
  insert into public.group_events (group_id, request_id, event_type, details)
  select null, id, 'ride_expired', jsonb_build_object('reason', 'max_wait_passed', 'previous_status', 'pending')
  from expired;

  get diagnostics v_rows = row_count;
  v_expired_count := v_rows;

  update public.match_engine_lock set locked_at = null where id = 1;

  return jsonb_build_object(
    'skipped', false,
    'groups_dissolved', v_groups_dissolved,
    'ungrouped_expired', v_expired_count
  );
end;
$$;

-- Only pg_cron (running as the owner) and the service role should ever call this.
revoke all on function public.expire_overdue_requests() from public, anon, authenticated;

-- 5. Retire the hard-delete job and schedule the expiry pass. cron.unschedule() errors if the
--    job doesn't exist, hence the guard.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'delete-stale-pending-requests') then
    perform cron.unschedule('delete-stale-pending-requests');
  end if;
end $$;

select cron.schedule(
  'expire-overdue-requests',
  '*/5 * * * *', -- every 5 minutes
  $$ select public.expire_overdue_requests(); $$
);

-- 6. Catch up now on everything already overdue (including old pending rows the delete job
--    would otherwise have removed), instead of waiting for the first tick.
select public.expire_overdue_requests();
