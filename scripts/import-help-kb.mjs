// Imports the help assistant's knowledge base into help_articles, one row per section:
//   docs/help-knowledge-base.md     English master -> published
//   docs/help-knowledge-base.fr.md  French         -> draft (the admin reviews and publishes it)
//   docs/help-knowledge-base.es.md  Spanish        -> draft
// Sections that already exist are left alone - edits made in the admin are never overwritten -
// unless --replace is given (then a replaced French or Spanish section goes back to draft).
//
// Runs against the TEST project (.env.test.local: TEST_SUPABASE_URL,
// TEST_SUPABASE_SERVICE_ROLE_KEY):
//   node --env-file=.env.test.local scripts/import-help-kb.mjs [--replace]
// The live project only with --live and LIVE_SUPABASE_URL / LIVE_SUPABASE_SERVICE_ROLE_KEY set.

import { readFileSync } from 'node:fs';

import { createClient } from '@supabase/supabase-js';

import { parseKnowledgeBase } from '../supabase/functions/_shared/helpKnowledgeBase.ts';

const LIVE_PROJECT_REF = 'notpvjikdbbelrdgplkc';

const live = process.argv.includes('--live');
const replace = process.argv.includes('--replace');
const url = live ? process.env.LIVE_SUPABASE_URL : process.env.TEST_SUPABASE_URL;
const serviceRoleKey = live ? process.env.LIVE_SUPABASE_SERVICE_ROLE_KEY : process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error(live ? 'Set LIVE_SUPABASE_URL and LIVE_SUPABASE_SERVICE_ROLE_KEY.' : 'Missing TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY in .env.test.local.');
  process.exit(2);
}
if (!live && url.includes(LIVE_PROJECT_REF)) {
  console.error('TEST_SUPABASE_URL points at the LIVE project. Use --live on purpose, or fix .env.test.local.');
  process.exit(2);
}

const read = (name) => readFileSync(new URL(`../docs/${name}`, import.meta.url), 'utf8');
const english = parseKnowledgeBase(read('help-knowledge-base.md'));
const keys = english.map((section) => section.sectionKey);
const versions = [
  { language: 'en', status: 'published', sections: english },
  { language: 'fr', status: 'draft', sections: parseKnowledgeBase(read('help-knowledge-base.fr.md'), keys) },
  { language: 'es', status: 'draft', sections: parseKnowledgeBase(read('help-knowledge-base.es.md'), keys) },
];

const service = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: existing, error: loadError } = await service.from('help_articles').select('section_key, language');
if (loadError) {
  console.error(`Reading help_articles failed: ${loadError.message}`);
  process.exit(1);
}
const present = new Set((existing ?? []).map((row) => `${row.section_key}|${row.language}`));

let added = 0;
let replaced = 0;
let kept = 0;
for (const { language, status, sections } of versions) {
  for (const section of sections) {
    const row = {
      section_key: section.sectionKey,
      language,
      sort_order: section.sortOrder,
      title: section.title,
      content: section.content,
      status,
    };
    if (!present.has(`${section.sectionKey}|${language}`)) {
      const { error } = await service.from('help_articles').insert(row);
      if (error) throw new Error(`${language}/${section.sectionKey}: ${error.message}`);
      added += 1;
    } else if (replace) {
      const { error } = await service
        .from('help_articles')
        .update(row)
        .eq('section_key', section.sectionKey)
        .eq('language', language);
      if (error) throw new Error(`${language}/${section.sectionKey}: ${error.message}`);
      replaced += 1;
    } else {
      kept += 1;
    }
  }
}

console.log(`${live ? 'LIVE' : 'TEST'}: ${added} sections added, ${replaced} replaced, ${kept} left as they were.`);
