// Run with: node --experimental-strip-types --test supabase/functions/_shared/supportInboxRules.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyAction, parseTicketAction } from './supportInboxRules.ts';

const NOW = Date.parse('2026-10-23T13:00:00Z');
const callback = { status: 'open', channel: 'callback', firstContactAt: null, callAttempts: 0 } as const;
const whatsapp = { ...callback, channel: 'whatsapp' } as const;

test('"Called - resolved": resolved with its category, one call, first contact now', () => {
  assert.deepEqual(applyAction(callback, { action: 'called_resolved', category: 'payment' }, NOW), {
    change: {
      status: 'resolved',
      resolution_category: 'payment',
      resolved_at: '2026-10-23T13:00:00.000Z',
      first_contact_at: '2026-10-23T13:00:00.000Z',
      call_attempts: 1,
      last_call_at: '2026-10-23T13:00:00.000Z',
    },
  });
});

test('"No answer": counted as a call, but not as a contact', () => {
  const result = applyAction(callback, { action: 'no_answer' }, NOW);
  assert.deepEqual(result, { change: { status: 'no_answer', call_attempts: 1, last_call_at: '2026-10-23T13:00:00.000Z' } });
});

test('"Call again later": in progress, with the next call 30 minutes, 1 or 2 hours ahead', () => {
  const result = applyAction({ ...callback, callAttempts: 1 }, { action: 'call_later', minutes: 60 }, NOW);
  assert.equal('change' in result && result.change.callback_at, '2026-10-23T14:00:00.000Z');
  assert.equal('change' in result && result.change.call_attempts, 2);
  assert.deepEqual(applyAction(callback, { action: 'call_later', minutes: 7 }, NOW), { error: 'invalid_minutes' });
});

test('the first contact is kept once set', () => {
  const contacted = { ...callback, status: 'in_progress', firstContactAt: '2026-10-23T12:00:00Z' } as const;
  const result = applyAction(contacted, { action: 'resolve', category: 'other' }, NOW);
  assert.equal('change' in result && result.change.first_contact_at, undefined);
});

test('call actions only for call-back tickets; a resolution needs a valid category', () => {
  assert.deepEqual(applyAction(whatsapp, { action: 'no_answer' }, NOW), { error: 'not_a_callback' });
  assert.deepEqual(applyAction(whatsapp, { action: 'resolve', category: 'app_bug' }, NOW).change?.status, 'resolved');
  assert.deepEqual(applyAction(whatsapp, { action: 'resolve', category: 'nonsense' }, NOW), { error: 'invalid_category' });
});

test('a resolved ticket takes notes, nothing else', () => {
  const resolved = { ...callback, status: 'resolved' } as const;
  assert.deepEqual(applyAction(resolved, { action: 'no_answer' }, NOW), { error: 'already_resolved' });
  assert.deepEqual(applyAction(resolved, { action: 'note', body: 'Refund done by hand.' }, NOW), { change: {} });
  assert.deepEqual(applyAction(callback, { action: 'note', body: '   ' }, NOW), { error: 'invalid_note' });
});

test('only known actions are read from a request', () => {
  assert.deepEqual(parseTicketAction({ action: 'call_later', minutes: '30' }), { action: 'call_later', minutes: 30 });
  assert.equal(parseTicketAction({ action: 'delete' }), null);
  assert.equal(parseTicketAction({ action: 'note' }), null);
});
