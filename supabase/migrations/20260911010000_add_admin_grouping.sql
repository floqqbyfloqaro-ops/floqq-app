create table if not exists public.taxi_groups (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.taxi_groups enable row level security;

create policy "Admin can manage taxi groups"
  on public.taxi_groups
  for all
  using ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');

alter table public.passenger_requests
  add column if not exists status text not null default 'pending' check (status in ('pending', 'matched')),
  add column if not exists group_id uuid references public.taxi_groups (id) on delete set null;

create policy "Admin can view all passenger requests"
  on public.passenger_requests
  for select
  using ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');

create policy "Admin can update passenger requests for grouping"
  on public.passenger_requests
  for update
  using ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');
