-- Late join: the matching job may place a waiting passenger into a group that is still an offer
-- ("Match found", unconfirmed) and has a free seat, instead of only ever forming new groups. The
-- job does the scoring and the rule checks (supabase/functions/_shared/lateJoin.ts); this applies
-- the result atomically, the system counterpart of admin_commit_add_group_member.
--
-- Safe to run more than once.

-- Re-validates under lock what the job read before scoring: the offer is still open and unchanged
-- (p_expected_version), the request is still free, there is still a seat, and this passenger
-- hasn't left this same group before. The response window restarts (p_offer_expires_at) so the
-- newcomer gets a full one; passengers who already secured their spot stay secured. Service role
-- only.
create or replace function public.system_commit_join_offer(
  p_group_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_member_scores jsonb,
  p_group_totals jsonb,
  p_offer_expires_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
  v_request public.passenger_requests%rowtype;
  v_member_count integer;
  v_member jsonb;
begin
  select * into v_group from public.taxi_groups where id = p_group_id for update;
  if not found or v_group.status <> 'unconfirmed' or v_group.version <> p_expected_version then
    return jsonb_build_object('applied', false, 'reason', 'group_not_open');
  end if;

  select * into v_request from public.passenger_requests where id = p_request_id for update;
  if not found or v_request.status <> 'pending' or v_request.group_id is not null then
    return jsonb_build_object('applied', false, 'reason', 'request_not_available');
  end if;

  if exists (
    select 1 from public.group_events
    where group_id = p_group_id and request_id = p_request_id
      and event_type in ('match_declined', 'offer_expired', 'member_removed')
  ) then
    return jsonb_build_object('applied', false, 'reason', 'left_before');
  end if;

  -- Kept in sync with MAX_PASSENGERS_PER_TAXI in src/constants.ts and
  -- supabase/functions/_shared/constants.ts.
  select count(*) into v_member_count from public.passenger_requests where group_id = p_group_id;
  if v_member_count >= 3 then
    return jsonb_build_object('applied', false, 'reason', 'group_full');
  end if;

  update public.passenger_requests
  set group_id = p_group_id, status = 'matched', spot_secured_at = null, spot_secured_group_id = null
  where id = p_request_id;

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
    offer_expires_at = p_offer_expires_at,
    version = version + 1
  where id = p_group_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type)
  values (p_group_id, p_request_id, 'member_added', jsonb_build_object('reason', 'late_join'), 'system');

  insert into public.group_events (group_id, request_id, event_type, details, actor_type)
  values (p_group_id, null, 'group_recalculated', p_group_totals, 'system');

  return jsonb_build_object('applied', true);
end;
$$;

revoke all on function public.system_commit_join_offer(uuid, uuid, integer, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.system_commit_join_offer(uuid, uuid, integer, jsonb, jsonb, timestamptz) to service_role;
