-- Stripe TEST-MODE payments prototype, phase 7: failure handling.
--   1. A hold that can't be captured (capture failed, or the hold expired first): FLOQQ still pays
--      the payer in full (Ride Payment Guarantee), and what the passenger didn't pay is recorded as
--      outstanding on their ride payment, for the admin - who can charge the saved card again or
--      write it off (payments-admin-actions).
--   2. Cancelling after confirmation: free (whole hold released) up to FREE_CANCELLATION_HOURS
--      before the ride - free_cancel_until - and the FLOQQ fee is kept after that.
--   3. A payer who never sends a receipt: reminders, then at receipt_deadline_at FLOQQ records an
--      ESTIMATED receipt from the group's estimated fare and settles it like any other. The
--      payer's payout from an estimate waits for the admin (HELD_FOR_REVIEW). A real receipt sent
--      before the capture still replaces the estimate.
--   4. Webhooks: a capture Stripe confirms before FLOQQ's own bookkeeping finished is recorded
--      from the webhook (_shared/holdMath.ts holdTransition) - no schema change needed.
--
-- Safe to run more than once.

-- 1. Outstanding amounts, free cancellation, estimated totals - per ride payment.
alter table public.ride_payments
  add column if not exists outstanding_cents integer check (outstanding_cents is null or outstanding_cents >= 0),
  add column if not exists outstanding_reason text,
  add column if not exists outstanding_since timestamptz,
  add column if not exists outstanding_resolved_at timestamptz,
  add column if not exists outstanding_resolution text
    check (outstanding_resolution is null or outstanding_resolution in ('recharged', 'written_off')),
  add column if not exists outstanding_note text,
  -- Charging the saved card again for the outstanding amount (off-session).
  add column if not exists recharge_attempts integer not null default 0 check (recharge_attempts >= 0),
  add column if not exists recharge_payment_intent_id text,
  add column if not exists free_cancel_until timestamptz,
  -- taxi_total_cents is the group's estimate, not a receipt.
  add column if not exists taxi_total_is_estimate boolean not null default false;

create index if not exists ride_payments_outstanding_idx on public.ride_payments (outstanding_since)
  where outstanding_cents > 0 and outstanding_resolved_at is null;

-- 2. The payer's receipt deadline and its reminders, per group.
alter table public.taxi_groups
  add column if not exists receipt_deadline_at timestamptz,
  add column if not exists receipt_reminder_sent_at timestamptz,
  add column if not exists receipt_final_reminder_sent_at timestamptz;

-- 3. ESTIMATED receipts (the fallback). Constraints were added inline, so found by definition.
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.ride_receipts'::regclass
      and contype = 'c'
      and (pg_get_constraintdef(oid) ilike '%NEEDS_REVIEW%' or pg_get_constraintdef(oid) ilike '%total_source%')
  loop
    execute format('alter table public.ride_receipts drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.ride_receipts
  add constraint ride_receipts_status_check check (status in ('ACCEPTED', 'NEEDS_REVIEW', 'REJECTED', 'ESTIMATED')),
  add constraint ride_receipts_total_source_check check (total_source in ('photo', 'admin', 'estimate'));

drop index if exists public.ride_receipts_settle_idx;
create index if not exists ride_receipts_settle_idx on public.ride_receipts (settle_after)
  where status in ('ACCEPTED', 'ESTIMATED') and settled_at is null;

-- 4. A payout from an estimate waits for the admin.
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.ride_payouts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%WAITING_FOR_PAYOUT_SETUP%'
  loop
    execute format('alter table public.ride_payouts drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.ride_payouts
  add constraint ride_payouts_status_check
    check (status in ('WAITING_FOR_PAYOUT_SETUP', 'PENDING', 'SENT', 'HELD_FOR_REVIEW')),
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users (id) on delete set null;

-- 5. system_record_ride_receipt, now also for the fallback: p_actor 'system' may only record an
-- ESTIMATED receipt, and only where there is none yet or the last one was REJECTED. A passenger
-- (a real photo) may replace an ESTIMATED one until capturing starts. Otherwise unchanged from
-- 20260927010000_receipt_verification.sql.
create or replace function public.system_record_ride_receipt(
  p_group_id uuid,
  p_payer_request_id uuid,
  p_total_cents integer,
  p_photo_path text,
  p_payer_share_cents integer,
  p_holds_total_cents integer,
  p_guarantee_cents integer,
  p_shares jsonb,
  p_status text,
  p_details jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
  v_existing public.ride_receipts%rowtype;
  v_share jsonb;
  v_receipt_id uuid;
  v_is_system boolean := p_actor = 'system';
begin
  if p_actor not in ('passenger', 'admin', 'system')
     or p_status not in ('ACCEPTED', 'NEEDS_REVIEW', 'ESTIMATED')
     or (p_status = 'ESTIMATED') <> v_is_system then
    raise exception 'invalid actor or status' using errcode = '22023';
  end if;

  select * into v_group from public.taxi_groups where id = p_group_id for update;
  if not found or v_group.status <> 'confirmed' then
    return jsonb_build_object('recorded', false, 'reason', 'group_not_confirmed');
  end if;
  if v_group.payer_request_id is distinct from p_payer_request_id then
    return jsonb_build_object('recorded', false, 'reason', 'not_payer');
  end if;

  if exists (
    select 1 from public.ride_payments rp
    join public.passenger_requests r on r.id = rp.request_id and r.group_id = p_group_id
    where rp.group_id = p_group_id and rp.payment_status = 'CAPTURED'
  ) then
    return jsonb_build_object('recorded', false, 'reason', 'already_captured');
  end if;

  select * into v_existing from public.ride_receipts where group_id = p_group_id for update;
  if found and v_existing.settlement_started_at is not null then
    return jsonb_build_object('recorded', false, 'reason', 'already_captured');
  end if;
  if found and v_existing.status = 'ACCEPTED' and p_actor = 'passenger' then
    return jsonb_build_object('recorded', false, 'reason', 'already_accepted');
  end if;
  if found and v_is_system and v_existing.status <> 'REJECTED' then
    return jsonb_build_object('recorded', false, 'reason', 'receipt_exists');
  end if;

  insert into public.ride_receipts (
    group_id, payer_request_id, payer_user_id, total_cents, photo_path, payer_share_cents,
    reimbursement_cents, holds_total_cents, guarantee_cents, status, review_reasons,
    receipt_at, taxi_licence, receipt_number, photo_sha256, total_source,
    reviewed_at, reviewed_by, review_note
  )
  values (
    p_group_id, p_payer_request_id, v_group.payer_user_id, p_total_cents, p_photo_path, p_payer_share_cents,
    p_total_cents - p_payer_share_cents, p_holds_total_cents, p_guarantee_cents, p_status,
    coalesce(array(select jsonb_array_elements_text(p_details -> 'review_reasons')), '{}'),
    (p_details ->> 'receipt_at')::timestamptz, p_details ->> 'taxi_licence', p_details ->> 'receipt_number',
    p_details ->> 'photo_sha256', coalesce(p_details ->> 'total_source', 'photo'),
    case when p_actor = 'admin' then now() end,
    case when p_actor = 'admin' then (p_details ->> 'reviewed_by')::uuid end,
    case when p_actor = 'admin' then p_details ->> 'review_note' end
  )
  on conflict (group_id) do update
    set payer_request_id = excluded.payer_request_id,
        payer_user_id = excluded.payer_user_id,
        total_cents = excluded.total_cents,
        -- An admin approval has no new photo or reading: keep what the photo said. An estimate
        -- replaces a rejected receipt entirely.
        photo_path = case when v_is_system then null else coalesce(excluded.photo_path, public.ride_receipts.photo_path) end,
        payer_share_cents = excluded.payer_share_cents,
        reimbursement_cents = excluded.reimbursement_cents,
        holds_total_cents = excluded.holds_total_cents,
        guarantee_cents = excluded.guarantee_cents,
        status = excluded.status,
        review_reasons = case when p_actor = 'admin' then public.ride_receipts.review_reasons else excluded.review_reasons end,
        receipt_at = case when v_is_system then null else coalesce(excluded.receipt_at, public.ride_receipts.receipt_at) end,
        taxi_licence = case when v_is_system then null else coalesce(excluded.taxi_licence, public.ride_receipts.taxi_licence) end,
        receipt_number = case when v_is_system then null else coalesce(excluded.receipt_number, public.ride_receipts.receipt_number) end,
        photo_sha256 = case when v_is_system then null else coalesce(excluded.photo_sha256, public.ride_receipts.photo_sha256) end,
        total_source = excluded.total_source,
        reviewed_at = excluded.reviewed_at,
        reviewed_by = excluded.reviewed_by,
        review_note = excluded.review_note,
        submission_count = public.ride_receipts.submission_count + case when p_actor = 'passenger' then 1 else 0 end,
        submitted_at = case when p_actor = 'passenger' then now() else public.ride_receipts.submitted_at end
  returning id into v_receipt_id;

  for v_share in select * from jsonb_array_elements(p_shares)
  loop
    update public.ride_payments
    set receipt_share_cents = (v_share ->> 'receipt_share_cents')::integer,
        final_share_cents = (v_share ->> 'capture_share_cents')::integer,
        guarantee_cents = (v_share ->> 'guarantee_cents')::integer
    where request_id = (v_share ->> 'request_id')::uuid and group_id = p_group_id;
  end loop;

  return jsonb_build_object('recorded', true, 'receipt_id', v_receipt_id);
end;
$$;

revoke all on function public.system_record_ride_receipt(uuid, uuid, integer, text, integer, integer, integer, jsonb, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.system_record_ride_receipt(uuid, uuid, integer, text, integer, integer, integer, jsonb, text, jsonb, text) to service_role;

-- 6. Settling now also starts from an ESTIMATED receipt. Otherwise unchanged from
-- 20260930000000_capture_and_reimburse.sql.
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
  if v_receipt.status not in ('ACCEPTED', 'ESTIMATED') or v_receipt.settle_after is null or v_receipt.settle_after > now() then
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
