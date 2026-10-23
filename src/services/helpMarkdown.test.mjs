// Run with: node --experimental-strip-types --test src/services/helpMarkdown.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseHelpMarkdown, parseInline, plainText } from './helpMarkdown.ts';

test('bold and links, no symbols left', () => {
  assert.deepEqual(parseInline('The fee is **€2.49** - see [our site](https://floqq.app).'), [
    { type: 'text', text: 'The fee is ' },
    { type: 'bold', text: '€2.49' },
    { type: 'text', text: ' - see ' },
    { type: 'link', text: 'our site', url: 'https://floqq.app' },
    { type: 'text', text: '.' },
  ]);
});

test('a bare link keeps its full stop outside', () => {
  assert.deepEqual(parseInline('Go to https://floqq.app.'), [
    { type: 'text', text: 'Go to ' },
    { type: 'link', text: 'https://floqq.app', url: 'https://floqq.app' },
    { type: 'text', text: '.' },
  ]);
});

test('only safe links become tappable', () => {
  assert.deepEqual(parseInline('[click](javascript:alert(1))'), [{ type: 'text', text: 'click' }, { type: 'text', text: ')' }]);
});

test('numbered steps and bullet lists become lists; paragraphs stay paragraphs', () => {
  const blocks = parseHelpMarkdown('To cancel:\n1. Open **My ride**\n2. Tap Cancel ride\n\nGood to know:\n- It is free\n- Any time');
  assert.deepEqual(blocks.map((b) => b.type), ['paragraph', 'numbered', 'paragraph', 'bullets']);
  assert.equal(blocks[1].items.length, 2);
  assert.deepEqual(blocks[1].items[0], [{ type: 'text', text: 'Open ' }, { type: 'bold', text: 'My ride' }]);
  assert.equal(blocks[3].items.length, 2);
});

test('headings and stray markers are dropped, the words kept', () => {
  assert.equal(plainText('## Fee\nThe *fee* is `€2.49`.'), 'Fee The fee is €2.49.');
});

test('the plain text reads the list with its numbers', () => {
  assert.equal(plainText('Steps:\n1. One\n2. Two'), 'Steps:\n1. One\n2. Two');
});
