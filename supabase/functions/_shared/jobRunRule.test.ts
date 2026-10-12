// Run with: node --experimental-strip-types --test supabase/functions/_shared/jobRunRule.test.ts

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { jobRunOutcome } from './jobRunRule.ts';

test('a run that finished is a success, with what it reported', () => {
  assert.deepEqual(jobRunOutcome(200, '{"groupsCreated":2,"joinedExistingGroups":0}'), {
    kind: 'success',
    result: { groupsCreated: 2, joinedExistingGroups: 0 },
    problems: null,
  });
});

test('a job that had nothing to do because payments are off still ran', () => {
  assert.equal(jobRunOutcome(200, '{"skipped":"payments_disabled"}').kind, 'success');
});

test('a tick that found another run still going is not a run', () => {
  assert.deepEqual(jobRunOutcome(200, '{"skipped":true,"reason":"a run is already in progress"}'), { kind: 'ignored' });
  assert.deepEqual(jobRunOutcome(200, '{"skipped":"already_running"}'), { kind: 'ignored' });
});

test('a caller who was not allowed in is not a run', () => {
  assert.deepEqual(jobRunOutcome(401, '{"error":"Unauthorized"}'), { kind: 'ignored' });
});

test('a failed run is an error with its message', () => {
  assert.deepEqual(jobRunOutcome(500, '{"error":"Admin account not found"}'), {
    kind: 'error',
    message: 'Admin account not found',
  });
});

test('a failure without a readable message still says something', () => {
  assert.deepEqual(jobRunOutcome(502, ''), { kind: 'error', message: 'HTTP 502' });
  assert.deepEqual(jobRunOutcome(500, 'boom'), { kind: 'error', message: 'boom' });
});

test('a run that finished with problems along the way reports them', () => {
  const outcome = jobRunOutcome(200, '{"groupsCreated":1,"problems":["creating a group failed: x"]}');
  assert.equal(outcome.kind, 'success');
  assert.equal(outcome.kind === 'success' ? outcome.problems : null, 'creating a group failed: x');
});

test('a very long error is shortened', () => {
  const outcome = jobRunOutcome(500, JSON.stringify({ error: 'x'.repeat(2000) }));
  assert.equal(outcome.kind === 'error' ? outcome.message.length : 0, 501);
});
