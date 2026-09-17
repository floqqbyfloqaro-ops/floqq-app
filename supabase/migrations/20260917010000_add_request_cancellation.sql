-- Widen the status check constraint to allow cancellation. The constraint was created inline
-- with an auto-generated name, so find it dynamically instead of guessing it.
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.passenger_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.passenger_requests drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.passenger_requests
  add constraint passenger_requests_status_check check (status in ('pending', 'matched', 'cancelled'));

-- Previously only the admin could update passenger_requests. Passengers need to be able to
-- cancel their own request, but this policy is scoped to only ever land on status = 'cancelled'
-- rather than opening up unrestricted self-editing of the row.
create policy "Users can cancel their own passenger requests"
  on public.passenger_requests
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and status = 'cancelled');
