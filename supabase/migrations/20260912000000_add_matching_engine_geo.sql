create extension if not exists postgis;

alter table public.passenger_requests
  add column if not exists destination_lat double precision,
  add column if not exists destination_lng double precision;

alter table public.passenger_requests
  add column if not exists destination_geog geography(Point, 4326)
    generated always as (
      case
        when destination_lat is not null and destination_lng is not null
          then ST_SetSRID(ST_MakePoint(destination_lng, destination_lat), 4326)::geography
        else null
      end
    ) stored;

create index if not exists passenger_requests_destination_geog_idx
  on public.passenger_requests using gist (destination_geog);

-- Returns other pending requests whose destination lies within p_corridor_meters of the
-- straight line from the airport to p_request_id's destination (the "same corridor" filter).
create or replace function public.match_corridor_candidates(
  p_request_id uuid,
  p_airport_lat double precision,
  p_airport_lng double precision,
  p_corridor_meters double precision default 3000
)
returns setof public.passenger_requests
language sql
stable
as $$
  with target as (
    select destination_geog
    from public.passenger_requests
    where id = p_request_id
  ),
  route_line as (
    select ST_MakeLine(
      ST_SetSRID(ST_MakePoint(p_airport_lng, p_airport_lat), 4326),
      (select destination_geog::geometry from target)
    )::geography as geog
  )
  select pr.*
  from public.passenger_requests pr
  where pr.id <> p_request_id
    and pr.status = 'pending'
    and pr.destination_geog is not null
    and (select geog from route_line) is not null
    and ST_DWithin(pr.destination_geog, (select geog from route_line), p_corridor_meters);
$$;

grant execute on function public.match_corridor_candidates(uuid, double precision, double precision, double precision)
  to authenticated;
