import './src/i18n';

import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AdminScreen from './src/screens/AdminScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import HelpScreen from './src/screens/HelpScreen';
import HomeScreen from './src/screens/HomeScreen';
import LoginScreen from './src/screens/LoginScreen';
import MyRideScreen from './src/screens/MyRideScreen';
import NewRequestScreen from './src/screens/NewRequestScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import DateOfBirthGate from './src/screens/DateOfBirthGate';
import SignUpScreen from './src/screens/SignUpScreen';
import WelcomeSplashScreen from './src/screens/WelcomeSplashScreen';
import { PAYMENTS_ENABLED } from './src/constants';
import WebAppFrame from './src/components/WebAppFrame';
import { fetchIsAdmin } from './src/services/adminRole';
import { handleStripeRedirect } from './src/services/cardSetup';
import { parseEmailVerifiedLink } from './src/services/emailVerification';
import type { FindGroupOpenSource } from './src/services/findGroup';
import { shouldOpenFindGroupNow } from './src/services/findGroupAutoOpen';
import { hasUnseenCompletedRide } from './src/services/rideCompletion';
import { registerPushToken, useTappedNotification } from './src/services/pushNotifications';
import { hasCompletedOnboarding, setOnboardingCompleted } from './src/services/onboarding';
import { supabase } from './src/services/supabase';

// The splash screen was designed with no buttons, so it auto-advances instead of waiting for a
// tap. This also doubles as the "loading" cover while the session/onboarding check resolves -
// isReady and this minimum timer both have to clear before we move on, so a fast session check
// doesn't make the splash flash by instantly - and a slow one keeps the splash up until it's done.
const MIN_SPLASH_MS = 4000;

export default function App() {
  return (
    <SafeAreaProvider>
      <WebAppFrame>
        <AppContent />
      </WebAppFrame>
    </SafeAreaProvider>
  );
}

function AppContent() {
  const [isReady, setIsReady] = useState(false);
  const [minSplashElapsed, setMinSplashElapsed] = useState(false);
  const [isSplashGone, setIsSplashGone] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'forgotPassword'>('login');
  const [mainScreen, setMainScreen] = useState<'home' | 'newRequest' | 'myRide' | 'admin' | 'profile' | 'help'>('home');
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [showEmailVerified, setShowEmailVerified] = useState(false);
  // Set to take My ride straight to "Find your group" (a new nonce each time).
  const [openFindGroup, setOpenFindGroup] = useState<{ nonce: number; source: FindGroupOpenSource } | null>(null);
  const mainScreenRef = useRef(mainScreen);
  mainScreenRef.current = mainScreen;

  const clearOpenFindGroup = useCallback(() => setOpenFindGroup(null), []);

  const goToFindGroup = (source: FindGroupOpenSource) => {
    setOpenFindGroup({ nonce: Date.now(), source });
    setMainScreen('myRide');
  };

  // "Open FLOQQ" on the email-verified page (docs/email-verified.html) opens
  // floqq://email-verified#access_token=…&refresh_token=… - log the passenger straight in and
  // confirm the verification on Home. Covers both a cold start and an already-running app.
  const linkingUrl = Linking.useLinkingURL();
  const handledLinkRef = useRef<string | null>(null);
  useEffect(() => {
    if (!linkingUrl || handledLinkRef.current === linkingUrl) return;
    handledLinkRef.current = linkingUrl;

    // Returning from a bank's 3D Secure page while saving a card - Stripe's link, not ours.
    if (PAYMENTS_ENABLED && linkingUrl.includes('stripe-redirect')) {
      handleStripeRedirect(linkingUrl);
      return;
    }

    const tokens = parseEmailVerifiedLink(linkingUrl);
    if (!tokens) return;

    supabase.auth
      .setSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken })
      .then(({ error }) => {
        if (error) {
          // Tokens expired or already used - the email is still verified, they just log in normally.
          console.warn('setSession (email verified link) failed', error);
          return;
        }
        setMainScreen('home');
        setShowEmailVerified(true);
      });
  }, [linkingUrl]);

  // Register this phone for push notifications once someone is logged in.
  const userId = session?.user?.id;

  // Whether the logged-in user has the admin role - asked of the server for this user alone.
  // Only decides what the app shows; the server checks the role again on everything admin-only.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    setIsAdmin(false);
    if (!userId) return;
    let cancelled = false;
    fetchIsAdmin().then((admin) => {
      if (!cancelled) setIsAdmin(admin);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  useEffect(() => {
    if (userId) registerPushToken();
  }, [userId]);

  // A tapped notification (also one that launched the app) opens the screen it points at.
  const tappedNotification = useTappedNotification();
  const handledNotificationRef = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || !tappedNotification) return;
    if (handledNotificationRef.current === tappedNotification.id) return;
    handledNotificationRef.current = tappedNotification.id;
    if (tappedNotification.screen === 'findGroup') {
      goToFindGroup('notification');
    } else if (tappedNotification.screen === 'myRide') {
      setMainScreen('myRide');
    } else if (tappedNotification.screen === 'help') {
      setMainScreen('help');
    }
  }, [tappedNotification, userId]);

  // Opening the app (or coming back to it) after landing goes straight to "Find your group"
  // instead of Home - once per ride, and only from Home: never away from what the passenger is
  // doing.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const check = async () => {
      if (mainScreenRef.current !== 'home') return;
      const open = await shouldOpenFindGroupNow();
      if (!cancelled && open && mainScreenRef.current === 'home') {
        goToFindGroup('app_open');
        return;
      }
      // A ride completed by itself (the receipt, or after a few hours) that the passenger hasn't
      // seen: My Ride shows "Ride completed" for it, once.
      const completed = await hasUnseenCompletedRide();
      if (!cancelled && completed && mainScreenRef.current === 'home') setMainScreen('myRide');
    };
    check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [userId]);

  const openNewRequest = (requestId?: string) => {
    setEditingRequestId(requestId ?? null);
    setMainScreen('newRequest');
  };

  useEffect(() => {
    Promise.all([hasCompletedOnboarding(), supabase.auth.getSession()]).then(([completed, { data }]) => {
      setShowOnboarding(!completed);
      setSession(data.session);
      setIsReady(true);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    const timer = setTimeout(() => setMinSplashElapsed(true), MIN_SPLASH_MS);

    return () => {
      authListener.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  const canShowApp = isReady && minSplashElapsed;

  const renderScreen = () => {
    if (showOnboarding) {
      return (
        <OnboardingScreen
          onComplete={async () => {
            await setOnboardingCompleted();
            setShowOnboarding(false);
          }}
        />
      );
    }

    if (!session) {
      if (authMode === 'forgotPassword') {
        return <ForgotPasswordScreen onBackToLogin={() => setAuthMode('login')} />;
      }
      return authMode === 'login' ? (
        <LoginScreen onSwitchToSignUp={() => setAuthMode('signup')} onForgotPassword={() => setAuthMode('forgotPassword')} />
      ) : (
        <SignUpScreen onSwitchToLogin={() => setAuthMode('login')} />
      );
    }

    if (mainScreen === 'newRequest') {
      const closeRequest = () => {
        setEditingRequestId(null);
        setMainScreen('home');
      };
      // Creating or editing a ride needs a date of birth showing 18 or older: asked for once.
      return (
        <DateOfBirthGate onBack={closeRequest}>
          <NewRequestScreen requestId={editingRequestId ?? undefined} onSubmitted={closeRequest} onCancel={closeRequest} />
        </DateOfBirthGate>
      );
    }

    if (mainScreen === 'myRide') {
      return (
        <MyRideScreen
          onBack={() => setMainScreen('home')}
          onCreateRequest={openNewRequest}
          onOpenProfile={() => setMainScreen('profile')}
          openFindGroup={openFindGroup}
          onFindGroupOpened={clearOpenFindGroup}
        />
      );
    }

    if (mainScreen === 'profile') {
      return <ProfileScreen onBack={() => setMainScreen('home')} onOpenHelp={() => setMainScreen('help')} />;
    }

    if (mainScreen === 'help') {
      return <HelpScreen onBack={() => setMainScreen('profile')} />;
    }

    if (mainScreen === 'admin') {
      return <AdminScreen isAdmin={isAdmin} onBack={() => setMainScreen('home')} />;
    }

    return (
      <HomeScreen
        onCreateRequest={() => openNewRequest()}
        onOpenMyRide={() => setMainScreen('myRide')}
        isAdmin={isAdmin}
        onOpenAdmin={() => setMainScreen('admin')}
        showProfile={PAYMENTS_ENABLED}
        onOpenProfile={() => setMainScreen('profile')}
        showEmailVerified={showEmailVerified}
        onDismissEmailVerified={() => setShowEmailVerified(false)}
      />
    );
  };

  // One tree for the whole lifetime so the splash is never remounted (no image flicker): it covers
  // everything while loading, then stays on top of the first real screen while it fades out.
  return (
    <View style={styles.root}>
      {canShowApp ? renderScreen() : null}
      {isSplashGone ? null : (
        <View style={StyleSheet.absoluteFill} pointerEvents={canShowApp ? 'none' : 'auto'}>
          <WelcomeSplashScreen fadeOut={canShowApp} onFadeOutComplete={() => setIsSplashGone(true)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
