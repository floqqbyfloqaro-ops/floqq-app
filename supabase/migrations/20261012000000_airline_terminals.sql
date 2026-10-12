-- The arrival terminal from the airline. At Barcelona an airline lands at one terminal, so a
-- flight number alone says where its passenger arrives - instantly and without a paid flight
-- lookup. Flight data still confirms or corrects it later, on the lookups already made.
--   1. airline_terminals: which airline lands at which terminal. Editable by the admin.
--   2. A ride remembers that its terminal came from that table ('airline'), and which airline
--      operates its flight (on a codeshare not the one in the flight number).
--   3. airline_terminal_mismatches: every flight for which flight data named another terminal than
--      the table - what the admin's "Check airline terminal" warning counts.
--   4. flight_lookups: the last lookup per flight and day, reused instead of paid for again.
--
-- Safe to run more than once.

-- 1. The table. Terminals from the airport operator's own airline list (Aena, 2026-10-12);
-- airlines it lists without a terminal are left out.
create table if not exists public.airline_terminals (
  airport_code text not null default 'BCN',
  -- The airline's two-character code, as in "VY1234".
  airline_iata text not null check (airline_iata ~ '^[A-Z0-9]{2}$'),
  -- Its three-letter code, which some airlines print on tickets instead ("EZY8055").
  airline_icao text check (airline_icao is null or airline_icao ~ '^[A-Z]{3}$'),
  airline_name text not null default '',
  terminal text not null check (terminal in ('T1', 'T2')),
  updated_at timestamptz not null default now(),
  primary key (airport_code, airline_iata)
);

alter table public.airline_terminals enable row level security;

-- No personal data here: any logged-in user may read it (the request form does). Only the admin
-- changes it.
drop policy if exists "Signed-in users can view airline terminals" on public.airline_terminals;
create policy "Signed-in users can view airline terminals"
  on public.airline_terminals
  for select
  to authenticated
  using (true);

drop policy if exists "Admin can manage airline terminals" on public.airline_terminals;
create policy "Admin can manage airline terminals"
  on public.airline_terminals
  for all
  to authenticated
  using ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');

insert into public.airline_terminals (airline_iata, airline_icao, airline_name, terminal)
values
  ('A3', null, 'Aegean Airlines', 'T1'),
  ('AM', null, 'Aeromexico', 'T1'),
  ('AH', null, 'Air Algérie', 'T1'),
  ('AC', null, 'Air Canada', 'T1'),
  ('CA', null, 'Air China', 'T1'),
  ('UX', null, 'Air Europa', 'T1'),
  ('AF', null, 'Air France', 'T1'),
  ('YW', null, 'Air Nostrum', 'T1'),
  ('AA', 'AAL', 'American Airlines', 'T1'),
  ('IZ', null, 'Arkia', 'T1'),
  ('OZ', null, 'Asiana Airlines', 'T1'),
  ('OS', null, 'Austrian Airlines', 'T1'),
  ('AV', null, 'Avianca', 'T1'),
  ('BA', null, 'British Airways', 'T1'),
  ('CJ', null, 'BA CityFlyer', 'T1'),
  ('SN', null, 'Brussels Airlines', 'T1'),
  ('MU', null, 'China Eastern', 'T1'),
  ('OU', null, 'Croatia Airlines', 'T1'),
  ('DL', 'DAL', 'Delta Air Lines', 'T1'),
  ('MS', null, 'Egyptair', 'T1'),
  ('LY', null, 'El Al', 'T1'),
  ('EK', null, 'Emirates', 'T1'),
  ('EY', null, 'Etihad Airways', 'T1'),
  ('AY', null, 'Finnair', 'T1'),
  ('IB', null, 'Iberia', 'T1'),
  ('AZ', null, 'ITA Airways', 'T1'),
  ('KL', null, 'KLM', 'T1'),
  ('LA', null, 'LATAM', 'T1'),
  ('JJ', 'TAM', 'LATAM Brasil', 'T1'),
  ('LO', null, 'LOT Polish Airlines', 'T1'),
  ('LH', null, 'Lufthansa', 'T1'),
  ('VL', null, 'Lufthansa City Airlines', 'T1'),
  ('QR', null, 'Qatar Airways', 'T1'),
  ('AT', null, 'Royal Air Maroc', 'T1'),
  ('RJ', null, 'Royal Jordanian', 'T1'),
  ('SV', null, 'Saudia', 'T1'),
  ('SK', null, 'SAS', 'T1'),
  ('ZH', null, 'Shenzhen Airlines', 'T1'),
  ('SQ', null, 'Singapore Airlines', 'T1'),
  ('LX', null, 'Swiss', 'T1'),
  ('TP', null, 'TAP Air Portugal', 'T1'),
  ('TU', null, 'Tunisair', 'T1'),
  ('TK', null, 'Turkish Airlines', 'T1'),
  ('UA', null, 'United Airlines', 'T1'),
  ('VY', 'VLG', 'Vueling', 'T1'),
  ('EI', null, 'Aer Lingus', 'T2'),
  ('3O', null, 'Air Arabia Maroc', 'T2'),
  ('BT', null, 'airBaltic', 'T2'),
  ('SM', null, 'Air Cairo', 'T2'),
  ('JU', null, 'Air Serbia', 'T2'),
  ('TS', null, 'Air Transat', 'T2'),
  ('X9', null, 'Avion Express', 'T2'),
  ('J2', null, 'Azerbaijan Airlines', 'T2'),
  ('BZ', null, 'Bluebird Airways', 'T2'),
  ('FB', null, 'Bulgaria Air', 'T2'),
  ('CX', null, 'Cathay Pacific', 'T2'),
  ('DE', null, 'Condor', 'T2'),
  ('CY', null, 'Cyprus Airways', 'T2'),
  ('U2', 'EZY', 'easyJet', 'T2'),
  ('EC', 'EJU', 'easyJet Europe', 'T2'),
  ('EW', 'EWG', 'Eurowings', 'T2'),
  ('5F', null, 'FlyOne', 'T2'),
  ('3F', null, 'FlyOne Armenia', 'T2'),
  ('E9', null, 'Iberojet', 'T2'),
  ('FI', null, 'Icelandair', 'T2'),
  ('B6', null, 'JetBlue', 'T2'),
  ('LS', null, 'Jet2', 'T2'),
  ('KU', null, 'Kuwait Airways', 'T2'),
  ('LG', null, 'Luxair', 'T2'),
  ('NP', null, 'Nile Air', 'T2'),
  ('DY', null, 'Norwegian', 'T2'),
  ('D8', null, 'Norwegian Air Sweden', 'T2'),
  ('BJ', null, 'Nouvelair', 'T2'),
  ('PC', null, 'Pegasus Airlines', 'T2'),
  ('FR', 'RYR', 'Ryanair', 'T2'),
  ('RK', 'RUK', 'Ryanair UK', 'T2'),
  ('S4', null, 'Azores Airlines (SATA)', 'T2'),
  ('PQ', null, 'SkyUp Airlines', 'T2'),
  ('QS', null, 'Smartwings', 'T2'),
  ('XQ', null, 'SunExpress', 'T2'),
  ('HV', 'TRA', 'Transavia', 'T2'),
  ('TO', null, 'Transavia France', 'T2'),
  ('V7', null, 'Volotea', 'T2'),
  ('WS', null, 'WestJet', 'T2'),
  ('W6', 'WZZ', 'Wizz Air', 'T2'),
  ('W4', 'WMT', 'Wizz Air Malta', 'T2'),
  ('W9', 'WUK', 'Wizz Air UK', 'T2')
on conflict (airport_code, airline_iata) do nothing;

-- 2. The ride: a third source for its terminal, and the airline operating its flight.
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.passenger_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%arrival_terminal_source%'
  loop
    execute format('alter table public.passenger_requests drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.passenger_requests
  -- 'flight': from flight data. 'airline': from airline_terminals. 'passenger': chosen in the
  -- request form.
  add constraint passenger_requests_arrival_terminal_source_check
    check (arrival_terminal_source in ('flight', 'airline', 'passenger')),
  -- The airline flying the plane, from flight data ("VY" for an Iberia number on a Vueling plane).
  add column if not exists flight_operator_iata text;

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
    new.terminal_conflict := null;
  end if;
  return new;
end;
$$;

-- 3. Flights for which flight data named another terminal than the table. Written by the flight
-- functions (service role); the admin reads them.
create table if not exists public.airline_terminal_mismatches (
  id uuid primary key default gen_random_uuid(),
  airport_code text not null default 'BCN',
  airline_iata text not null,
  flight_number text not null,
  flight_date date not null,
  table_terminal text not null check (table_terminal in ('T1', 'T2')),
  reported_terminal text not null check (reported_terminal in ('T1', 'T2')),
  created_at timestamptz not null default now(),
  -- The same flight on the same day counts once, however often it is looked up.
  unique (airline_iata, flight_number, flight_date)
);

alter table public.airline_terminal_mismatches enable row level security;

drop policy if exists "Admin can view airline terminal mismatches" on public.airline_terminal_mismatches;
create policy "Admin can view airline terminal mismatches"
  on public.airline_terminal_mismatches
  for select
  to authenticated
  using ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');

-- 4. The last lookup per flight and day (snapshot is null for a flight number flight data doesn't
-- know). Service role only: no client policies.
create table if not exists public.flight_lookups (
  flight_number text not null,
  flight_date date not null,
  fetched_at timestamptz not null default now(),
  snapshot jsonb,
  primary key (flight_number, flight_date)
);

alter table public.flight_lookups enable row level security;
