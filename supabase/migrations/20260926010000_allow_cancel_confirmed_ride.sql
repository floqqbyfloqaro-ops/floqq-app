-- A passenger can always cancel their own ride, also once its group is confirmed (previously
-- blocked with 'group_confirmed'). Same steps as before; the result now says whether the group was
-- confirmed, so the cancel-passenger-request Edge Function can rescore the confirmed group and, with
-- the payments prototype on, keep the EUR 2.49 platform fee from the passenger's hold and release
-- the rest. Audit events now also record the passenger as the actor.
create or replace function public.begin_passenger_request_cancel(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.passenger_requests%rowtype;
  v_group public.taxi_groups%rowtype;
  v_was_confirmed boolean := false;
  v_remaining_ids uuid[];
  v_remaining_count integer;
begin
  select * into v_request from public.passenger_requests where id = p_request_id for update;

  if not found then
    raise exception 'passenger request % not found', p_request_id using errcode = 'P0002';
  end if;

  if v_request.user_id <> auth.uid() then
    raise exception 'not authorized to cancel this request' using errcode = '42501';
  end if;

  if v_request.status not in ('pending', 'matched') then
    return jsonb_build_object('blocked', true, 'reason', 'not_active');
  end if;

  if v_request.group_id is not null then
    select * into v_group from public.taxi_groups where id = v_request.group_id for update;
    v_was_confirmed := found and v_group.status = 'confirmed';
  end if;

  update public.passenger_requests
  set status = 'cancelled', group_id = null, distance_km = null, extra_detour_minutes = null,
      waiting_minutes = null, individual_score = null
  where id = p_request_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (v_request.group_id, p_request_id, 'ride_cancelled',
          jsonb_build_object('reason', 'passenger_cancelled', 'previous_status', v_request.status,
                             'group_was_confirmed', v_was_confirmed),
          'passenger', auth.uid());

  if v_request.group_id is null then
    return jsonb_build_object('blocked', false, 'needs_recalc', false, 'dissolved', false, 'was_confirmed', false);
  end if;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (v_request.group_id, p_request_id, 'member_removed', jsonb_build_object('reason', 'cancelled'),
          'passenger', auth.uid());

  select coalesce(array_agg(id), '{}') into v_remaining_ids
  from public.passenger_requests
  where group_id = v_request.group_id;

  v_remaining_count := coalesce(array_length(v_remaining_ids, 1), 0);

  if v_remaining_count < 2 then
    update public.passenger_requests
    set status = 'pending', group_id = null, distance_km = null, extra_detour_minutes = null,
        waiting_minutes = null, individual_score = null
    where group_id = v_request.group_id;

    update public.taxi_groups
    set status = 'dissolved', version = version + 1
    where id = v_request.group_id;

    insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
    values (v_request.group_id, null, 'group_dissolved',
            jsonb_build_object('reason', 'below_min_members', 'remaining_count', v_remaining_count),
            'passenger', auth.uid());

    insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
    select v_request.group_id, id, 'ride_requeued', jsonb_build_object('reason', 'group_dissolved'),
           'passenger', auth.uid()
    from unnest(v_remaining_ids) as id;

    return jsonb_build_object('blocked', false, 'needs_recalc', false, 'dissolved', true,
                              'was_confirmed', v_was_confirmed, 'group_id', v_request.group_id);
  end if;

  return jsonb_build_object(
    'blocked', false,
    'needs_recalc', true,
    'dissolved', false,
    'was_confirmed', v_was_confirmed,
    'group_id', v_request.group_id,
    'group_version', v_group.version
  );
end;
$$;

revoke all on function public.begin_passenger_request_cancel(uuid) from public;
grant execute on function public.begin_passenger_request_cancel(uuid) to authenticated;
