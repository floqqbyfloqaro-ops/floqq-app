alter table public.passenger_requests
  add column if not exists distance_km numeric check (distance_km is null or distance_km > 0);

alter table public.taxi_groups
  add column if not exists total_fare numeric check (total_fare is null or total_fare > 0);
