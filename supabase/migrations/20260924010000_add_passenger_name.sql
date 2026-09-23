-- The admin's group-creation list identified passengers by flight number, which collides whenever
-- two passengers on the same flight submit separate ride requests. Nullable (not backfilled) -
-- existing requests predate name collection at sign-up, so the app falls back to flight_number
-- for any row where this is still null.
alter table public.passenger_requests
  add column if not exists passenger_name text;
