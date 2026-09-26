-- Stripe TEST-MODE payments prototype, phase 4: the designated payer + payout onboarding.
-- The payer is the passenger whose stop is the last one on the route - the only one still in the
-- taxi when the meter stops. They pay the taxi, and FLOQQ reimburses them from the other
-- passengers' captured shares via Stripe Connect (a later phase). The payer's own seat
-- reservation works like everyone's, but only the platform fee is captured from it.
--
-- Chosen when the group is confirmed and then kept (locked), by payments-sync-holds. The drop-off
-- order itself isn't stored, but passenger_requests.distance_km is each passenger's cumulative
-- distance along that order, so the last stop is the member with the largest distance_km.
--
-- Payout setup is not a deadline before the ride (agreed "pay now, set up later"): FLOQQ keeps
-- the reimbursement until the payer finishes Stripe's onboarding. A payer who says they can't pay
-- the taxi can hand the role back; it's then offered to the rest of the group and the first
-- passenger to accept takes it.

-- 1. The payer, per group.
alter table public.taxi_groups
  add column if not exists payer_request_id uuid references public.passenger_requests (id) on delete set null,
  add column if not exists payer_user_id uuid references auth.users (id) on delete set null,
  -- 'assigned': payer_request_id pays. 'open': the payer handed the role back and nobody has
  -- taken it yet. Null: no payer chosen yet (group not confirmed, or payments off).
  add column if not exists payer_status text check (payer_status in ('assigned', 'open')),
  add column if not exists payer_assigned_at timestamptz,
  -- Members who handed the role back - never picked automatically again for this group.
  add column if not exists payer_declined_request_ids uuid[] not null default '{}',
  -- One "set up your payout" reminder per assignment (payments-sync-holds).
  add column if not exists payer_reminder_sent_at timestamptz;

-- 2. Whether the payer has sent their details to Stripe (then Stripe may still be verifying them).
alter table public.user_payment_profiles
  add column if not exists payout_details_submitted boolean not null default false;

-- 3. Payer changes go into the group's audit trail.
do $$
declare
  con record;
begin
  for con in
    select conname from pg_constraint
    where conrelid = 'public.group_events'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%event_type%'
  loop
    execute format('alter table public.group_events drop constraint %I', con.conname);
  end loop;
end $$;

alter table public.group_events
  add constraint group_events_event_type_check
  check (event_type in (
    'member_removed', 'member_added', 'group_recalculated', 'group_dissolved', 'ride_requeued',
    'ride_expired', 'ride_cancelled', 'payer_assigned', 'payer_declined', 'payer_volunteered'
  ));

-- 4. Keeps a confirmed group's payer valid. A payer who is still a member is kept (locked), and
-- an 'open' role stays open until someone takes it. Otherwise (first run after confirmation, or
-- the payer left the group) the member with the last stop who hasn't handed the role back is
-- picked; if everyone has, the role is left open. Service role only (payments-sync-holds).
-- Returns what changed so the caller can send the right push notification.
create or replace function public.system_assign_group_payer(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
  v_payer record;
begin
  select * into v_group from public.taxi_groups where id = p_group_id for update;
  if not found or v_group.status <> 'confirmed' then
    return jsonb_build_object('changed', false, 'reason', 'group_not_confirmed');
  end if;

  if v_group.payer_status = 'open' then
    return jsonb_build_object('changed', false, 'reason', 'open');
  end if;

  if v_group.payer_status = 'assigned' and exists (
    select 1 from public.passenger_requests
    where id = v_group.payer_request_id and group_id = p_group_id
  ) then
    return jsonb_build_object('changed', false, 'reason', 'locked');
  end if;

  if exists (select 1 from public.passenger_requests where group_id = p_group_id and distance_km is null) then
    return jsonb_build_object('changed', false, 'reason', 'missing_distances');
  end if;

  select id, user_id into v_payer
  from public.passenger_requests
  where group_id = p_group_id
    and not (id = any (v_group.payer_declined_request_ids))
  order by distance_km desc, id
  limit 1;

  if not found then
    update public.taxi_groups
    set payer_request_id = null, payer_user_id = null, payer_status = 'open',
        payer_assigned_at = null, payer_reminder_sent_at = null
    where id = p_group_id;
    return jsonb_build_object('changed', true, 'opened', true);
  end if;

  update public.taxi_groups
  set payer_request_id = v_payer.id, payer_user_id = v_payer.user_id, payer_status = 'assigned',
      payer_assigned_at = now(), payer_reminder_sent_at = null
  where id = p_group_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type)
  values (p_group_id, v_payer.id, 'payer_assigned',
          jsonb_build_object('reason', case when v_group.payer_status is null then 'last_stop' else 'payer_left_group' end),
          'system');

  return jsonb_build_object('changed', true, 'opened', false, 'request_id', v_payer.id, 'user_id', v_payer.user_id);
end;
$$;

revoke all on function public.system_assign_group_payer(uuid) from public, anon, authenticated;
grant execute on function public.system_assign_group_payer(uuid) to service_role;

-- 5. The payer hands the role back: it's opened to the rest of the group. Called by the
-- payments-payer-role Edge Function after it has checked the caller owns p_request_id.
create or replace function public.passenger_decline_payer_role(p_group_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
begin
  select * into v_group from public.taxi_groups where id = p_group_id for update;
  if not found or v_group.status <> 'confirmed' then
    return jsonb_build_object('done', false, 'reason', 'group_not_confirmed');
  end if;
  if v_group.payer_status is distinct from 'assigned' or v_group.payer_request_id is distinct from p_request_id then
    return jsonb_build_object('done', false, 'reason', 'not_the_payer');
  end if;

  update public.taxi_groups
  set payer_request_id = null, payer_user_id = null, payer_status = 'open', payer_assigned_at = null,
      payer_reminder_sent_at = null,
      payer_declined_request_ids = array_append(payer_declined_request_ids, p_request_id)
  where id = p_group_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type)
  values (p_group_id, p_request_id, 'payer_declined', null, 'passenger');

  return jsonb_build_object('done', true);
end;
$$;

revoke all on function public.passenger_decline_payer_role(uuid, uuid) from public, anon, authenticated;
grant execute on function public.passenger_decline_payer_role(uuid, uuid) to service_role;

-- 6. A member takes the open role. First one wins (row lock). Same caller check as above.
create or replace function public.passenger_volunteer_as_payer(p_group_id uuid, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
  v_request public.passenger_requests%rowtype;
begin
  select * into v_group from public.taxi_groups where id = p_group_id for update;
  if not found or v_group.status <> 'confirmed' then
    return jsonb_build_object('done', false, 'reason', 'group_not_confirmed');
  end if;
  if v_group.payer_status is distinct from 'open' then
    return jsonb_build_object('done', false, 'reason', 'role_taken');
  end if;

  select * into v_request from public.passenger_requests where id = p_request_id;
  if not found or v_request.group_id is distinct from p_group_id then
    return jsonb_build_object('done', false, 'reason', 'not_a_member');
  end if;

  update public.taxi_groups
  set payer_request_id = p_request_id, payer_user_id = v_request.user_id, payer_status = 'assigned',
      payer_assigned_at = now(), payer_reminder_sent_at = null,
      payer_declined_request_ids = array_remove(payer_declined_request_ids, p_request_id)
  where id = p_group_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type)
  values (p_group_id, p_request_id, 'payer_volunteered', null, 'passenger');

  return jsonb_build_object('done', true);
end;
$$;

revoke all on function public.passenger_volunteer_as_payer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.passenger_volunteer_as_payer(uuid, uuid) to service_role;
