alter table public.passenger_requests
  add column if not exists large_luggage_count integer not null default 0 check (large_luggage_count in (0, 1)),
  add column if not exists hand_luggage_count integer not null default 1 check (hand_luggage_count between 0 and 2);

-- Best-effort split of the old single count: anything beyond 2 bags is assumed to include one
-- large piece, since the old model can't tell us which bags were large vs. hand luggage.
update public.passenger_requests
set
  hand_luggage_count = least(bags_count, 2),
  large_luggage_count = case when bags_count > 2 then 1 else 0 end
where bags_count is not null;

alter table public.passenger_requests drop column bags_count;

alter table public.passenger_requests
  add column bags_count integer generated always as (large_luggage_count + hand_luggage_count) stored;
