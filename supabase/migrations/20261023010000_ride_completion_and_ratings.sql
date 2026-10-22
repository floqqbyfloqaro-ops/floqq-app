-- "Ride completed", step A: when each passenger's ride ends, and how they rate it.
--   1. Per passenger (drop-offs happen at different times): completed when they tap "I've
--      arrived", when the taxi receipt is in (the payer is always the last one out, so everyone
--      has arrived), or automatically a few hours after the start (match-offer-sweep). The
--      group's ride is completed once every member is. Audit events: passenger_arrived,
--      ride_completed.
--   2. A completed ride is no longer the passenger's active ride: they can book the next one.
--   3. "Ride completed" is shown once after an automatic completion (completion_seen_at).
--   4. Ratings: one per passenger per ride - stars, reasons, an optional comment. Only the
--      passenger and the admin can read them; never other passengers.
--
-- Safe to run more than once.

-- 1. Completion.
alter table public.passenger_requests
  add column if not exists completed_at timestamptz,
  add column if not exists completed_source text
    check (completed_source is null or completed_source in ('passenger', 'receipt', 'auto', 'admin')),
  -- When the passenger saw "Ride completed" (their own tap opens it straight away).
  add column if not exists completion_seen_at timestamptz;

alter table public.taxi_groups
  add column if not exists completed_at timestamptz;

alter table public.group_events drop constraint if exists group_events_event_type_check;
alter table public.group_events
  add constraint group_events_event_type_check check (event_type in (
    'member_removed', 'member_added', 'group_recalculated', 'group_dissolved', 'ride_requeued',
    'ride_expired', 'ride_cancelled', 'payer_assigned', 'match_offered', 'spot_secured',
    'match_declined', 'offer_expired', 'location_sharing_started', 'location_sharing_stopped',
    'terminal_changed', 'terminal_conflict', 'meeting_point_assigned', 'badge_assigned',
    'found_group', 'group_found', 'member_no_show', 'ride_started', 'meetup_flagged',
    'arrived_at_meeting_point', 'arrival_undone', 'find_group_opened', 'ready_time_conflict',
    'passenger_arrived', 'ride_completed'
  ));

-- The group's ride is completed once every member still in it is.
create or replace function public.complete_group_if_done(p_group_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.passenger_requests
    where group_id = p_group_id and status = 'matched' and completed_at is null
  ) then
    return false;
  end if;

  update public.taxi_groups
  set completed_at = now()
  where id = p_group_id and completed_at is null and ride_started_at is not null;
  if found then
    insert into public.group_events (group_id, event_type, details, actor_type)
    values (p_group_id, 'ride_completed', '{}'::jsonb, 'system');
  end if;
  return true;
end;
$$;

-- Marks the members of a started group who haven't arrived yet as completed (receipt, auto).
create or replace function public.complete_group_members(p_group_id uuid, p_source text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with done as (
    update public.passenger_requests r
    set completed_at = now(), completed_source = p_source
    from public.taxi_groups g
    where g.id = p_group_id
      and g.ride_started_at is not null
      and r.group_id = g.id
      and r.status = 'matched'
      and r.completed_at is null
    returning r.id
  ), logged as (
    insert into public.group_events (group_id, request_id, event_type, details, actor_type)
    select p_group_id, id, 'passenger_arrived', jsonb_build_object('source', p_source), 'system' from done
    returning 1
  )
  select count(*) into v_count from logged;

  perform public.complete_group_if_done(p_group_id);
  return v_count;
end;
$$;

-- "I've arrived": this passenger's ride is completed.
create or replace function public.mark_my_ride_arrived(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.passenger_requests%rowtype;
  v_started timestamptz;
begin
  select * into v_request from public.passenger_requests where id = p_request_id for update;
  if not found or v_request.user_id is distinct from auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_request.completed_at is not null then
    return jsonb_build_object('completed_at', v_request.completed_at, 'already', true);
  end if;

  select ride_started_at into v_started
  from public.taxi_groups
  where id = v_request.group_id and status = 'confirmed';
  if v_started is null then
    raise exception 'ride_not_started' using errcode = 'P0001';
  end if;

  update public.passenger_requests
  set completed_at = now(), completed_source = 'passenger', completion_seen_at = now()
  where id = p_request_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (v_request.group_id, p_request_id, 'passenger_arrived', jsonb_build_object('source', 'passenger'),
          'passenger', auth.uid());

  perform public.complete_group_if_done(v_request.group_id);
  return jsonb_build_object('completed_at', now(), 'already', false);
end;
$$;

-- "Ride completed" was shown (after an automatic completion).
create or replace function public.mark_my_completion_seen(p_request_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.passenger_requests
  set completion_seen_at = now()
  where id = p_request_id and user_id = auth.uid() and completed_at is not null and completion_seen_at is null;
$$;

-- match-offer-sweep, every minute: rides started more than p_hours ago complete by themselves.
create or replace function public.system_complete_rides(p_hours numeric)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_total integer := 0;
begin
  for v_group in
    select id from public.taxi_groups
    where status = 'confirmed'
      and completed_at is null
      and ride_started_at is not null
      and ride_started_at <= now() - make_interval(secs => p_hours * 3600)
  loop
    v_total := v_total + public.complete_group_members(v_group, 'auto');
  end loop;
  return v_total;
end;
$$;

revoke all on function public.complete_group_if_done(uuid) from public, anon, authenticated;
revoke all on function public.complete_group_members(uuid, text) from public, anon, authenticated;
revoke all on function public.system_complete_rides(numeric) from public, anon, authenticated;
grant execute on function public.system_complete_rides(numeric) to service_role;
revoke all on function public.mark_my_ride_arrived(uuid) from public, anon;
revoke all on function public.mark_my_completion_seen(uuid) from public, anon;
grant execute on function public.mark_my_ride_arrived(uuid) to authenticated;
grant execute on function public.mark_my_completion_seen(uuid) to authenticated;

-- The taxi receipt is in: the payer, the last one out, has arrived - and so has everyone else.
-- (Extends the trigger from 20261023000000_group_receipt_received.sql.)
create or replace function public.ride_receipts_mark_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.group_id is null then
    return new;
  end if;
  update public.taxi_groups
  set receipt_received_at = case when new.status = 'REJECTED' then null else coalesce(receipt_received_at, new.submitted_at, now()) end
  where id = new.group_id
    and receipt_received_at is distinct from (case when new.status = 'REJECTED' then null else coalesce(receipt_received_at, new.submitted_at, now()) end);
  if new.status <> 'REJECTED' then
    perform public.complete_group_members(new.group_id, 'receipt');
  end if;
  return new;
end;
$$;

-- 2. A completed ride is not an active ride any more.
create or replace function public.is_active_request(p_status text, p_arrival_at timestamptz, p_completed_at timestamptz)
returns boolean
language sql
stable
as $$
  select p_completed_at is null and public.is_active_request(p_status, p_arrival_at);
$$;

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
      and public.is_active_request(status, arrival_at, completed_at)
  ) then
    raise exception 'active_ride_exists' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

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
    and public.is_active_request(r.status, r.arrival_at, r.completed_at)
  order by r.created_at desc
  limit 1;
$$;

-- 3. Ratings.
create table if not exists public.ride_ratings (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.passenger_requests (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid references public.taxi_groups (id) on delete set null,
  stars smallint not null check (stars between 1 and 5),
  reasons text[] not null default '{}' check (reasons <@ array[
    'finding_group', 'meeting_point', 'waiting_time', 'match_route', 'fare_price',
    'other_passengers', 'app', 'other'
  ]::text[]),
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ride_ratings_created_idx on public.ride_ratings (created_at desc);

alter table public.ride_ratings enable row level security;

drop policy if exists "Users can view their own ratings" on public.ride_ratings;
create policy "Users can view their own ratings"
  on public.ride_ratings
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Saves (or changes) the passenger's rating of their completed ride. Reasons and the comment are
-- for 1 to 4 stars; a 5-star rating keeps neither.
create or replace function public.save_my_rating(p_request_id uuid, p_stars integer, p_reasons text[], p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.passenger_requests%rowtype;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_reasons text[] := coalesce(p_reasons, '{}');
begin
  select * into v_request from public.passenger_requests where id = p_request_id;
  if not found or v_request.user_id is distinct from auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_request.completed_at is null then
    raise exception 'ride_not_completed' using errcode = 'P0001';
  end if;
  if p_stars is null or p_stars not between 1 and 5 then
    raise exception 'invalid_rating' using errcode = '22023';
  end if;
  if p_stars = 5 then
    v_reasons := '{}';
    v_comment := null;
  end if;

  insert into public.ride_ratings (request_id, user_id, group_id, stars, reasons, comment)
  values (p_request_id, auth.uid(), v_request.group_id, p_stars, v_reasons, v_comment)
  on conflict (request_id) do update
    set stars = excluded.stars, reasons = excluded.reasons, comment = excluded.comment, updated_at = now();

  return jsonb_build_object('saved', true);
end;
$$;

revoke all on function public.save_my_rating(uuid, integer, text[], text) from public, anon;
grant execute on function public.save_my_rating(uuid, integer, text[], text) to authenticated;

-- The admin's overview of the last p_days: average, distribution, reasons.
create or replace function public.admin_rating_summary(p_days integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'count', (select count(*) from public.ride_ratings where created_at >= v_since),
    'average', (select round(avg(stars)::numeric, 2) from public.ride_ratings where created_at >= v_since),
    'distribution', (
      select coalesce(jsonb_object_agg(s, c), '{}'::jsonb)
      from (select stars as s, count(*) as c from public.ride_ratings where created_at >= v_since group by stars) d
    ),
    'reasons', (
      select coalesce(jsonb_object_agg(reason, c), '{}'::jsonb)
      from (
        select unnest(reasons) as reason, count(*) as c
        from public.ride_ratings where created_at >= v_since
        group by 1
      ) r
    )
  );
end;
$$;

revoke all on function public.admin_rating_summary(integer) from public, anon;
grant execute on function public.admin_rating_summary(integer) to authenticated;
