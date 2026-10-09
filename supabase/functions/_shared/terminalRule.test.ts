// Run with: node --experimental-strip-types --test supabase/functions/_shared/terminalRule.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeTerminal, sameTerminal } from './terminalRule.ts';

test('Terminal 1 is read from every way a source may write it', () => {
  for (const raw of ['1', 'T1', 't1', ' T1 ', 'Terminal 1', 'TERMINAL 1', 'T 1']) {
    assert.equal(normalizeTerminal(raw), 'T1', raw);
  }
});

test('T2, T2A, T2B and T2C are all Terminal 2', () => {
  for (const raw of ['2', 'T2', '2A', '2B', '2C', 'T2A', 't2b', 'T2C', 'Terminal 2', 'Terminal 2B']) {
    assert.equal(normalizeTerminal(raw), 'T2', raw);
  }
});

test('anything that is not one of the two terminals is unknown', () => {
  for (const raw of ['3', 'T3', '2D', '12', '', ' ', 'North', 'T', null, undefined, 1, {}]) {
    assert.equal(normalizeTerminal(raw), null, String(raw));
  }
});

test('passengers share a group only at the same, known terminal', () => {
  assert.equal(sameTerminal('T1', 'T1'), true);
  assert.equal(sameTerminal('T2', 'T2'), true);
  assert.equal(sameTerminal('T1', 'T2'), false);
  assert.equal(sameTerminal('T2', 'T1'), false);
});

test('an unknown terminal never matches - not even another unknown one', () => {
  assert.equal(sameTerminal(null, null), false);
  assert.equal(sameTerminal(undefined, undefined), false);
  assert.equal(sameTerminal(null, 'T1'), false);
  assert.equal(sameTerminal('T1', null), false);
  assert.equal(sameTerminal('T2', undefined), false);
});
