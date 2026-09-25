-- Stripe TEST-MODE payments prototype (Option A), phase 1: data model only.
-- Each passenger's share (+ the FLOQQ platform fee + a buffer) is pre-authorized as a card hold,
-- the designated payer pays the taxi, then FLOQQ captures each final share and reimburses the payer
-- via Stripe Connect. Nothing reads or writes these tables until PAYMENTS_ENABLED is switched on in
-- a later phase - the existing service-fee Checkout flow (20260915000000) is untouched.
--
-- All amounts are integer cents, currency EUR. Only Edge Functions (service role) write here;
-- passengers can only read their own rows, the admin can read everything.

-- 1. Per-user Stripe details. No card data is ever stored - default_payment_method_id is only
-- Stripe's opaque pm_... reference to a card Stripe itself holds.
create table if not exists public.user_payment_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  has_default_payment_method boolean not null default false,
  default_payment_method_id text,
  stripe_connect_account_id text unique,
  payout_onboarding_status text not null default 'NOT_STARTED'
    check (payout_onboarding_status in ('NOT_STARTED', 'PENDING', 'COMPLETE', 'RESTRICTED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (has_default_payment_method = (default_payment_method_id is not null))
);

-- 2. One row per passenger per group. request_id/group_id/user_id are set null (not cascaded) on
-- delete so money history survives the stale-request cleanup job or a deleted test user.
create table if not exists public.ride_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.passenger_requests (id) on delete set null,
  group_id uuid references public.taxi_groups (id) on delete set null,
  user_id uuid references auth.users (id) on delete set null,
  estimated_share_cents integer not null check (estimated_share_cents >= 0),
  platform_fee_cents integer not null default 249 check (platform_fee_cents >= 0),
  -- estimated share + platform fee + buffer (25%, min EUR 5) - Stripe can never capture more than this.
  hold_amount_cents integer not null,
  final_share_cents integer check (final_share_cents is null or final_share_cents >= 0),
  currency text not null default 'eur' check (currency = 'eur'),
  stripe_payment_intent_id text unique,
  payment_status text not null default 'NOT_STARTED'
    check (payment_status in (
      'NOT_STARTED', 'HOLD_PENDING_AUTH', 'HOLD_PLACED', 'HOLD_FAILED',
      'CAPTURED', 'RELEASED', 'CAPTURE_FAILED', 'REFUNDED'
    )),
  -- Set by whoever changes payment_status, and copied into payment_events by the trigger below.
  last_status_actor text not null default 'system'
    check (last_status_actor in ('passenger', 'admin', 'system', 'stripe')),
  failure_reason text,
  hold_placed_at timestamptz,
  captured_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, group_id),
  check (hold_amount_cents >= estimated_share_cents + platform_fee_cents),
  check (final_share_cents is null or final_share_cents + platform_fee_cents <= hold_amount_cents)
);

create index if not exists ride_payments_group_id_idx on public.ride_payments (group_id);
create index if not exists ride_payments_user_id_idx on public.ride_payments (user_id);

-- 3. Payment audit trail - one row per payment_status change, written by the trigger below so no
-- code path can forget it. on delete restrict: a payment with history can't be deleted.
create table if not exists public.payment_events (
  id uuid primary key default gen_random_uuid(),
  ride_payment_id uuid not null references public.ride_payments (id) on delete restrict,
  request_id uuid,
  group_id uuid,
  user_id uuid,
  from_status text,
  to_status text not null,
  actor_type text not null check (actor_type in ('passenger', 'admin', 'system', 'stripe')),
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists payment_events_ride_payment_id_idx on public.payment_events (ride_payment_id);

-- 4. Stripe webhook events already processed - Stripe may deliver the same event more than once,
-- so the webhook records each id here first and skips it if it's already present. livemode must
-- be false: a second, database-level refusal of anything that isn't TEST mode.
create table if not exists public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  livemode boolean not null check (livemode = false),
  received_at timestamptz not null default now()
);

-- updated_at bookkeeping.
create or replace function public.set_payments_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_payment_profiles_updated_at on public.user_payment_profiles;
create trigger user_payment_profiles_updated_at
  before update on public.user_payment_profiles
  for each row execute function public.set_payments_updated_at();

drop trigger if exists ride_payments_updated_at on public.ride_payments;
create trigger ride_payments_updated_at
  before update on public.ride_payments
  for each row execute function public.set_payments_updated_at();

-- Audit trigger: logs creation and every payment_status change into payment_events.
create or replace function public.log_ride_payment_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' or new.payment_status is distinct from old.payment_status then
    insert into public.payment_events (
      ride_payment_id, request_id, group_id, user_id, from_status, to_status, actor_type, details
    )
    values (
      new.id, new.request_id, new.group_id, new.user_id,
      case when tg_op = 'INSERT' then null else old.payment_status end,
      new.payment_status,
      new.last_status_actor,
      jsonb_strip_nulls(jsonb_build_object(
        'stripe_payment_intent_id', new.stripe_payment_intent_id,
        'hold_amount_cents', new.hold_amount_cents,
        'final_share_cents', new.final_share_cents,
        'failure_reason', new.failure_reason
      ))
    );
  end if;
  return new;
end;
$$;

drop trigger if exists ride_payments_log_status on public.ride_payments;
create trigger ride_payments_log_status
  after insert or update on public.ride_payments
  for each row execute function public.log_ride_payment_status_change();

-- Row level security: read-only for the owner and the admin, no client write policies at all -
-- only the service role (Edge Functions) writes, so nobody can mark their own payment as paid.
alter table public.user_payment_profiles enable row level security;
alter table public.ride_payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.stripe_webhook_events enable row level security;

create policy "Users can view their own payment profile"
  on public.user_payment_profiles
  for select
  using (auth.uid() = user_id);

create policy "Admin can view all payment profiles"
  on public.user_payment_profiles
  for select
  using ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');

create policy "Users can view their own ride payments"
  on public.ride_payments
  for select
  using (auth.uid() = user_id);

create policy "Admin can view all ride payments"
  on public.ride_payments
  for select
  using ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');

-- payment_events and stripe_webhook_events: admin-only reads, same as group_events being internal.
create policy "Admin can view payment events"
  on public.payment_events
  for select
  using ((auth.jwt() ->> 'email') = 'floqqbyfloqaro@gmail.com');
