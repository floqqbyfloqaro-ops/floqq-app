// The avatars other passengers see: each member's chosen one (profiles.avatar_id), read here with
// the service role because a passenger can only read their own profile. The app maps the id to an
// image; null (no profile) shows its neutral default.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// user id -> avatar id, for the accounts that have a profile.
export async function profileAvatarIds(
  adminClient: SupabaseClient,
  userIds: (string | null | undefined)[]
): Promise<Map<string, number>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const { data, error } = await adminClient.from('profiles').select('user_id, avatar_id').in('user_id', ids);
  if (error) console.warn('reading avatars failed', error.message);
  return new Map(
    (data ?? [])
      .filter((row) => typeof row.avatar_id === 'number')
      .map((row) => [row.user_id as string, row.avatar_id as number])
  );
}

export function shownAvatarId(avatars: Map<string, number>, member: { user_id?: string | null }): number | null {
  return (member.user_id ? avatars.get(member.user_id) : undefined) ?? null;
}
