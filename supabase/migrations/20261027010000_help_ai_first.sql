-- Help assistant, AI-first: it solves requests itself. Where it acts (cancelling a ride, resending
-- the email change confirmation), the passenger confirms on a card in the chat; the action then
-- runs through the same code as the app's own button.
--
-- 1. begin_passenger_request_cancel: unchanged, except that its 'ride_cancelled' event now says
--    how the passenger cancelled - details.via = 'assistant' when the help assistant asked for it
--    on their behalf (the x-floqq-via request header, set by cancel-passenger-request), else 'app'.
-- 2. help_actions: each confirmation card the assistant showed and what became of it (pending ->
--    done / kept / failed). Only the help-chat function (service role) reads and writes it.
-- 3. help_conversations.person_requests: how often the passenger asked for a person - the first
--    time the assistant offers to sort it out itself, the second time it hands over.
-- 4. admin_help_metrics: resolved without a person, the assistant's actions, passengers who asked
--    for a person twice.
--
-- Safe to run more than once.

-- 1. The cancel, with how it was asked for.
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
  -- The help assistant on the passenger's behalf, or the app's own button.
  v_via text := case
    when coalesce(current_setting('request.headers', true), '') <> ''
         and (current_setting('request.headers', true)::json ->> 'x-floqq-via') = 'assistant' then 'assistant'
    else 'app'
  end;
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
                             'group_was_confirmed', v_was_confirmed, 'via', v_via),
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

-- 2. The assistant's confirmation cards.
create table if not exists public.help_actions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.help_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('cancel_ride', 'resend_email_change')),
  -- The ride a cancel card is about.
  request_id uuid references public.passenger_requests (id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'done', 'kept', 'failed')),
  -- Why it failed (e.g. the ride changed meanwhile, being settled).
  failure text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists help_actions_conversation_idx on public.help_actions (conversation_id);
create index if not exists help_actions_decided_idx on public.help_actions (decided_at) where status = 'done';

alter table public.help_actions enable row level security;

-- 3. Asked for a person, how often.
alter table public.help_conversations
  add column if not exists person_requests integer not null default 0 check (person_requests >= 0);

-- 4. The admin's figures.
create or replace function public.admin_help_metrics(p_from timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  with talked as (
    select c.* from help_conversations c
    where c.created_at >= p_from
      and exists (select 1 from help_messages m where m.conversation_id = c.id and m.role = 'user')
  )
  select jsonb_build_object(
    'conversations', (select count(*) from talked),
    'without_person', (select count(*) from talked where handed_over_at is null),
    'resolved_by_assistant', (select count(*) from talked where state = 'resolved_by_assistant'),
    'resolved_by_team', (select count(*) from talked where state = 'resolved_by_team'),
    'closed_no_reply', (select count(*) from talked where state = 'closed_no_reply'),
    'handed_over', (select count(*) from talked where handed_over_at is not null),
    'person_after_resolved', (
      select count(*) from talked c
      where c.state = 'resolved_by_assistant' and c.closed_at is not null
        and exists (
          select 1 from support_tickets t
          where t.user_id = c.user_id and t.created_at > c.closed_at and t.created_at <= c.closed_at + interval '24 hours'
        )),
    'asked_person_twice', (select count(distinct user_id) from talked where person_requests >= 2),
    'assistant_actions', coalesce((
      select jsonb_object_agg(kind, n) from (
        select kind, count(*) as n from help_actions where status = 'done' and decided_at >= p_from group by kind
      ) a), '{}'::jsonb),
    'handover_reasons', coalesce((
      select jsonb_object_agg(category, n) from (
        select category, count(*) as n from support_tickets where created_at >= p_from group by category
      ) r), '{}'::jsonb),
    'channels', coalesce((
      select jsonb_object_agg(channel, n) from (
        select channel, count(*) as n from support_tickets where created_at >= p_from group by channel
      ) c), '{}'::jsonb),
    'avg_minutes_to_first_contact', (
      select round(avg(extract(epoch from (first_contact_at - created_at)) / 60)::numeric, 1)
      from support_tickets where created_at >= p_from and first_contact_at is not null),
    'open_urgent_tickets', (select count(*) from support_tickets where urgent and status <> 'resolved'),
    'open_tickets', (select count(*) from support_tickets where status <> 'resolved'),
    'thumbs_up', (select count(*) from help_conversations where helpful = 'up' and helpful_at >= p_from)
                 + (select count(*) from help_messages where feedback = 'up' and feedback_at >= p_from),
    'thumbs_down', (select count(*) from help_conversations where helpful = 'down' and helpful_at >= p_from)
                   + (select count(*) from help_messages where feedback = 'down' and feedback_at >= p_from),
    'ai_cost_usd', (
      (select coalesce(sum(cost_usd), 0) from help_messages where role = 'assistant' and created_at >= p_from)
      + (select coalesce(sum(summary_cost_usd), 0) from support_tickets where created_at >= p_from)),
    'thumbs_down_answers', coalesce((
      select jsonb_agg(row_to_json(d) order by d.at desc) from (
        select c.helpful_at as at, coalesce(c.title, '') as answer, null::text as note,
               public.help_conversation_fallback_title(c.id) as question
        from help_conversations c
        where c.helpful = 'down' and c.helpful_at >= p_from
        order by c.helpful_at desc
        limit 20
      ) d), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.admin_help_metrics(timestamptz) from public, anon;
grant execute on function public.admin_help_metrics(timestamptz) to authenticated;
