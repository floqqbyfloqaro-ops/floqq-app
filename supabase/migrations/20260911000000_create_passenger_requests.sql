create extension if not exists pgcrypto;

create table if not exists public.passenger_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  flight_number text not null,
  arrival_at timestamptz not null,
  destination_address text not null,
  bags_count integer not null check (bags_count >= 0),
  max_wait_minutes integer not null check (max_wait_minutes >= 0),
  created_at timestamptz not null default now()
);

alter table public.passenger_requests enable row level security;

create policy "Users can insert their own passenger requests"
  on public.passenger_requests
  for insert
  with check (auth.uid() = user_id);

create policy "Users can view their own passenger requests"
  on public.passenger_requests
  for select
  using (auth.uid() = user_id);
