-- Help assistant, phase 3: "Did this solve your problem?" and the handover to the FLOQQ team.
--
-- support_settings: one row the admin edits (the WhatsApp number - never in the code - the
--   languages the team speaks, support hours in Barcelona time, and where new-ticket alerts go).
--   Only the support-handover Edge Function reads it; the app gets what it needs from there.
-- support_tickets: one per handover - a short reference, the chosen language and channel, the
--   call-back number and time, an AI summary for the team and the urgency. The call-back number
--   lives only here (never on the profile) and goes when the ticket goes.
-- Written only by the Edge Functions (service role). A passenger reads their own tickets; the
-- admin reads and updates all of them.

create table if not exists public.support_settings (
  id smallint primary key default 1 check (id = 1),
  -- International format, e.g. +34612345678. Empty: WhatsApp isn't offered.
  whatsapp_number text,
  team_languages text[] not null default array['en', 'fr', 'es'],
  -- {"mon": {"open": "08:00", "close": "22:00"}, ..., "sun": null} - Barcelona time, null: closed,
  -- "00:00"-"24:00": the whole day. The pilot starts with support around the clock.
  support_hours jsonb not null default '{
    "mon": {"open": "00:00", "close": "24:00"}, "tue": {"open": "00:00", "close": "24:00"},
    "wed": {"open": "00:00", "close": "24:00"}, "thu": {"open": "00:00", "close": "24:00"},
    "fri": {"open": "00:00", "close": "24:00"}, "sat": {"open": "00:00", "close": "24:00"},
    "sun": {"open": "00:00", "close": "24:00"}}'::jsonb,
  alert_email text,
  updated_at timestamptz not null default now()
);

insert into public.support_settings (id) values (1) on conflict (id) do nothing;

alter table public.support_settings enable row level security;

drop policy if exists "Admin reads support settings" on public.support_settings;
create policy "Admin reads support settings" on public.support_settings
  for select to authenticated using (public.is_admin());

drop policy if exists "Admin edits support settings" on public.support_settings;
create policy "Admin edits support settings" on public.support_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique check (reference ~ '^[A-Z2-9]{4,6}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.help_conversations (id) on delete set null,
  request_id uuid references public.passenger_requests (id) on delete set null,
  category text not null,
  language text not null check (language in ('en', 'fr', 'es')),
  channel text not null check (channel in ('whatsapp', 'callback')),
  -- Call back only. E.164, e.g. +34612345678.
  callback_phone text check (callback_phone is null or callback_phone ~ '^\+[1-9][0-9]{6,14}$'),
  -- null: as soon as possible.
  callback_at timestamptz,
  callback_consent_at timestamptz,
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'no_answer')),
  urgent boolean not null default false,
  summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint support_tickets_callback_complete check (
    channel <> 'callback' or (callback_phone is not null and callback_consent_at is not null)
  )
);

create index if not exists support_tickets_inbox_idx on public.support_tickets (status, urgent desc, created_at);
create index if not exists support_tickets_user_idx on public.support_tickets (user_id, created_at desc);

alter table public.support_tickets enable row level security;

drop policy if exists "Passengers read their own tickets" on public.support_tickets;
create policy "Passengers read their own tickets" on public.support_tickets
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Admin updates tickets" on public.support_tickets;
create policy "Admin updates tickets" on public.support_tickets
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- The conversation: answered "Yes" (resolved by the assistant), or handed over.
alter table public.help_conversations
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by text check (resolved_by in ('assistant', 'team')),
  add column if not exists handover_reason text,
  add column if not exists handed_over_at timestamptz;

-- What the assistant signalled with an answer: ask "Did this solve your problem?", or hand over.
alter table public.help_messages
  add column if not exists resolution_check boolean not null default false,
  add column if not exists handover_reason text;
