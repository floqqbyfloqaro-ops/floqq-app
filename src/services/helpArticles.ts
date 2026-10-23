import { supabase } from './supabase';

// The help assistant's knowledge base (supabase/migrations/20261023020000_help_articles.sql): one
// article per section and language. English is the master; French and Spanish go live only once
// the admin publishes them. Only the admin can read or change these (row level security).

export type HelpLanguage = 'en' | 'fr' | 'es';
export const HELP_LANGUAGES: HelpLanguage[] = ['en', 'fr', 'es'];

export type HelpArticleStatus = 'draft' | 'published';

export type HelpArticle = {
  id: string;
  section_key: string;
  language: HelpLanguage;
  sort_order: number;
  title: string;
  content: string;
  status: HelpArticleStatus;
  updated_at: string;
  updated_by: string | null;
};

export type HelpArticleRevision = {
  id: number;
  title: string;
  content: string;
  status: HelpArticleStatus;
  changed_at: string;
  // null: written by the import script, not by a person.
  changed_by: string | null;
};

const ARTICLE_COLUMNS = 'id, section_key, language, sort_order, title, content, status, updated_at, updated_by';

export function fetchHelpArticles() {
  return supabase
    .from('help_articles')
    .select(ARTICLE_COLUMNS)
    .order('sort_order', { ascending: true })
    .returns<HelpArticle[]>();
}

// Saves a new title/content and/or status. Who changed it and when is set by the database, which
// also keeps the previous version in the history.
export function updateHelpArticle(id: string, patch: Partial<Pick<HelpArticle, 'title' | 'content' | 'status'>>) {
  return supabase.from('help_articles').update(patch).eq('id', id).select(ARTICLE_COLUMNS).single<HelpArticle>();
}

export function fetchHelpArticleRevisions(articleId: string) {
  return supabase
    .from('help_article_revisions')
    .select('id, title, content, status, changed_at, changed_by')
    .eq('article_id', articleId)
    .order('changed_at', { ascending: false })
    .limit(50)
    .returns<HelpArticleRevision[]>();
}

// Sections in document order, each with its version per language (missing ones are undefined).
export function groupBySection(articles: HelpArticle[]) {
  const sections = new Map<string, { sectionKey: string; sortOrder: number; byLanguage: Partial<Record<HelpLanguage, HelpArticle>> }>();
  for (const article of articles) {
    const section = sections.get(article.section_key) ?? { sectionKey: article.section_key, sortOrder: article.sort_order, byLanguage: {} };
    section.byLanguage[article.language] = article;
    if (article.language === 'en') section.sortOrder = article.sort_order;
    sections.set(article.section_key, section);
  }
  return [...sections.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}
