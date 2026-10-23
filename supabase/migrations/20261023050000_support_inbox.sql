-- Help assistant, phase 4: the admin's support inbox.
--
-- support_tickets gains what the team does with a ticket: the call attempts, when the passenger
-- was first reached (for "time to first human contact"), and why it was resolved.
-- support_ticket_events is the ticket's history: internal notes and every action the team took.
-- Notes are for the team only - a passenger never reads them. All writes go through the
-- support-admin Edge Function (admin only), which also notifies the passenger where needed.

alter table public.support_tickets
  add column if not exists resolution_category text
    check (resolution_category in ('refund_issue', 'app_bug', 'meeting_problem', 'payment', 'other')),
  add column if not exists first_contact_at timestamptz,
  add column if not exists call_attempts integer not null default 0,
  add column if not exists last_call_at timestamptz;

create table if not exists public.support_ticket_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  kind text not null check (kind in (
    'note', 'in_progress', 'called_resolved', 'no_answer', 'call_later', 'resolved', 'channel_changed', 'passenger_replied'
  )),
  body text check (body is null or char_length(body) <= 2000),
  -- null: the passenger or the system.
  actor_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_events_ticket_idx on public.support_ticket_events (ticket_id, created_at);

alter table public.support_ticket_events enable row level security;

drop policy if exists "Admin reads ticket history" on public.support_ticket_events;
create policy "Admin reads ticket history" on public.support_ticket_events
  for select to authenticated using (public.is_admin());
