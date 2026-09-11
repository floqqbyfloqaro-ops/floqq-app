// Shared overlap guard for scheduled Edge Functions (match-and-group uses lock id 1,
// recheck-landing-times uses lock id 2 - see the match_engine_lock migrations). A plain
// atomic UPDATE on a single-row-per-job table, not a Postgres advisory lock, because
// Supabase's pooled connections don't guarantee the session affinity advisory locks need.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// A run older than this is assumed to have crashed without releasing the lock, so a later
// run is allowed to take over rather than being blocked forever.
const LOCK_STALE_AFTER_MS = 2 * 60 * 1000;

export async function acquireLock(client: SupabaseClient, lockId: number): Promise<boolean> {
  const staleBefore = new Date(Date.now() - LOCK_STALE_AFTER_MS).toISOString();
  const { data, error } = await client
    .from('match_engine_lock')
    .update({ locked_at: new Date().toISOString() })
    .eq('id', lockId)
    .or(`locked_at.is.null,locked_at.lt.${staleBefore}`)
    .select('id');

  return !error && (data?.length ?? 0) > 0;
}

export async function releaseLock(client: SupabaseClient, lockId: number): Promise<void> {
  await client.from('match_engine_lock').update({ locked_at: null }).eq('id', lockId);
}
