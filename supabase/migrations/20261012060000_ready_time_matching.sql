-- Ready time, phase B: everything about a ride's timing goes by the moment the passenger is ready
-- (ready_at - see 20261012050000_ready_time.sql), not by the moment their plane reaches the gate.
-- Matching, the group's meeting time and the payment deadlines switch in the Edge Functions; this
-- is the part that lives in the database:
--   1. A ride that finds no group expires once the passenger's READY time plus their maximum wait
--      has passed - not their arrival plus that wait, or a passenger still at passport control
--      would already have expired.
--   2. The audit trail knows 'ready_time_conflict': a member of a confirmed group whose flight now
--      arrives well off the time the group was formed on (recheck-landing-times records it; the
--      group itself is never changed).
--
-- Safe to run more than once.

-- 1. Ride expiry. The function is rewritten from its stored definition, so everything else about
-- it stays exactly as it is; the migration fails if a comparison on the arrival is left over.
do $$
declare
  fn record;
  -- "arrival_at + make_interval(mins => max_wait_minutes)", with or without a table alias.
  by_arrival constant text := '(\m\w+\.)?arrival_at\s*\+\s*make_interval\(mins => (\w+\.)?max_wait_minutes\)';
begin
  for fn in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~ by_arrival
  loop
    execute regexp_replace(
      pg_get_functiondef(fn.oid),
      by_arrival,
      'coalesce(\1ready_at, \1arrival_at) + make_interval(mins => \2max_wait_minutes)',
      'g'
    );
  end loop;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~ by_arrival
  ) then
    raise exception 'a function still expires rides by their arrival time';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'expire_overdue_requests'
      and p.prosrc ~ 'coalesce\((\w+\.)?ready_at, (\w+\.)?arrival_at\) \+ make_interval'
  ) then
    raise exception 'expire_overdue_requests was not switched to the ready time';
  end if;
end $$;

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
    'find_group_opened',
    'ready_time_conflict'
  ));
