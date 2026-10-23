// The help assistant's knowledge base (docs/help-knowledge-base.md): split into one section per
// "## " heading for the help_articles table, and keyed so the French and Spanish versions line up
// with the English master. No Deno-touching imports, so the import script and a plain Node test
// (helpKnowledgeBase.test.ts) use it too.

export type HelpLanguage = 'en' | 'fr' | 'es';
export const HELP_LANGUAGES: HelpLanguage[] = ['en', 'fr', 'es'];

export type KnowledgeSection = {
  sectionKey: string;
  sortOrder: number;
  title: string;
  content: string;
};

// The text before the first "## " heading (the document's own title and purpose) is a section too.
export const INTRO_SECTION_KEY = 'introduction';

// "Match found and securing your spot" -> "match_found_and_securing_your_spot".
export function sectionKeyFor(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

// Splits the markdown into sections in document order. The intro keeps the document's "# " title
// as its title; every other section is titled by its "## " heading, which isn't repeated in the
// content. Keys come from the English headings - pass `keys` (the English sections' keys, in order)
// to key a translation by position instead of by its translated headings.
export function parseKnowledgeBase(markdown: string, keys?: string[]): KnowledgeSection[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const raw: { title: string; body: string[]; intro: boolean }[] = [];
  let current: { title: string; body: string[]; intro: boolean } = { title: '', body: [], intro: true };

  for (const line of lines) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      raw.push(current);
      current = { title: heading[1].trim(), body: [], intro: false };
      continue;
    }
    const docTitle = /^# (.+)$/.exec(line);
    if (current.intro && docTitle && !current.title) {
      current.title = docTitle[1].trim();
      continue;
    }
    current.body.push(line);
  }
  raw.push(current);

  const sections = raw
    .map((section) => ({ ...section, content: section.body.join('\n').trim() }))
    .filter((section) => !(section.intro && !section.content && !section.title));

  if (keys && keys.length !== sections.length) {
    throw new Error(`Expected ${keys.length} sections (like the English master), found ${sections.length}.`);
  }

  return sections.map((section, index) => ({
    sectionKey: keys ? keys[index] : section.intro ? INTRO_SECTION_KEY : sectionKeyFor(section.title),
    sortOrder: index,
    title: section.title,
    content: section.content,
  }));
}
