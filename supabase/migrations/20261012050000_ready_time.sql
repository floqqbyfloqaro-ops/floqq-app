-- Ready time, phase A: calculate and record it. Nothing uses it yet - matching, the meeting time
-- and ride expiry still go by the arrival time until phase B.
--
-- A passenger is not ready to leave the moment their plane reaches the gate. Their ready time is
--   arrival at the gate (arrival_at - flight data's gate arrival, or the time they entered)
--   + a buffer for getting off the plane, passport control and luggage:
--       Schengen flight      no checked bag 25 min, checked bag 40 min
--       non-Schengen flight  no checked bag 45 min, checked bag 60 min
--       no flight number     15 min, or 25 min if they still have luggage to collect
-- Schengen or not comes from the country of the flight's ORIGIN airport, read from the first two
-- letters of its four-letter (ICAO) code: "EG.." is the UK, "LS.." Switzerland. A flight whose
-- origin isn't known yet counts as non-Schengen until flight data says otherwise: being ready
-- early costs that passenger some waiting, being late can get them left behind.
--
-- It is calculated here, in the database, on every insert and update of a ride - so the request
-- form, an edit and the flight re-check can never disagree about it.
--
-- Safe to run more than once.

-- 1. The buffers. One row, editable in the dashboard; a change applies to rides saved from then on.
create table if not exists public.ready_time_settings (
  id boolean primary key default true check (id),
  schengen_no_bag_minutes integer not null default 25 check (schengen_no_bag_minutes >= 0),
  schengen_bag_minutes integer not null default 40 check (schengen_bag_minutes >= 0),
  non_schengen_no_bag_minutes integer not null default 45 check (non_schengen_no_bag_minutes >= 0),
  non_schengen_bag_minutes integer not null default 60 check (non_schengen_bag_minutes >= 0),
  no_flight_no_luggage_minutes integer not null default 15 check (no_flight_no_luggage_minutes >= 0),
  no_flight_luggage_minutes integer not null default 25 check (no_flight_luggage_minutes >= 0)
);

-- The same defaults for a table that already existed when this ran.
alter table public.ready_time_settings
  alter column schengen_no_bag_minutes set default 25,
  alter column schengen_bag_minutes set default 40,
  alter column non_schengen_no_bag_minutes set default 45,
  alter column non_schengen_bag_minutes set default 60,
  alter column no_flight_no_luggage_minutes set default 15,
  alter column no_flight_luggage_minutes set default 25;

insert into public.ready_time_settings (id) values (true) on conflict (id) do nothing;

alter table public.ready_time_settings enable row level security;

drop policy if exists "Admin can view ready time settings" on public.ready_time_settings;
create policy "Admin can view ready time settings"
  on public.ready_time_settings for select to authenticated
  using (public.is_admin());

drop policy if exists "Admin can change ready time settings" on public.ready_time_settings;
create policy "Admin can change ready time settings"
  on public.ready_time_settings for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 2. The Schengen countries, by the first two letters of their airports' four-letter codes. Not
-- EU membership: Switzerland, Norway and Iceland are in; the UK ("EG"), Ireland ("EI") and Cyprus
-- ("LC") are not, simply by not being listed.
create table if not exists public.schengen_origin_prefixes (
  icao_prefix text primary key check (icao_prefix ~ '^[A-Z]{2}$'),
  country text not null
);

insert into public.schengen_origin_prefixes (icao_prefix, country)
values
  ('LO', 'Austria'),
  ('EB', 'Belgium'),
  ('LB', 'Bulgaria'),
  ('LD', 'Croatia'),
  ('LK', 'Czechia'),
  ('EK', 'Denmark'),
  ('EE', 'Estonia'),
  ('EF', 'Finland'),
  ('LF', 'France'),
  ('ED', 'Germany'),
  ('ET', 'Germany'),
  ('LG', 'Greece'),
  ('LH', 'Hungary'),
  ('BI', 'Iceland'),
  ('LI', 'Italy'),
  ('EV', 'Latvia'),
  ('EY', 'Lithuania'),
  ('EL', 'Luxembourg'),
  ('LM', 'Malta'),
  ('EH', 'Netherlands'),
  ('EN', 'Norway'),
  ('EP', 'Poland'),
  ('LP', 'Portugal'),
  ('LR', 'Romania'),
  ('LZ', 'Slovakia'),
  ('LJ', 'Slovenia'),
  ('LE', 'Spain'),
  ('GC', 'Spain (Canary Islands)'),
  ('ES', 'Sweden'),
  ('LS', 'Switzerland')
on conflict (icao_prefix) do nothing;

alter table public.schengen_origin_prefixes enable row level security;

drop policy if exists "Admin can manage Schengen origins" on public.schengen_origin_prefixes;
create policy "Admin can manage Schengen origins"
  on public.schengen_origin_prefixes for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 3. The ride.
alter table public.passenger_requests
  -- Where the flight comes from, from flight data: "BOS" and "KBOS".
  add column if not exists flight_origin_iata text check (flight_origin_iata ~ '^[A-Z0-9]{3}$'),
  add column if not exists flight_origin_icao text check (flight_origin_icao ~ '^[A-Z0-9]{4}$'),
  -- 'schengen' / 'non_schengen', from the origin. Null: no flight number, or origin not known yet
  -- (then calculated as non-Schengen).
  add column if not exists flight_category text check (flight_category in ('schengen', 'non_schengen')),
  -- A ride without a flight number: "Do you still need to collect checked luggage?" Null: not
  -- asked (a ride with a flight number, or one from before the question existed).
  add column if not exists luggage_to_collect boolean,
  -- The buffer that was added to arrival_at, and the result.
  add column if not exists ready_buffer_minutes integer,
  add column if not exists ready_at timestamptz;

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
    new.flight_operator_iata := null;
    new.flight_estimated_arrival_at := null;
    new.terminal_conflict := null;
    -- Unless this same change brings the new flight's origin with it.
    if new.flight_origin_icao is not distinct from old.flight_origin_icao then
      new.flight_origin_icao := null;
      new.flight_origin_iata := null;
    end if;
  end if;
  return new;
end;
$$;

-- The calculation. Runs after the other "before" triggers of the table (they fire in name
-- order), so it sees a ride whose flight data has already been reset by a changed flight number.
create or replace function public.compute_ready_time()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  s public.ready_time_settings%rowtype;
  v_has_bag boolean;
  v_category text;
begin
  select * into s from public.ready_time_settings where id;

  if btrim(coalesce(new.flight_number, '')) = '' then
    new.flight_category := null;
    -- Their own answer; without one (an older app), whether they travel with large luggage.
    v_has_bag := coalesce(new.luggage_to_collect, coalesce(new.large_luggage_count, 0) > 0);
    new.ready_buffer_minutes := case when v_has_bag
      then coalesce(s.no_flight_luggage_minutes, 25)
      else coalesce(s.no_flight_no_luggage_minutes, 15) end;
  else
    new.flight_category := case
      when new.flight_origin_icao is null then null
      when exists (
        select 1 from public.schengen_origin_prefixes p
        where p.icao_prefix = upper(left(new.flight_origin_icao, 2))
      ) then 'schengen'
      else 'non_schengen'
    end;
    v_category := coalesce(new.flight_category, 'non_schengen');
    v_has_bag := coalesce(new.large_luggage_count, 0) > 0;
    new.ready_buffer_minutes := case
      when v_category = 'schengen' and not v_has_bag then coalesce(s.schengen_no_bag_minutes, 25)
      when v_category = 'schengen' then coalesce(s.schengen_bag_minutes, 40)
      when not v_has_bag then coalesce(s.non_schengen_no_bag_minutes, 45)
      else coalesce(s.non_schengen_bag_minutes, 60)
    end;
  end if;

  new.ready_at := new.arrival_at + make_interval(mins => new.ready_buffer_minutes);
  return new;
end;
$$;

drop trigger if exists passenger_requests_zz_ready_time on public.passenger_requests;
create trigger passenger_requests_zz_ready_time
  before insert or update on public.passenger_requests
  for each row execute function public.compute_ready_time();

-- Existing rides get theirs now (the trigger fills it in on any update).
update public.passenger_requests set ready_at = null where ready_at is null;

-- 4. Calibration: how far the calculated ready time is from when passengers really reached the
-- meeting point ("I'm at the meeting point", or their phone's detection), per kind of flight. A
-- positive number: they arrived later than calculated. Admin only.
create or replace function public.admin_ready_time_calibration()
returns table (
  category text,
  checked_bag boolean,
  rides bigint,
  buffer_minutes numeric,
  average_difference_minutes numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select
    case
      when btrim(coalesce(r.flight_number, '')) = '' then 'no_flight'
      else coalesce(r.flight_category, 'unknown')
    end as category,
    case
      when btrim(coalesce(r.flight_number, '')) = '' then coalesce(r.luggage_to_collect, r.large_luggage_count > 0)
      else r.large_luggage_count > 0
    end as checked_bag,
    count(*) as rides,
    round(avg(r.ready_buffer_minutes), 1) as buffer_minutes,
    round(avg(extract(epoch from (r.meeting_point_arrived_at - r.ready_at)) / 60.0)::numeric, 1) as average_difference_minutes
  from public.passenger_requests r
  where r.meeting_point_arrived_at is not null
    and r.ready_at is not null
  group by 1, 2
  order by 1, 2;
end;
$$;

revoke all on function public.admin_ready_time_calibration() from public, anon;
grant execute on function public.admin_ready_time_calibration() to authenticated;
