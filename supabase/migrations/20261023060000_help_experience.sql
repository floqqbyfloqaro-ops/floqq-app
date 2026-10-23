-- Help assistant, phase 5: the chat experience, feedback, retention and the admin's figures.
--
-- help_messages: an answer can carry cards built from the passenger's own data (ride, payment,
--   refund - never written by the AI), buttons that open a screen, and an immediate offer to talk
--   to the team; the passenger can give it a thumbs up or down, with an optional "What was missing?".
-- Retention: conversations are deleted support_settings.retention_days (default 90) after their
--   last message, except while linked to a ticket that is still open; resolved tickets (with their
--   call-back number) go after the same time. A daily job does it.
-- admin_help_metrics(): the admin dashboard's figures for a period, including the AI cost.

alter table public.help_messages
  add column if not exists cards jsonb,
  add column if not exists actions text[],
  add column if not exists offer_handover boolean not null default false,
  add column if not exists feedback text check (feedback in ('up', 'down')),
  add column if not exists feedback_note text check (feedback_note is null or char_length(feedback_note) <= 500),
  add column if not exists feedback_at timestamptz;

create index if not exists help_messages_feedback_idx on public.help_messages (feedback_at) where feedback = 'down';

-- What writing the ticket's summary cost, so the monthly AI cost includes it.
alter table public.support_tickets
  add column if not exists summary_cost_usd numeric(10, 6);

alter table public.support_settings
  add column if not exists retention_days integer not null default 90 check (retention_days between 7 and 730);

create or replace function public.help_retention_cleanup()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer;
  v_conversations integer;
  v_tickets integer;
begin
  select retention_days into v_days from public.support_settings where id = 1;
  v_days := coalesce(v_days, 90);

  delete from public.support_tickets
  where status = 'resolved' and resolved_at < now() - make_interval(days => v_days);
  get diagnostics v_tickets = row_count;

  delete from public.help_conversations c
  where c.last_message_at < now() - make_interval(days => v_days)
    and not exists (
      select 1 from public.support_tickets t where t.conversation_id = c.id and t.status <> 'resolved'
    );
  get diagnostics v_conversations = row_count;

  return jsonb_build_object('conversations', v_conversations, 'tickets', v_tickets, 'retention_days', v_days);
end;
$$;

revoke all on function public.help_retention_cleanup() from public, anon, authenticated;

-- Every night at 03:15 (UTC). cron.schedule() upserts by job name, so re-running is safe.
select cron.schedule('help-retention-daily', '15 3 * * *', $$select public.help_retention_cleanup()$$);

-- The help assistant's figures since p_from: conversations, how many the assistant solved
-- ("Yes"), handovers and why, WhatsApp vs call back, time to the first human contact, open urgent
-- tickets, thumbs-down answers with their question, and the AI cost. Admin only.
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
    'resolved_by_assistant', (select count(*) from help_conversations where created_at >= p_from and resolved_by = 'assistant'),
    'handed_over', (select count(*) from help_conversations where created_at >= p_from and handed_over_at is not null),
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
    'thumbs_up', (select count(*) from help_messages where feedback = 'up' and feedback_at >= p_from),
    'thumbs_down', (select count(*) from help_messages where feedback = 'down' and feedback_at >= p_from),
    'ai_cost_usd', (
      (select coalesce(sum(cost_usd), 0) from help_messages where role = 'assistant' and created_at >= p_from)
      + (select coalesce(sum(summary_cost_usd), 0) from support_tickets where created_at >= p_from)),
    'thumbs_down_answers', coalesce((
      select jsonb_agg(row_to_json(d) order by d.at desc) from (
        select a.feedback_at as at, a.content as answer, a.feedback_note as note,
               (select q.content from help_messages q
                 where q.conversation_id = a.conversation_id and q.role = 'user' and q.created_at <= a.created_at
                 order by q.created_at desc limit 1) as question
        from help_messages a
        where a.feedback = 'down' and a.feedback_at >= p_from
        order by a.feedback_at desc
        limit 20
      ) d), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.admin_help_metrics(timestamptz) from public, anon;
grant execute on function public.admin_help_metrics(timestamptz) to authenticated;
