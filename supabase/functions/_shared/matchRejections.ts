// The match_rejections table for the matching job - the rule itself is _shared/matchRejectionRule.ts.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { MATCH_REJECTION_RECHECK_MINUTES } from './constants.ts';
import { createRejectionMemory } from './matchRejectionRule.ts';
import type { RejectionMemory, RejectionRow } from './matchRejectionRule.ts';

const MINUTE_MS = 60_000;

// Rows this old have long stopped counting and are cleared out.
const KEEP_MS = 24 * 60 * MINUTE_MS;

// Starts empty when the table can't be read: the job then simply asks about everything, as it
// did before it had a memory.
export async function loadRejectionMemory(adminClient: SupabaseClient, now: Date): Promise<RejectionMemory> {
  const since = new Date(now.getTime() - MATCH_REJECTION_RECHECK_MINUTES * MINUTE_MS).toISOString();
  const { data, error } = await adminClient
    .from('match_rejections')
    .select('group_key, fingerprint, rejected_at')
    .gte('rejected_at', since);
  if (error) console.warn('loading the match rejections failed', error.message);
  return createRejectionMemory((data ?? []) as RejectionRow[], now.getTime(), MATCH_REJECTION_RECHECK_MINUTES);
}

// Best effort: a rejection that isn't stored only costs one more lookup next time.
export async function saveRejectionMemory(adminClient: SupabaseClient, memory: RejectionMemory, now: Date): Promise<void> {
  const added = memory.added();
  if (added.length > 0) {
    const { error } = await adminClient.from('match_rejections').upsert(added);
    if (error) console.warn('storing the match rejections failed', error.message);
  }
  const { error: cleanupError } = await adminClient
    .from('match_rejections')
    .delete()
    .lt('rejected_at', new Date(now.getTime() - KEEP_MS).toISOString());
  if (cleanupError) console.warn('clearing old match rejections failed', cleanupError.message);
}
