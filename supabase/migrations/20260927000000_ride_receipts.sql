-- Stripe TEST-MODE payments prototype, phase 5 (prototype version): the taxi receipt.
-- After the ride the designated payer (20260926030000_designated_payer.sql) enters the real taxi
-- total, optionally with a photo of the receipt. Each passenger's final share is the existing
-- distance-proportional fare split of that total (_shared/fareSplit.ts); the settlement rules are
-- in _shared/receiptMath.ts. Nothing is captured or paid out yet - that's a later phase, which
-- must lock the receipt once it starts capturing.
--
-- The Ride Payment Guarantee: Stripe can never capture more than a hold, so the part of someone's
-- share their hold can't cover is paid by FLOQQ. guarantee_used flags that to the admin.
--
-- Safe to run more than once.

-- 1. One receipt per group. group_id is set null (not cascaded) on delete, like ride_payments,
-- so money history survives.
create table if not exists public.ride_receipts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid unique references public.taxi_groups (id) on delete set null,
  payer_request_id uuid references public.passenger_requests (id) on delete set null,
  payer_user_id uuid references auth.users (id) on delete set null,
  total_cents integer not null check (total_cents > 0),
  currency text not null default 'eur' check (currency = 'eur'),
  -- Object path in the private ride-receipts bucket: '<group_id>/<file>'.
  photo_path text,
  -- The payer's own share of total_cents (paid straight to the taxi, never captured).
  payer_share_cents integer not null check (payer_share_cents >= 0),
  -- What the payer gets back: total_cents - payer_share_cents.
  reimbursement_cents integer not null check (reimbursement_cents >= 0),
  -- Sum of every member's placed hold when the receipt was entered, fees and buffers included.
  holds_total_cents integer not null check (holds_total_cents >= 0),
  -- The part of the others' shares their holds can't cover, paid by FLOQQ.
  guarantee_cents integer not null default 0 check (guarantee_cents >= 0),
  guarantee_used boolean generated always as (guarantee_cents > 0) stored,
  -- Corrections by the payer overwrite the amounts; this counts them.
  submission_count integer not null default 1 check (submission_count >= 1),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reimbursement_cents = total_cents - payer_share_cents)
);

create index if not exists ride_receipts_guarantee_used_idx on public.ride_receipts (guarantee_used) where guarantee_used;

drop trigger if exists ride_receipts_updated_at on public.ride_receipts;
create trigger ride_receipts_updated_at
  before update on public.ride_receipts
  for each row execute function public.set_payments_updated_at();

-- 2. Each passenger's part of the receipt, next to their hold. final_share_cents (phase 1) is the
-- part of the share to capture from the hold on top of the platform fee - always 0 for the payer.
alter table public.ride_payments
  add column if not exists receipt_share_cents integer check (receipt_share_cents is null or receipt_share_cents >= 0),
  add column if not exists guarantee_cents integer not null default 0 check (guarantee_cents >= 0);

-- 3. Read-only for the payer and the admin; only payments-submit-receipt (service role) writes.
alter table public.ride_receipts enable row level security;

drop policy if exists "Payer can view their group's receipt" on public.ride_receipts;
create policy "Payer can view their group's receipt"
  on public.ride_receipts
  for select
  using (auth.uid() = payer_user_id);

drop policy if exists "Admin can view all receipts" on public.ride_receipts;
create policy "Admin can view all receipts"
  on public.ride_receipts
  for select
  using ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');

-- 4. Private bucket for receipt photos. The payer uploads straight from the app into their
-- group's folder; the admin can read everything. Nobody can overwrite or delete a photo.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ride-receipts', 'ride-receipts', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Payer can upload their group's receipt photo" on storage.objects;
create policy "Payer can upload their group's receipt photo"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'ride-receipts'
    and exists (
      select 1 from public.taxi_groups g
      where g.id::text = (storage.foldername(name))[1]
        and g.status = 'confirmed'
        and g.payer_user_id = auth.uid()
    )
  );

drop policy if exists "Payer can view their group's receipt photos" on storage.objects;
create policy "Payer can view their group's receipt photos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'ride-receipts'
    and exists (
      select 1 from public.taxi_groups g
      where g.id::text = (storage.foldername(name))[1]
        and g.payer_user_id = auth.uid()
    )
  );

drop policy if exists "Admin can view receipt photos" on storage.objects;
create policy "Admin can view receipt photos"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'ride-receipts' and (auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');

-- 5. Records (or corrects) a receipt and every member's part of it in one transaction.
-- p_shares: [{ "request_id", "receipt_share_cents", "capture_share_cents", "guarantee_cents" }],
-- computed by settleReceipt() in _shared/receiptMath.ts. Refused once any member's share has been
-- captured. Service role only (payments-submit-receipt).
create or replace function public.system_record_ride_receipt(
  p_group_id uuid,
  p_payer_request_id uuid,
  p_total_cents integer,
  p_photo_path text,
  p_payer_share_cents integer,
  p_holds_total_cents integer,
  p_guarantee_cents integer,
  p_shares jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
  v_share jsonb;
  v_receipt_id uuid;
begin
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

  insert into public.ride_receipts (
    group_id, payer_request_id, payer_user_id, total_cents, photo_path, payer_share_cents,
    reimbursement_cents, holds_total_cents, guarantee_cents
  )
  values (
    p_group_id, p_payer_request_id, v_group.payer_user_id, p_total_cents, p_photo_path, p_payer_share_cents,
    p_total_cents - p_payer_share_cents, p_holds_total_cents, p_guarantee_cents
  )
  on conflict (group_id) do update
    set payer_request_id = excluded.payer_request_id,
        payer_user_id = excluded.payer_user_id,
        total_cents = excluded.total_cents,
        -- A correction without a new photo keeps the earlier one.
        photo_path = coalesce(excluded.photo_path, public.ride_receipts.photo_path),
        payer_share_cents = excluded.payer_share_cents,
        reimbursement_cents = excluded.reimbursement_cents,
        holds_total_cents = excluded.holds_total_cents,
        guarantee_cents = excluded.guarantee_cents,
        submission_count = public.ride_receipts.submission_count + 1,
        submitted_at = now()
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

revoke all on function public.system_record_ride_receipt(uuid, uuid, integer, text, integer, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.system_record_ride_receipt(uuid, uuid, integer, text, integer, integer, integer, jsonb) to service_role;
