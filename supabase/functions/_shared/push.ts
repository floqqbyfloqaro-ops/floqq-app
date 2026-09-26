// Sends push notifications through Expo's push service to every phone a user has registered
// (push_tokens), each in that phone's language. Never throws: a failed notification must never
// break the payment step that triggered it. Phones Expo reports as no longer registered are
// removed.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { formatPushTime, PushLocale, PushMessageKey, renderPushMessage } from './pushMessages.ts';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export type PushRequest = {
  userId: string;
  key: PushMessageKey;
  amountCents?: number;
  // Shown as a Barcelona-time clock time, e.g. the hold deadline.
  timeIso?: string | null;
};

export async function sendPush(adminClient: SupabaseClient, request: PushRequest): Promise<void> {
  try {
    const { data: tokens } = await adminClient
      .from('push_tokens')
      .select('token, locale')
      .eq('user_id', request.userId);
    if (!tokens?.length) return;

    const messages = tokens.map(({ token, locale }) => {
      const pushLocale = locale as PushLocale;
      const { title, body } = renderPushMessage(request.key, pushLocale, {
        amount: request.amountCents != null ? (request.amountCents / 100).toFixed(2) : undefined,
        time: request.timeIso ? formatPushTime(request.timeIso, pushLocale) : undefined,
      });
      // Tapping any payments notification opens My ride.
      return { to: token, title, body, sound: 'default', data: { screen: 'myRide' } };
    });

    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const response = await fetch(EXPO_PUSH_URL, { method: 'POST', headers, body: JSON.stringify(messages) });
    const result = await response.json().catch(() => null);
    const tickets: { status: string; details?: { error?: string } }[] = result?.data ?? [];

    const staleTokens = tickets
      .map((ticket, index) => (ticket.details?.error === 'DeviceNotRegistered' ? messages[index].to : null))
      .filter((token): token is string => token != null);
    if (staleTokens.length) {
      await adminClient.from('push_tokens').delete().in('token', staleTokens);
    }
  } catch (err) {
    console.warn('sendPush failed', err);
  }
}
