// Run with: node --experimental-strip-types --test supabase/functions/_shared/helpKnowledgeBase.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { INTRO_SECTION_KEY, parseKnowledgeBase, sectionKeyFor } from './helpKnowledgeBase.ts';

const sample = [
  '# FLOQQ Help Bot Knowledge Base',
  '',
  'This is the single source of truth.',
  '',
  '## What FLOQQ is',
  '',
  'FLOQQ matches travelers.',
  '',
  '## Match found and securing your spot',
  '',
  '- "Secure my spot" reserves an amount.',
  '',
].join('\r\n');

test('one section per "## " heading, plus the intro, in document order', () => {
  const sections = parseKnowledgeBase(sample);
  assert.deepEqual(
    sections.map((s) => [s.sectionKey, s.sortOrder, s.title]),
    [
      [INTRO_SECTION_KEY, 0, 'FLOQQ Help Bot Knowledge Base'],
      ['what_floqq_is', 1, 'What FLOQQ is'],
      ['match_found_and_securing_your_spot', 2, 'Match found and securing your spot'],
    ]
  );
  assert.equal(sections[1].content, 'FLOQQ matches travelers.');
  assert.equal(sections[2].content.includes('## '), false);
});

test('keys are plain, stable and accent-free', () => {
  assert.equal(sectionKeyFor('Cancellations, refunds and delays'), 'cancellations_refunds_and_delays');
  assert.equal(sectionKeyFor('Sécurité, vie privée et données'), 'securite_vie_privee_et_donnees');
});

test('a translation is keyed by position, like the English master', () => {
  const english = parseKnowledgeBase(sample);
  const french = parseKnowledgeBase(sample.replace('What FLOQQ is', "Ce qu'est FLOQQ"), english.map((s) => s.sectionKey));
  assert.equal(french[1].sectionKey, 'what_floqq_is');
  assert.equal(french[1].title, "Ce qu'est FLOQQ");
});

test('a translation with a missing section is refused', () => {
  const keys = parseKnowledgeBase(sample).map((s) => s.sectionKey);
  assert.throws(() => parseKnowledgeBase(sample.replace(/## What FLOQQ is[\s\S]*?(?=## )/, ''), keys));
});

test('the real knowledge base and its translations line up section by section', () => {
  const read = (name: string) => readFileSync(new URL(`../../../docs/${name}`, import.meta.url), 'utf8');
  const english = parseKnowledgeBase(read('help-knowledge-base.md'));
  assert.ok(english.length >= 10, String(english.length));
  assert.ok(english.some((s) => s.sectionKey === 'bot_rules'));
  assert.equal(new Set(english.map((s) => s.sectionKey)).size, english.length, 'section keys are unique');
  for (const language of ['fr', 'es']) {
    const translated = parseKnowledgeBase(read(`help-knowledge-base.${language}.md`), english.map((s) => s.sectionKey));
    for (const [index, section] of translated.entries()) {
      assert.ok(section.content.length > 0, `${language}: ${section.sectionKey} is empty`);
      // Facts that must survive translation: the fee (written the local way), the emergency number,
      // and the TO DECIDE marker, which stays in English so the assistant recognises it everywhere.
      for (const fact of [/2[.,]49/g, /\b112\b/g, /TO DECIDE/g]) {
        assert.equal(
          (english[index].content.match(fact) ?? []).length,
          (section.content.match(fact) ?? []).length,
          `${language}: ${fact} in ${section.sectionKey}`
        );
      }
    }
  }
});
