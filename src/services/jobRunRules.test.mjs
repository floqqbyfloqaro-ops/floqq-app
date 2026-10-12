// Run with: node --experimental-strip-types --test src/services/jobRunRules.test.mjs
//
// A plain .mjs file on purpose: the app's own TypeScript check doesn't cover test files, and Node
// loads the .ts file under test directly.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { jobHealth, jobNeedsAttention, overdueAfterMinutes, SCHEDULED_JOBS } from './jobRunRules.ts';

const MINUTE = 60_000;
const NOW = Date.parse('2026-10-12T12:00:00Z');
const MATCHER = { job: 'match-and-group', everyMinutes: 5 };
const SWEEP = { job: 'match-offer-sweep', everyMinutes: 1 };
const RECHECK = { job: 'recheck-landing-times', everyMinutes: 5 };

const ago = (minutes) => new Date(NOW - minutes * MINUTE).toISOString();
const run = (overrides = {}) => ({
  job: 'match-and-group',
  last_success_at: ago(1),
  last_error_at: null,
  last_error: null,
  ...overrides,
});

test('all five scheduled jobs are watched', () => {
  assert.deepEqual(
    SCHEDULED_JOBS.map((j) => j.job),
    ['match-and-group', 'match-offer-sweep', 'recheck-landing-times', 'payments-sync-holds', 'payments-settle-rides']
  );
});

test('an every-minute job is overdue after five minutes without a successful run', () => {
  assert.equal(overdueAfterMinutes(1), 5);
  assert.equal(jobHealth(SWEEP, run({ last_success_at: ago(5) }), NOW).state, 'ok');
  assert.equal(jobHealth(SWEEP, run({ last_success_at: ago(6) }), NOW).state, 'overdue');
});

test('a five-minute job, like the matcher, is given three of its intervals', () => {
  assert.equal(overdueAfterMinutes(5), 15);
  assert.equal(jobHealth(MATCHER, run({ last_success_at: ago(12) }), NOW).state, 'ok');
  assert.equal(jobHealth(MATCHER, run({ last_success_at: ago(16) }), NOW).state, 'overdue');
  assert.equal(jobHealth(RECHECK, run({ last_success_at: ago(16) }), NOW).state, 'overdue');
});

test('a job that just ran needs no attention', () => {
  const health = jobHealth(MATCHER, run(), NOW);
  assert.equal(health.state, 'ok');
  assert.equal(jobNeedsAttention(health), false);
});

test('a job that never recorded a run needs attention', () => {
  const health = jobHealth(MATCHER, undefined, NOW);
  assert.equal(health.state, 'never');
  assert.equal(jobNeedsAttention(health), true);
});

test('a job that stopped silently is noticed by its missing success', () => {
  // No error was ever recorded - it simply stopped running.
  const health = jobHealth(MATCHER, run({ last_success_at: ago(40) }), NOW);
  assert.equal(health.lastError, null);
  assert.equal(jobNeedsAttention(health), true);
});

test('an error after the last success means the job is failing now', () => {
  const health = jobHealth(MATCHER, run({ last_success_at: ago(3), last_error_at: ago(1), last_error: 'boom' }), NOW);
  assert.equal(health.errorIsCurrent, true);
  assert.equal(jobNeedsAttention(health), true);
});

test('an old error followed by a success is shown but no longer alarming', () => {
  const health = jobHealth(MATCHER, run({ last_success_at: ago(1), last_error_at: ago(90), last_error: 'boom' }), NOW);
  assert.equal(health.lastError, 'boom');
  assert.equal(health.errorIsCurrent, false);
  assert.equal(jobNeedsAttention(health), false);
});

test('an error with no success at all is current', () => {
  const health = jobHealth(MATCHER, run({ last_success_at: null, last_error_at: ago(1), last_error: 'boom' }), NOW);
  assert.equal(health.state, 'never');
  assert.equal(health.errorIsCurrent, true);
});
