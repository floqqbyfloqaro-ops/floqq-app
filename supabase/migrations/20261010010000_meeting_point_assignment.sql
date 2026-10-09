-- Meeting points, step 3: every confirmed group gets one. The automatic assignment lives in the
-- match-offer-sweep job (supabase/functions/_shared/meetingPoints.ts); this adds the admin's
-- manual override. The 'meeting_point_assigned' audit event already exists
-- (20261010000000_same_terminal_matching.sql).
--
-- Safe to run more than once.

-- The admin picks a group's meeting point by hand, or clears it (p_meeting_point_id null) so the
-- automatic assignment chooses again within a minute. Only for confirmed groups, only an active
-- point, and only one at the group's own terminal - T2 groups (T2A/T2B/T2C alike) meet at any T2
-- point. Records who changed it and what it was before.
create or replace function public.admin_set_group_meeting_point(
  p_group_id uuid,
  p_meeting_point_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.taxi_groups%rowtype;
  v_point public.meeting_points%rowtype;
  v_terminal text;
begin
  if (auth.jwt() ->> 'email') is distinct from 'floqqbyfloqaro@gmail.com' then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_group from public.taxi_groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'P0002';
  end if;
  if v_group.status <> 'confirmed' then
    return jsonb_build_object('applied', false, 'reason', 'group_not_confirmed');
  end if;

  if p_meeting_point_id is not null then
    select * into v_point from public.meeting_points where id = p_meeting_point_id;
    if not found or not v_point.is_active then
      return jsonb_build_object('applied', false, 'reason', 'point_not_active');
    end if;

    select arrival_terminal into v_terminal
    from public.passenger_requests
    where group_id = p_group_id and arrival_terminal is not null
    limit 1;
    if v_terminal is null or left(v_point.terminal, 2) <> v_terminal then
      return jsonb_build_object('applied', false, 'reason', 'terminal_mismatch');
    end if;
  end if;

  update public.taxi_groups
  set meeting_point_id = p_meeting_point_id
  where id = p_group_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (p_group_id, null, 'meeting_point_assigned',
          jsonb_build_object(
            'meeting_point_id', p_meeting_point_id,
            'short_code', case when p_meeting_point_id is null then null else v_point.short_code end,
            'previous_meeting_point_id', v_group.meeting_point_id,
            'source', 'admin_override'
          ),
          'admin', auth.uid());

  return jsonb_build_object('applied', true);
end;
$$;

revoke all on function public.admin_set_group_meeting_point(uuid, uuid) from public, anon;
grant execute on function public.admin_set_group_meeting_point(uuid, uuid) to authenticated;
