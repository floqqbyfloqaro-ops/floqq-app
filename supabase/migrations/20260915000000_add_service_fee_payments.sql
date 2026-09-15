-- FLOQQ service fee: a fixed EUR 2.49 charge per passenger once their taxi group is confirmed.
-- This is unrelated to the taxi fare split (fareSplit.ts / total_fare), which stays informational.
alter table public.passenger_requests
  add column if not exists service_fee_status text not null default 'unpaid'
    check (service_fee_status in ('unpaid', 'pending', 'paid')),
  add column if not exists stripe_checkout_session_id text,
  add column if not exists service_fee_paid_at timestamptz;

-- Only the create-service-fee-checkout and stripe-webhook Edge Functions (service role) ever
-- write these columns, so there is deliberately no user-facing update policy for them - a
-- passenger could otherwise mark their own fee as "paid" for free.

-- Passengers need to see their own group's confirmation status to know when the fee is payable.
-- The existing "Admin can manage taxi groups" policy only lets the admin account read/write groups.
create policy "Members can view their taxi group"
  on public.taxi_groups
  for select
  using (
    exists (
      select 1 from public.passenger_requests pr
      where pr.group_id = taxi_groups.id and pr.user_id = auth.uid()
    )
  );
