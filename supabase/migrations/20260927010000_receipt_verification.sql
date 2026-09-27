-- Stripe TEST-MODE payments prototype, phase 5: anti-fraud checks on the taxi receipt.
-- The payer can no longer type the amount: they photograph the receipt in the app (camera only),
-- Claude reads the total, date/time, taxi licence and receipt number from the photo
-- (_shared/receiptScan.ts), and _shared/receiptChecks.ts decides:
--   ACCEPTED     - readable, dated inside this ride's time window, not used for another ride,
--                  and not far above the estimate.
--   NEEDS_REVIEW - anything doubtful. The admin looks at the photo and approves (optionally with
--                  a corrected amount) or rejects it. Nothing is paid out on a receipt in review.
--   REJECTED     - by the admin; the payer has to photograph the right receipt.
-- Once ACCEPTED, only the admin can change it - so a correct receipt can't be swapped for an old,
-- higher one afterwards. Every photo read is logged in ride_receipt_scans for the fraud trail.
--
-- Safe to run more than once.

-- 1. Verification state on the receipt. Receipts from before this migration had a typed amount,
-- so they default to NEEDS_REVIEW.
alter table public.ride_receipts
  add column if not exists status text not null default 'NEEDS_REVIEW'
    check (status in ('ACCEPTED', 'NEEDS_REVIEW', 'REJECTED')),
  add column if not exists review_reasons text[] not null default '{}',
  -- Read from the photo.
  add column if not exists receipt_at timestamptz,
  add column if not exists taxi_licence text,
  add column if not exists receipt_number text,
  add column if not exists photo_sha256 text,
  -- 'photo' = read from the photo; 'admin' = corrected by the admin on approval.
  add column if not exists total_source text not null default 'photo' check (total_source in ('photo', 'admin')),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users (id) on delete set null,
  add column if not exists review_note text;

create index if not exists ride_receipts_status_idx on public.ride_receipts (status) where status = 'NEEDS_REVIEW';
create index if not exists ride_receipts_receipt_no_idx on public.ride_receipts (taxi_licence, receipt_number);
create index if not exists ride_receipts_photo_sha256_idx on public.ride_receipts (photo_sha256);

-- 2. Every photo the payer submits, with what was read and the verdict. Admin-only.
create table if not exists public.ride_receipt_scans (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.taxi_groups (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  photo_path text not null,
  photo_sha256 text not null,
  model text,
  -- Claude's structured reading, as returned.
  extraction jsonb,
  outcome text not null check (outcome in ('ACCEPTED', 'NEEDS_REVIEW', 'UNREADABLE', 'SCAN_FAILED', 'LOCKED')),
  reasons text[] not null default '{}',
  total_cents integer,
  receipt_at timestamptz,
  taxi_licence text,
  receipt_number text,
  created_at timestamptz not null default now()
);

create index if not exists ride_receipt_scans_group_id_idx on public.ride_receipt_scans (group_id);
create index if not exists ride_receipt_scans_receipt_no_idx on public.ride_receipt_scans (taxi_licence, receipt_number);
create index if not exists ride_receipt_scans_photo_sha256_idx on public.ride_receipt_scans (photo_sha256);

alter table public.ride_receipt_scans enable row level security;

drop policy if exists "Admin can view receipt scans" on public.ride_receipt_scans;
create policy "Admin can view receipt scans"
  on public.ride_receipt_scans
  for select
  using ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');

-- 3. Only image types Claude can read, and small enough to send (5 MB).
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'ride-receipts';

-- 4. Records a receipt, now with its verification state. p_actor 'passenger' is refused once the
-- receipt is ACCEPTED; 'admin' (approval) may overwrite. p_details: receipt_at, taxi_licence,
-- receipt_number, photo_sha256, review_reasons (array), total_source, reviewed_by, review_note.
drop function if exists public.system_record_ride_receipt(uuid, uuid, integer, text, integer, integer, integer, jsonb);

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
begin
  if p_actor not in ('passenger', 'admin') or p_status not in ('ACCEPTED', 'NEEDS_REVIEW') then
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
  if found and v_existing.status = 'ACCEPTED' and p_actor = 'passenger' then
    return jsonb_build_object('recorded', false, 'reason', 'already_accepted');
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
        -- An admin approval has no new photo or reading: keep what the photo said.
        photo_path = coalesce(excluded.photo_path, public.ride_receipts.photo_path),
        payer_share_cents = excluded.payer_share_cents,
        reimbursement_cents = excluded.reimbursement_cents,
        holds_total_cents = excluded.holds_total_cents,
        guarantee_cents = excluded.guarantee_cents,
        status = excluded.status,
        review_reasons = case when p_actor = 'admin' then public.ride_receipts.review_reasons else excluded.review_reasons end,
        receipt_at = coalesce(excluded.receipt_at, public.ride_receipts.receipt_at),
        taxi_licence = coalesce(excluded.taxi_licence, public.ride_receipts.taxi_licence),
        receipt_number = coalesce(excluded.receipt_number, public.ride_receipts.receipt_number),
        photo_sha256 = coalesce(excluded.photo_sha256, public.ride_receipts.photo_sha256),
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

-- 5. Admin rejection: the receipt stays for the record, but its shares are cleared so nothing can
-- be captured from it; the payer has to photograph the right receipt.
create or replace function public.system_reject_ride_receipt(
  p_group_id uuid,
  p_reviewer uuid,
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.ride_payments
    where group_id = p_group_id and payment_status = 'CAPTURED' and receipt_share_cents is not null
  ) then
    return jsonb_build_object('rejected', false, 'reason', 'already_captured');
  end if;

  update public.ride_receipts
  set status = 'REJECTED', reviewed_at = now(), reviewed_by = p_reviewer, review_note = p_note
  where group_id = p_group_id;
  if not found then
    return jsonb_build_object('rejected', false, 'reason', 'no_receipt');
  end if;

  update public.ride_payments
  set receipt_share_cents = null, final_share_cents = null, guarantee_cents = 0
  where group_id = p_group_id and payment_status <> 'CAPTURED';

  return jsonb_build_object('rejected', true);
end;
$$;

revoke all on function public.system_reject_ride_receipt(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.system_reject_ride_receipt(uuid, uuid, text) to service_role;
