-- Help assistant: the passenger ends a chat or closes a request themselves, and follow-up chips.
--
-- help_conversations.state 'closed_by_user': "End chat" or "Close request" - archived, read-only,
--   never reopened automatically (a new message starts a new conversation that knows it).
-- A ticket the passenger closes is resolved with resolution_category 'closed_by_user' (so every
--   rule that treats a resolved ticket as closed - the inbox, the help screen, retention - applies
--   unchanged); its history gets a 'closed_by_user' event. The admin can't pick that category.
-- help_messages.followup_topics: up to 3 suggested questions under an answer (topic names from
--   src/services/helpChips.ts), chosen by the assistant from the fixed list.
--
-- Safe to run more than once.

alter table public.help_conversations drop constraint if exists help_conversations_state_check;
alter table public.help_conversations
  add constraint help_conversations_state_check
  check (state in ('active', 'resolved_by_assistant', 'handed_over', 'resolved_by_team', 'closed_no_reply', 'closed_by_user'));

alter table public.support_tickets drop constraint if exists support_tickets_resolution_category_check;
alter table public.support_tickets
  add constraint support_tickets_resolution_category_check
  check (resolution_category in ('refund_issue', 'app_bug', 'meeting_problem', 'payment', 'other', 'closed_by_user'));

alter table public.support_ticket_events drop constraint if exists support_ticket_events_kind_check;
alter table public.support_ticket_events
  add constraint support_ticket_events_kind_check
  check (kind in ('note', 'in_progress', 'called_resolved', 'no_answer', 'call_later', 'resolved', 'channel_changed', 'passenger_replied', 'closed_by_user'));

alter table public.help_messages
  add column if not exists followup_topics text[] check (followup_topics is null or cardinality(followup_topics) <= 3);
