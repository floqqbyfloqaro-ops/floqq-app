// Web build: no push notifications (see pushNotifications.ts for the phone version).

import { supabase } from './supabase';

export async function registerPushToken(): Promise<void> {}

export async function signOutAndUnregisterPush(): Promise<void> {
  await supabase.auth.signOut();
}

export type TappedNotification = { id: string; screen: string | null };

export function useTappedNotification(): TappedNotification | null {
  return null;
}
