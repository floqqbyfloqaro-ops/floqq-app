// Run with: node --experimental-strip-types --test supabase/functions/_shared/matchingInterval.test.ts
//
// MATCHING_INTERVAL_MINUTES exists in three places that cannot import each other: the server's
// constants, the app's constants, and the job's schedule in the database (a migration). This
// fails when they disagree.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { MATCH_REJECTION_RECHECK_MINUTES, MATCHING_INTERVAL_MINUTES } from './constants.ts';

const root = new URL('../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

// The schedule in force: the one set by the latest migration that schedules the matching job.
function scheduledCron(): string {
  const migrations = readdirSync(new URL('supabase/migrations/', root)).sort();
  let cron: string | null = null;
  for (const file of migrations) {
    const match = read(`supabase/migrations/${file}`).match(/cron\.schedule\(\s*'match-and-group',\s*'([^']+)'/);
    if (match) cron = match[1];
  }
  assert.ok(cron, 'no migration schedules match-and-group');
  return cron;
}

const cronFor = (minutes: number) => (minutes === 1 ? '* * * * *' : `*/${minutes} * * * *`);

test('the job is scheduled every MATCHING_INTERVAL_MINUTES', () => {
  assert.equal(scheduledCron(), cronFor(MATCHING_INTERVAL_MINUTES));
});

test('the app has the same interval', () => {
  const match = read('src/constants.ts').match(/export const MATCHING_INTERVAL_MINUTES = (\d+);/);
  assert.equal(Number(match?.[1]), MATCHING_INTERVAL_MINUTES);
});

test('the admin dashboard expects the matcher at the same interval', () => {
  const match = read('src/services/jobRunRules.ts').match(/job: 'match-and-group', everyMinutes: (\d+)/);
  assert.equal(Number(match?.[1]), MATCHING_INTERVAL_MINUTES);
});

test('a rejected combination is asked about again by the next run, not the one after', () => {
  // Equal to the interval, a few seconds of timing would decide whether a run skips it.
  assert.ok(MATCH_REJECTION_RECHECK_MINUTES < MATCHING_INTERVAL_MINUTES);
});
