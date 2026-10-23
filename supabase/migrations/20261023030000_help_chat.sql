-- Help assistant, phase 2: the conversations with the AI support assistant.
--
-- Written only by the help-chat Edge Function (service role), which also rebuilds each
-- conversation's history from here - never from what the app sends - so nobody can put words in
-- the assistant's mouth. A passenger reads their own conversations (for the help screen); the
-- admin reads all of them (handover and quality, later phases). Each assistant answer records
-- its token use and cost, for the monthly AI cost on the admin dashboard.

create table if not exists public.help_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  language text not null check (language in ('en', 'fr', 'es')),
  -- The ride that was active when the conversation started, if any.
  request_id uuid references public.passenger_requests (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists help_conversations_user_idx on public.help_conversations (user_id, last_message_at desc);

create table if not exists public.help_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.help_conversations (id) on delete cascade,
  -- Denormalised for the per-user rate limit.
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  created_at timestamptz not null default now(),
  -- Assistant answers only: which model, what it read (tool names), and what it cost.
  model text,
  tools_used text[],
  emergency boolean not null default false,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  cost_usd numeric(10, 6)
);

create index if not exists help_messages_conversation_idx on public.help_messages (conversation_id, created_at);
create index if not exists help_messages_rate_idx on public.help_messages (user_id, created_at desc) where role = 'user';
create index if not exists help_messages_cost_idx on public.help_messages (created_at) where role = 'assistant';

alter table public.help_conversations enable row level security;
alter table public.help_messages enable row level security;

drop policy if exists "Passengers read their own help conversations" on public.help_conversations;
create policy "Passengers read their own help conversations" on public.help_conversations
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "Passengers read their own help messages" on public.help_messages;
create policy "Passengers read their own help messages" on public.help_messages
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
