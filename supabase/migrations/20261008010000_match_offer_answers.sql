-- "Match found" screen, step 4: answering the offer.
--   1. "Not for me" and the response deadline both take a passenger out of a group that is still
--      an offer (unconfirmed) and put their ride back to searching - system_remove_offer_member.
--      What's left is rescored (apply_group_rescore) or, below two passengers, dissolved.
--   2. Passengers who declined each other are not offered each other again (match_declines).
--   3. The match-offer-sweep job runs every minute: starts the response window of new offers,
--      acts on the ones that ran out, and confirms groups in which everyone secured their spot.
--
-- Safe to run more than once.

-- 1. Who declined riding with whom. One row per direction, so either ride finds it by its own id.
create table if not exists public.match_declines (
  request_id uuid not null references public.passenger_requests (id) on delete cascade,
  declined_request_id uuid not null references public.passenger_requests (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (request_id, declined_request_id)
);

alter table public.match_declines enable row level security;
-- Service role only (the matching job and the decline-match function): no client policies.

-- 2. Takes one passenger out of an offer. p_event says why: 'match_declined' (the passenger
-- tapped "Not for me") or 'offer_expired' (they didn't answer in time). Same steps as
-- system_remove_unpaid_member, but only for UNCONFIRMED groups. Service role only.
create or replace function public.system_remove_offer_member(
  p_group_id uuid,
  p_request_id uuid,
  p_event text
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
  v_actor text;
begin
  if p_event not in ('match_declined', 'offer_expired') then
    raise exception 'invalid event %', p_event using errcode = '22023';
  end if;
  v_actor := case when p_event = 'match_declined' then 'passenger' else 'system' end;

  select * into v_group from public.taxi_groups where id = p_group_id for update;
  if not found then
    raise exception 'group % not found', p_group_id using errcode = 'P0002';
  end if;

  if v_group.status <> 'unconfirmed' then
    return jsonb_build_object('blocked', true, 'reason', 'group_not_offered');
  end if;

  select * into v_request from public.passenger_requests where id = p_request_id for update;
  if not found or v_request.group_id is distinct from p_group_id then
    return jsonb_build_object('blocked', true, 'reason', 'not_a_member');
  end if;

  -- A passenger who secured their spot in the meantime keeps it: the deadline no longer applies.
  if p_event = 'offer_expired' and v_request.spot_secured_group_id = p_group_id then
    return jsonb_build_object('blocked', true, 'reason', 'spot_secured');
  end if;

  update public.passenger_requests
  set status = 'pending', group_id = null, distance_km = null, extra_detour_minutes = null,
      waiting_minutes = null, individual_score = null,
      spot_secured_at = null, spot_secured_group_id = null
  where id = p_request_id;

  insert into public.group_events (group_id, request_id, event_type, details, actor_type, actor_id)
  values (p_group_id, p_request_id, p_event, null, v_actor,
          case when v_actor = 'passenger' then v_request.user_id end);

  insert into public.group_events (group_id, request_id, event_type, details, actor_type)
  values (p_group_id, p_request_id, 'ride_requeued', jsonb_build_object('reason', p_event), v_actor);

  select coalesce(array_agg(id), '{}') into v_remaining_ids
  from public.passenger_requests
  where group_id = p_group_id;

  v_remaining_count := coalesce(array_length(v_remaining_ids, 1), 0);

  if v_remaining_count < 2 then
    update public.passenger_requests
    set status = 'pending', group_id = null, distance_km = null, extra_detour_minutes = null,
        waiting_minutes = null, individual_score = null,
        spot_secured_at = null, spot_secured_group_id = null
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

    return jsonb_build_object('blocked', false, 'needs_recalc', false, 'dissolved', true,
                              'remaining_ids', to_jsonb(v_remaining_ids));
  end if;

  -- Same as the other removals: the version only moves when the rescore is applied.
  return jsonb_build_object(
    'blocked', false,
    'needs_recalc', true,
    'dissolved', false,
    'group_id', p_group_id,
    'group_version', v_group.version
  );
end;
$$;

revoke all on function public.system_remove_offer_member(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.system_remove_offer_member(uuid, uuid, text) to service_role;

-- 3. Overlap guard for the sweep, same lock table as the other scheduled jobs.
insert into public.match_engine_lock (id, locked_at)
values (5, null)
on conflict (id) do nothing;

-- 4. Every minute, so the countdown on the screen and what happens at its end stay close. Same
-- Vault secrets as the other jobs.
select cron.schedule(
  'match-offer-sweep',
  '* * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
             || '/functions/v1/match-offer-sweep',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
