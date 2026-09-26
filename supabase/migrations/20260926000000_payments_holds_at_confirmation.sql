-- Stripe TEST-MODE payments prototype, phase 3: pre-authorize (hold) each passenger's estimated
-- share + platform fee + buffer once their group is confirmed. The passenger places the hold
-- themselves in the app (on-session, so 3D Secure can happen on the spot), within a short window.
-- A passenger whose hold still isn't placed when the window closes is removed from the confirmed
-- group by the system - the same steps as the admin "remove member" correction
-- (20260924070000_admin_group_corrections.sql), which is otherwise blocked for confirmed groups.
-- Nothing here does anything unless the PAYMENTS_ENABLED Edge Function secret is on.

-- 1. Hold timing per passenger payment.
alter table public.ride_payments
  -- The passenger can't place the hold before this (card holds only last ~7 days, so a ride
  -- more than 5 days out waits - see HOLD_LEAD_DAYS in _shared/holds.ts).
  add column if not exists hold_window_opens_at timestamptz,
  -- After this, a passenger without a placed hold is removed from the group.
  add column if not exists hold_deadline_at timestamptz,
  -- Stripe's capture_before for the placed hold - must be captured before this.
  add column if not exists hold_expires_at timestamptz,
  -- Numbers each hold attempt, so each retry gets its own Stripe idempotency key.
  add column if not exists hold_attempts integer not null default 0 check (hold_attempts >= 0);

-- 2. Card saves/replacements go into the same audit trail, without a ride payment.
alter table public.payment_events
  alter column ride_payment_id drop not null;

create index if not exists payment_events_user_id_idx on public.payment_events (user_id);

-- 3. System removal of a passenger whose hold wasn't placed in time. Same steps and audit events
-- as admin_begin_remove_group_member, but only for CONFIRMED groups, callable only by the
-- service role (the payments-sync-holds Edge Function), and logged with actor 'system'.
create or replace function public.system_remove_unpaid_member(
  p_group_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
  v_request public.passenger_requests%rowtype;
  v_remaining_ids uuid[];
  v_remaining_count integer;
begin
  select * into v_group from public.taxi_groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'P0002';
  end if;

  if v_group.status <> 'confirmed' then
    return jsonb_build_object('blocked', true, 'reason', 'group_not_confirmed');
  end if;

  select * into v_request from public.passenger_requests where id = p_request_id for update;
  if not found or v_request.group_id is distinct from p_group_id then
    return jsonb_build_object('blocked', true, 'reason', 'not_a_member');
  end if;

  update public.passenger_requests
  set status = 'pending', group_id = null, distance_km = null, extra_detour_minutes = null,
      waiting_minutes = null, individual_score = null
  where id = p_request_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type)
  values (p_group_id, p_request_id, 'member_removed', jsonb_build_object('reason', 'hold_not_placed'), 'system');

  insert into public.group_events (group_id, request_id, event_type, details, actor_type)
  values (p_group_id, p_request_id, 'ride_requeued', jsonb_build_object('reason', 'hold_not_placed'), 'system');

  select coalesce(array_agg(id), '{}') into v_remaining_ids
  from public.passenger_requests
  where group_id = p_group_id;

  v_remaining_count := coalesce(array_length(v_remaining_ids, 1), 0);

  if v_remaining_count < 2 then
    update public.passenger_requests
    set status = 'pending', group_id = null, distance_km = null, extra_detour_minutes = null,
        waiting_minutes = null, individual_score = null
    where group_id = p_group_id;

    update public.taxi_groups
    set status = 'dissolved', version = version + 1
    where id = p_group_id;

    insert into public.group_events (group_id, request_id, event_type, details, actor_type)
    values (p_group_id, null, 'group_dissolved',
            jsonb_build_object('reason', 'below_min_members', 'remaining_count', v_remaining_count), 'system');

    insert into public.group_events (group_id, request_id, event_type, details, actor_type)
    select p_group_id, id, 'ride_requeued', jsonb_build_object('reason', 'group_dissolved'), 'system'
    from unnest(v_remaining_ids) as id;

    return jsonb_build_object('blocked', false, 'needs_recalc', false, 'dissolved', true);
  end if;

  return jsonb_build_object(
    'blocked', false,
    'needs_recalc', true,
    'dissolved', false,
    'group_id', p_group_id,
    'group_version', v_group.version
  );
end;
$$;

revoke all on function public.system_remove_unpaid_member(uuid, uuid) from public, anon, authenticated;
grant execute on function public.system_remove_unpaid_member(uuid, uuid) to service_role;

-- 4. Rescore twin of apply_group_rescore (20260923010000_group_rebalance_on_edit.sql) for the
-- CONFIRMED group left behind by system_remove_unpaid_member. Same version check and same
-- writes; only the required group status differs. Service role only.
create or replace function public.system_apply_confirmed_group_rescore(
  p_group_id uuid,
  p_expected_version integer,
  p_still_valid boolean,
  p_member_scores jsonb,
  p_group_totals jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
  v_member jsonb;
  v_remaining_ids uuid[];
begin
  select * into v_group from public.taxi_groups where id = p_group_id for update;

  if not found or v_group.status <> 'confirmed' or v_group.version <> p_expected_version then
    return jsonb_build_object('applied', false, 'reason', 'stale');
  end if;

  if not p_still_valid then
    select coalesce(array_agg(id), '{}') into v_remaining_ids
    from public.passenger_requests
    where group_id = p_group_id;

    update public.passenger_requests
    set status = 'pending', group_id = null, distance_km = null, extra_detour_minutes = null,
        waiting_minutes = null, individual_score = null
    where group_id = p_group_id;

    update public.taxi_groups
    set status = 'dissolved', version = version + 1
    where id = p_group_id;

    insert into public.group_events (group_id, request_id, event_type, details, actor_type)
    values (p_group_id, null, 'group_dissolved', jsonb_build_object('reason', 'no_longer_compatible'), 'system');

    insert into public.group_events (group_id, request_id, event_type, details, actor_type)
    select p_group_id, id, 'ride_requeued', jsonb_build_object('reason', 'group_dissolved'), 'system'
    from unnest(v_remaining_ids) as id;

    return jsonb_build_object('applied', true, 'dissolved', true);
  end if;

  for v_member in select * from jsonb_array_elements(p_member_scores)
  loop
    update public.passenger_requests
    set
      distance_km = (v_member ->> 'distance_km')::numeric,
      extra_detour_minutes = (v_member ->> 'extra_detour_minutes')::numeric,
      waiting_minutes = (v_member ->> 'waiting_minutes')::numeric,
      individual_score = (v_member ->> 'individual_score')::numeric
    where id = (v_member ->> 'id')::uuid and group_id = p_group_id;
  end loop;

  update public.taxi_groups
  set
    total_fare = (p_group_totals ->> 'total_fare')::numeric,
    worst_individual_score = (p_group_totals ->> 'worst_individual_score')::numeric,
    total_route_distance_km = (p_group_totals ->> 'total_route_distance_km')::numeric,
    total_route_duration_minutes = (p_group_totals ->> 'total_route_duration_minutes')::numeric,
    version = version + 1
  where id = p_group_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type)
  values (p_group_id, null, 'group_recalculated', p_group_totals, 'system');

  return jsonb_build_object('applied', true, 'dissolved', false);
end;
$$;

revoke all on function public.system_apply_confirmed_group_rescore(uuid, integer, boolean, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.system_apply_confirmed_group_rescore(uuid, integer, boolean, jsonb, jsonb) to service_role;

-- 5. Overlap guard for the payments-sync-holds job, same single-row-per-job lock table the
-- match-and-group (1) and recheck-landing-times (2) jobs use.
insert into public.match_engine_lock (id, locked_at)
values (3, null)
on conflict (id) do nothing;

-- 6. Every 5 minutes: create missing hold rows for confirmed groups, and remove passengers whose
-- hold deadline has passed. Same Vault secrets (project_url, cron_secret) as the match-and-group
-- job (20260924020000_schedule_match_and_group_cron.sql). The function itself does nothing while
-- PAYMENTS_ENABLED is off. cron.schedule() upserts by job name, so re-running is safe.
select cron.schedule(
  'payments-sync-holds',
  '*/5 * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/payments-sync-holds',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb,
      -- Removing a passenger re-scores the group via Google Routes.
      timeout_milliseconds := 60000
    );
  $$
);
