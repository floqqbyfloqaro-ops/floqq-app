-- Help assistant, phase 1: the knowledge base the AI support assistant answers from.
--
-- One row per section and language (en / fr / es). English is the master copy, imported from
-- docs/help-knowledge-base.md (scripts/import-help-kb.mjs). French and Spanish start as drafts:
-- the assistant only ever uses published rows, so a translation goes live only once the admin has
-- reviewed and published it. Every insert and change is kept in help_article_revisions, so the
-- admin can see who changed what and bring back an older version.
--
-- Only the admin reads or edits these tables from the app. The assistant's Edge Function reads
-- the published rows with the service role.

create table if not exists public.help_articles (
  id uuid primary key default gen_random_uuid(),
  section_key text not null check (section_key ~ '^[a-z0-9_]{1,60}$'),
  language text not null check (language in ('en', 'fr', 'es')),
  -- The section's place in the document, so the assistant reads it in the original order.
  sort_order integer not null default 0,
  title text not null check (char_length(title) between 1 and 200),
  content text not null check (char_length(content) <= 20000),
  status text not null default 'draft' check (status in ('draft', 'published')),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  unique (section_key, language)
);

create table if not exists public.help_article_revisions (
  id bigint generated always as identity primary key,
  article_id uuid not null references public.help_articles (id) on delete cascade,
  section_key text not null,
  language text not null,
  title text not null,
  content text not null,
  status text not null,
  changed_at timestamptz not null default now(),
  -- null: written by a script (the import), not by a person.
  changed_by uuid references auth.users (id) on delete set null
);

create index if not exists help_article_revisions_article_idx
  on public.help_article_revisions (article_id, changed_at desc);

-- Who changed it and when: always set by the database, never taken from the app.
create or replace function public.help_articles_stamp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists help_articles_stamp on public.help_articles;
create trigger help_articles_stamp
  before insert or update on public.help_articles
  for each row execute function public.help_articles_stamp();

-- Every version is kept, the current one included, so "restore" can pick any of them.
create or replace function public.help_articles_keep_revision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.title = old.title and new.content = old.content and new.status = old.status then
    return new;
  end if;
  insert into public.help_article_revisions (article_id, section_key, language, title, content, status, changed_by)
  values (new.id, new.section_key, new.language, new.title, new.content, new.status, new.updated_by);
  return new;
end;
$$;

drop trigger if exists help_articles_keep_revision on public.help_articles;
create trigger help_articles_keep_revision
  after insert or update on public.help_articles
  for each row execute function public.help_articles_keep_revision();

revoke all on function public.help_articles_stamp() from public;
revoke all on function public.help_articles_keep_revision() from public;

alter table public.help_articles enable row level security;
alter table public.help_article_revisions enable row level security;

drop policy if exists "Admin reads help articles" on public.help_articles;
create policy "Admin reads help articles" on public.help_articles
  for select to authenticated using (public.is_admin());

drop policy if exists "Admin adds help articles" on public.help_articles;
create policy "Admin adds help articles" on public.help_articles
  for insert to authenticated with check (public.is_admin());

drop policy if exists "Admin edits help articles" on public.help_articles;
create policy "Admin edits help articles" on public.help_articles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- History is read-only: only the trigger above writes it.
drop policy if exists "Admin reads help article history" on public.help_article_revisions;
create policy "Admin reads help article history" on public.help_article_revisions
  for select to authenticated using (public.is_admin());
