// The first names other passengers see - the only part of anyone's name they ever do. From the
// passenger's profile (what they set on their Profile screen, so a first name with a space in it
// stays whole); for an account without one, the first word of the name on their ride.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export function firstWord(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

// user id -> first name, for the accounts that have one in their profile.
export async function profileFirstNames(
  adminClient: SupabaseClient,
  userIds: (string | null | undefined)[]
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const { data, error } = await adminClient.from('profiles').select('user_id, first_name').in('user_id', ids);
  if (error) console.warn('reading first names failed', error.message);
  return new Map(
    (data ?? [])
      .filter((row) => typeof row.first_name === 'string' && row.first_name.trim() !== '')
      .map((row) => [row.user_id as string, (row.first_name as string).trim()])
  );
}

export function shownFirstName(
  names: Map<string, string>,
  member: { user_id?: string | null; passenger_name: string | null }
): string | null {
  return (member.user_id ? names.get(member.user_id) : undefined) ?? firstWord(member.passenger_name);
}
