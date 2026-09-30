-- Stripe TEST-MODE payments prototype, phase 6: capture the passengers' shares and reimburse the
-- payer. Separate charges and transfers:
--   1. Once a receipt is ACCEPTED, the passengers have a dispute window (DISPUTE_WINDOW_HOURS,
--      default 2, see _shared/settlementMath.ts) before anything is charged. settle_after is when
--      it ends - never later than an hour before the first hold expires.
--   2. Then payments-settle-rides captures each member's hold on FLOQQ's own Stripe account: the
--      share + the FLOQQ fee (only the fee for the payer); capturing less than the hold releases
--      the rest. The receipt is locked from the moment this starts.
--   3. The payer gets one transfer per captured passenger, each tied to that passenger's charge
--      (source_transaction - it only moves once that charge's money is available), plus one
--      transfer from FLOQQ's own balance for whatever the captures don't cover (the Ride Payment
--      Guarantee, or a capture that failed). A payer without a finished payout account waits:
--      the transfers go out as soon as Stripe activates it.
--
-- Safe to run more than once.

-- 1. Settlement timing on the receipt.
alter table public.ride_receipts
  -- End of the dispute window; null while the receipt isn't ACCEPTED.
  add column if not exists settle_after timestamptz,
  -- Set when capturing starts; from then on the receipt can't change.
  add column if not exists settlement_started_at timestamptz,
  -- Every member's hold has been captured (or failed to be).
  add column if not exists settled_at timestamptz;

create index if not exists ride_receipts_settle_idx on public.ride_receipts (settle_after)
  where status = 'ACCEPTED' and settled_at is null;

-- A receipt that is being settled can't be corrected, re-photographed or rejected any more:
-- system_record_ride_receipt and system_reject_ride_receipt fail on it as a whole.
create or replace function public.lock_settled_ride_receipt()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.settlement_started_at is not null and (
    new.total_cents is distinct from old.total_cents
    or new.status is distinct from old.status
    or new.payer_request_id is distinct from old.payer_request_id
    or new.payer_share_cents is distinct from old.payer_share_cents
    or new.reimbursement_cents is distinct from old.reimbursement_cents
    or new.guarantee_cents is distinct from old.guarantee_cents
  ) then
    raise exception 'receipt of group % is being settled and can no longer change', old.group_id using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists ride_receipts_lock_settled on public.ride_receipts;
create trigger ride_receipts_lock_settled
  before update on public.ride_receipts
  for each row execute function public.lock_settled_ride_receipt();

-- 2. What happened to each passenger's hold. The passenger reads these on My ride.
alter table public.ride_payments
  -- The accepted receipt's total and when the cards are charged, copied here so every passenger
  -- can see them (only the payer can read ride_receipts).
  add column if not exists taxi_total_cents integer check (taxi_total_cents is null or taxi_total_cents > 0),
  add column if not exists charge_at timestamptz,
  -- Actually captured (share + fee) and released from the hold.
  add column if not exists captured_cents integer check (captured_cents is null or captured_cents >= 0),
  add column if not exists released_cents integer check (released_cents is null or released_cents >= 0),
  add column if not exists stripe_charge_id text,
  -- The transfer of this passenger's share to the payer (from stripe_charge_id).
  add column if not exists payer_transfer_id text,
  -- The one "your ride is paid" notification.
  add column if not exists settled_notified_at timestamptz;

-- 3. The payer's reimbursement, one per group.
create table if not exists public.ride_payouts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid unique references public.taxi_groups (id) on delete set null,
  payer_request_id uuid references public.passenger_requests (id) on delete set null,
  payer_user_id uuid references auth.users (id) on delete set null,
  -- Taxi total minus the payer's own share.
  amount_cents integer not null check (amount_cents >= 0),
  -- The part transferred from the passengers' charges, and the part FLOQQ pays itself.
  from_captures_cents integer not null default 0 check (from_captures_cents >= 0),
  guarantee_cents integer not null default 0 check (guarantee_cents >= 0),
  transferred_cents integer not null default 0 check (transferred_cents >= 0),
  status text not null default 'PENDING'
    check (status in ('WAITING_FOR_PAYOUT_SETUP', 'PENDING', 'SENT')),
  stripe_account_id text,
  stripe_transfer_group text,
  guarantee_transfer_id text,
  -- Numbers each run that tried to transfer, so a retry after a refusal gets a fresh idempotency key.
  transfer_attempts integer not null default 0 check (transfer_attempts >= 0),
  failure_reason text,
  sent_at timestamptz,
  waiting_notified_at timestamptz,
  sent_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_captures_cents + guarantee_cents = amount_cents),
  check (transferred_cents <= amount_cents)
);

drop trigger if exists ride_payouts_updated_at on public.ride_payouts;
create trigger ride_payouts_updated_at
  before update on public.ride_payouts
  for each row execute function public.set_payments_updated_at();

alter table public.ride_payouts enable row level security;

drop policy if exists "Payer can view their payouts" on public.ride_payouts;
create policy "Payer can view their payouts"
  on public.ride_payouts
  for select
  using (auth.uid() = payer_user_id);

drop policy if exists "Admin can view all payouts" on public.ride_payouts;
create policy "Admin can view all payouts"
  on public.ride_payouts
  for select
  using ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');

-- 4. Starts settling a group: only when the receipt is ACCEPTED, its dispute window is over and
-- the group is still confirmed. Locks the receipt (settlement_started_at). Service role only
-- (payments-settle-rides); safe to call again - a group that already started just says so.
create or replace function public.system_begin_ride_settlement(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
  v_receipt public.ride_receipts%rowtype;
begin
  select * into v_group from public.taxi_groups where id = p_group_id for update;
  if not found then
    return jsonb_build_object('started', false, 'reason', 'group_not_found');
  end if;

  select * into v_receipt from public.ride_receipts where group_id = p_group_id for update;
  if not found then
    return jsonb_build_object('started', false, 'reason', 'no_receipt');
  end if;
  -- Carries on whatever happens to the group afterwards (passengers closing the finished ride).
  if v_receipt.settlement_started_at is not null then
    return jsonb_build_object('started', true, 'reason', 'already_started');
  end if;
  if v_group.status <> 'confirmed' then
    return jsonb_build_object('started', false, 'reason', 'group_not_confirmed');
  end if;
  if v_receipt.status <> 'ACCEPTED' or v_receipt.settle_after is null or v_receipt.settle_after > now() then
    return jsonb_build_object('started', false, 'reason', 'not_due');
  end if;
  if v_receipt.payer_request_id is distinct from v_group.payer_request_id then
    return jsonb_build_object('started', false, 'reason', 'payer_changed');
  end if;

  update public.ride_receipts set settlement_started_at = now() where id = v_receipt.id;
  return jsonb_build_object('started', true);
end;
$$;

revoke all on function public.system_begin_ride_settlement(uuid) from public, anon, authenticated;
grant execute on function public.system_begin_ride_settlement(uuid) to service_role;

-- 5. Overlap guard for the settlement job, same lock table as the other scheduled jobs.
insert into public.match_engine_lock (id, locked_at)
values (4, null)
on conflict (id) do nothing;

-- 6. Every 5 minutes: settle rides whose dispute window is over, and retry reimbursements that
-- are still waiting (payout setup, or money not yet available). Same Vault secrets as the other
-- jobs; the function does nothing while PAYMENTS_ENABLED is off.
select cron.schedule(
  'payments-settle-rides',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/payments-settle-rides',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
