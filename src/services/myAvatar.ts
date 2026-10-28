import { useSyncExternalStore } from 'react';

import { supabase } from './supabase';

// The logged-in passenger's own avatar, shared by every screen: a change on the Profile screen
// shows everywhere at once, without waiting for a server round trip or a restart. Other
// passengers' avatars come with the group (match-offer, find-group).

let myAvatarId: number | null = null;
const listeners = new Set<() => void>();

function publish(id: number | null) {
  myAvatarId = id;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Null until loaded (and when logged out): the Avatar component then shows its neutral default.
export function useMyAvatarId(): number | null {
  return useSyncExternalStore(subscribe, () => myAvatarId);
}

// Called by App when someone logs in (and with null when they log out).
export async function loadMyAvatar(userId: string | null) {
  if (!userId) {
    publish(null);
    return;
  }
  const { data, error } = await supabase.from('profiles').select('avatar_id').eq('user_id', userId).maybeSingle();
  if (error) {
    console.warn('loading the avatar failed', error);
    return;
  }
  publish(typeof data?.avatar_id === 'number' ? data.avatar_id : null);
}

// Saves one after the other, so quick taps reach the server in the order they were made.
let saving: Promise<unknown> = Promise.resolve();

// Shown at once; put back if the server refuses it.
export async function setMyAvatar(avatarId: number): Promise<{ error: boolean }> {
  const previous = myAvatarId;
  publish(avatarId);
  const request = saving.then(() => supabase.rpc('set_my_avatar', { p_avatar_id: avatarId }));
  saving = request.catch(() => {});
  const { error } = await request;
  if (error) {
    console.warn('set_my_avatar failed', error);
    // Unless another one was picked meanwhile.
    if (myAvatarId === avatarId) publish(previous);
    return { error: true };
  }
  return { error: false };
}
