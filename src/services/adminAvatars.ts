import { useEffect, useState } from 'react';

import { supabase } from './supabase';

// Admin only: the avatars of the accounts an admin list shows (row level security lets the admin
// read every profile). Passengers get other members' avatars from the group functions instead.

// user id -> avatar id. Empty until loaded, and on an error: the Avatar component then shows its
// neutral default.
export function useAvatarIds(userIds: (string | null | undefined)[]): Map<string, number> {
  const [avatars, setAvatars] = useState<Map<string, number>>(new Map());
  const key = [...new Set(userIds.filter((id): id is string => !!id))].sort().join(',');

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    supabase
      .from('profiles')
      .select('user_id, avatar_id')
      .in('user_id', key.split(','))
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn('loading avatars failed', error);
          return;
        }
        setAvatars(new Map((data ?? []).map((row) => [row.user_id as string, row.avatar_id as number])));
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return avatars;
}
