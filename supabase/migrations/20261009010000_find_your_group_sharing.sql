-- "Find your group", step 1: members of a confirmed group share their live location with each
-- other while they look for one another at the airport.
--   1. Positions travel over a PRIVATE Supabase Realtime channel per group (broadcast + presence).
--      They are never stored: nothing in this migration has a column for a coordinate, and the
--      audit trail only records that sharing started or stopped.
--   2. Only passengers currently in that confirmed group may join, send or receive on its channel
--      (row level security on realtime.messages).
--   3. taxi_groups.ride_started_at closes the channel for everyone once the ride has started (set
--      by a later step; nothing writes it yet).
--
-- Safe to run more than once.

-- 1. When the group's ride started. Null: not started.
alter table public.taxi_groups
  add column if not exists ride_started_at timestamptz;

-- 2. Audit trail: sharing started / stopped. Never a position.
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
    'location_sharing_started', 'location_sharing_stopped'
  ));

-- The passenger's own app reports that it started or stopped sharing. Takes a reason from a fixed
-- list and nothing else, so a coordinate can't end up in the audit trail through here.
create or replace function public.log_location_sharing(
  p_request_id uuid,
  p_event text,
  p_reason text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.passenger_requests%rowtype;
begin
  if p_event not in ('location_sharing_started', 'location_sharing_stopped') then
    raise exception 'invalid event %', p_event using errcode = '22023';
  end if;
  if p_reason is not null
     and p_reason not in ('user', 'background', 'left_screen', 'timeout', 'group_ended', 'permission') then
    raise exception 'invalid reason %', p_reason using errcode = '22023';
  end if;

  select * into v_request from public.passenger_requests where id = p_request_id;
  if not found or v_request.user_id <> auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (v_request.group_id, p_request_id, p_event,
          case when p_reason is null then null else jsonb_build_object('reason', p_reason) end,
          'passenger', auth.uid());
end;
$$;

revoke all on function public.log_location_sharing(uuid, text, text) from public, anon;
grant execute on function public.log_location_sharing(uuid, text, text) to authenticated;

-- 3. The group's private channel, topic 'meetup:<group id>'. Receiving (select) and sending
-- (insert) are both limited to passengers whose ride is in that group right now, while the group
-- is confirmed and its ride hasn't started. Realtime checks these when a client joins; it does not
-- store the messages. (Row level security is already on for realtime.messages - enabling it here
-- would fail, the table isn't ours.)
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
        and realtime.topic() = 'meetup:' || g.id::text
    )
  );
