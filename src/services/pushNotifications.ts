import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { PAYMENTS_ENABLED } from '../constants';
import i18n from '../i18n';
import { supabase } from './supabase';

// Push notifications for the payments prototype (seat reservation reminders etc., sent by the
// Edge Functions through Expo's push service - see supabase/functions/_shared/push.ts). Behind
// PAYMENTS_ENABLED like the rest of the prototype. Never asks for permission itself: onboarding
// already does; a phone without permission simply isn't registered. The web build uses
// pushNotifications.web.ts instead (no push on web).

let registeredToken: string | null = null;

if (PAYMENTS_ENABLED) {
  // Show notifications as a banner while the app is open, too.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

// Registers this phone for the logged-in user, in the app's current language.
export async function registerPushToken(): Promise<void> {
  if (!PAYMENTS_ENABLED) return;

  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'FLOQQ',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    // Uses the EAS project id from app.json (expo.extra.eas.projectId).
    const { data: token } = await Notifications.getExpoPushTokenAsync();
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS,
      p_locale: i18n.language,
    });
    if (error) {
      console.warn('register_push_token failed', error);
      return;
    }
    registeredToken = token;
  } catch (err) {
    console.warn('Push registration failed', err);
  }
}

// Logs out, first detaching this phone so the next user doesn't get the previous one's pushes.
export async function signOutAndUnregisterPush(): Promise<void> {
  if (registeredToken) {
    const { error } = await supabase.rpc('unregister_push_token', { p_token: registeredToken });
    if (error) console.warn('unregister_push_token failed', error);
    registeredToken = null;
  }
  await supabase.auth.signOut();
}

export type TappedNotification = { id: string; screen: string | null };

// The most recently tapped notification (also one that launched the app) and the screen it
// asks to open.
export function useTappedNotification(): TappedNotification | null {
  const response = Notifications.useLastNotificationResponse();
  if (!response) return null;
  const screen = response.notification.request.content.data?.screen;
  return { id: response.notification.request.identifier, screen: typeof screen === 'string' ? screen : null };
}
