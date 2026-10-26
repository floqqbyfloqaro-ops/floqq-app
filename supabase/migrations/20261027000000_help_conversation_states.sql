-- Help assistant: how a conversation ends, like with the best human support agent. Replaces the
-- "Did this solve your problem?" after every answer (phase 3) and the thumbs under every answer
-- (phase 5).
--
-- help_conversations.state:
--   active                 -> still going;
--   resolved_by_assistant  -> the passenger said they're done ("merci, c'est parfait", 👍) or
--                             answered "No, that's all" / "Yes, it's solved";
--   handed_over            -> a ticket is open; the conversation stays open until the team resolves it;
--   resolved_by_team       -> the team resolved the ticket;
--   closed_no_reply        -> no reply for support_settings.no_reply_close_minutes (default 10)
--                             after a complete answer, or for 24 hours after anything else.
-- Every state but active and handed_over is archived and read-only (help-chat refuses new
-- messages). The handover and the team's resolution keep setting handed_over_at / resolved_by, as
-- before; a trigger turns those into the state, so support-handover and support-admin don't change.
--
-- Also: a short title per conversation (from the assistant: "Refund for ride of 24 Oct"; else its
-- first message), the conversation a passenger came back from ("I still need help with this"), a
-- once-only "Was this helpful?", and the admin's figures for all of this.
--
-- Safe to run more than once.

alter table public.help_conversations
  add column if not exists state text not null default 'active'
    check (state in ('active', 'resolved_by_assistant', 'handed_over', 'resolved_by_team', 'closed_no_reply')),
  add column if not exists title text check (title is null or char_length(title) between 1 and 80),
  add column if not exists closed_at timestamptz,
  -- The silence timer: when the assistant gave a complete answer the passenger hasn't replied to.
  add column if not exists answered_at timestamptz,
  -- "Anything else I can help with?" / "Did that solve it?" is asked at most once.
  add column if not exists followup_asked boolean not null default false,
  add column if not exists previous_conversation_id uuid references public.help_conversations (id) on delete set null,
  add column if not exists helpful text check (helpful in ('up', 'down')),
  add column if not exists helpful_at timestamptz;

create index if not exists help_conversations_silence_idx on public.help_conversations (answered_at) where state = 'active';

-- What an answer asked, for the app's two buttons: 'question' ("No, that's all" / "Yes, another
-- question") or 'problem' ("Yes, it's solved" / "No, still a problem").
alter table public.help_messages
  add column if not exists followup text check (followup in ('question', 'problem'));

alter table public.support_settings
  add column if not exists no_reply_close_minutes integer not null default 10 check (no_reply_close_minutes between 1 and 1440);

-- The conversations from before: their state from what is already known.
update public.help_conversations
set
  state = case
    when resolved_by = 'team' then 'resolved_by_team'
    when handed_over_at is not null then 'handed_over'
    when resolved_by = 'assistant' then 'resolved_by_assistant'
    else 'active'
  end,
  closed_at = case when resolved_by is not null then coalesce(resolved_at, last_message_at) else null end
where state = 'active' and (resolved_by is not null or handed_over_at is not null);

-- Its first message: the title when the assistant didn't give one.
create or replace function public.help_conversation_fallback_title(p_conversation_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select nullif(left(regexp_replace(content, '\s+', ' ', 'g'), 60), '')
  from public.help_messages
  where conversation_id = p_conversation_id and role = 'user'
  order by created_at
  limit 1;
$$;

-- The handover (handed_over_at) and the team's resolution (resolved_by = 'team') set the state;
-- leaving "active" gives the conversation a title if it has none.
create or replace function public.help_conversations_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.resolved_by = 'team' and old.resolved_by is distinct from 'team' then
    new.state := 'resolved_by_team';
    new.closed_at := coalesce(new.resolved_at, now());
  elsif new.handed_over_at is not null and old.handed_over_at is null and new.state <> 'resolved_by_team' then
    new.state := 'handed_over';
    new.closed_at := null;
    new.answered_at := null;
  end if;
  if new.state <> 'active' and new.title is null then
    new.title := public.help_conversation_fallback_title(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists help_conversations_state on public.help_conversations;
create trigger help_conversations_state
  before update on public.help_conversations
  for each row execute function public.help_conversations_state();

-- The silence job: no reply after a complete answer -> closed_no_reply (no notification); a
-- conversation left waiting for anything else closes after 24 hours; one where nothing was ever
-- written is simply removed after 24 hours.
create or replace function public.help_close_silent_conversations()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes integer;
  v_closed integer;
  v_removed integer;
begin
  select no_reply_close_minutes into v_minutes from public.support_settings where id = 1;
  v_minutes := coalesce(v_minutes, 10);

  delete from public.help_conversations c
  where c.state = 'active'
    and c.last_message_at < now() - interval '24 hours'
    and not exists (select 1 from public.help_messages m where m.conversation_id = c.id);
  get diagnostics v_removed = row_count;

  update public.help_conversations
  set state = 'closed_no_reply', closed_at = now()
  where state = 'active'
    and (
      (answered_at is not null and answered_at < now() - make_interval(mins => v_minutes))
      or last_message_at < now() - interval '24 hours'
    );
  get diagnostics v_closed = row_count;

  return jsonb_build_object('closed', v_closed, 'removed_empty', v_removed, 'minutes', v_minutes);
end;
$$;

revoke all on function public.help_close_silent_conversations() from public, anon, authenticated;
-- The server (and scripts/help-endings-test.mjs) may run it too.
grant execute on function public.help_close_silent_conversations() to service_role;
-- help_conversation_fallback_title stays callable: the trigger runs as whoever updates the row, and
-- it reads with the caller's own rights (a passenger only ever sees their own messages).

-- Every 2 minutes. cron.schedule() upserts by job name, so re-running is safe.
select cron.schedule('help-close-silent', '*/2 * * * *', $$select public.help_close_silent_conversations()$$);

-- The admin's figures, now with how conversations ended: resolved by the assistant, by the team,
-- closed without a reply, "Was this helpful?", and how many passengers asked for a person within
-- 24 hours of a conversation the assistant closed as resolved (a sign it closed too early).
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

  select jsonb_build_object(
    'conversations', (select count(*) from help_conversations where created_at >= p_from
                        and exists (select 1 from help_messages m where m.conversation_id = help_conversations.id and m.role = 'user')),
    'resolved_by_assistant', (select count(*) from help_conversations where created_at >= p_from and state = 'resolved_by_assistant'),
    'resolved_by_team', (select count(*) from help_conversations where created_at >= p_from and state = 'resolved_by_team'),
    'closed_no_reply', (select count(*) from help_conversations where created_at >= p_from and state = 'closed_no_reply'),
    'handed_over', (select count(*) from help_conversations where created_at >= p_from and handed_over_at is not null),
    'person_after_resolved', (
      select count(*) from help_conversations c
      where c.created_at >= p_from and c.state = 'resolved_by_assistant' and c.closed_at is not null
        and exists (
          select 1 from support_tickets t
          where t.user_id = c.user_id and t.created_at > c.closed_at and t.created_at <= c.closed_at + interval '24 hours'
        )),
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
    -- "Was this helpful?" on a closed conversation (and, before it existed, the thumbs on answers).
    'thumbs_up', (select count(*) from help_conversations where helpful = 'up' and helpful_at >= p_from)
                 + (select count(*) from help_messages where feedback = 'up' and feedback_at >= p_from),
    'thumbs_down', (select count(*) from help_conversations where helpful = 'down' and helpful_at >= p_from)
                   + (select count(*) from help_messages where feedback = 'down' and feedback_at >= p_from),
    'ai_cost_usd', (
      (select coalesce(sum(cost_usd), 0) from help_messages where role = 'assistant' and created_at >= p_from)
      + (select coalesce(sum(summary_cost_usd), 0) from support_tickets where created_at >= p_from)),
    -- Not helpful: the conversation's title and its first question.
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
