import './src/i18n';

import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import AdminScreen from './src/screens/AdminScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import HomeScreen from './src/screens/HomeScreen';
import LoginScreen from './src/screens/LoginScreen';
import MyRideScreen from './src/screens/MyRideScreen';
import NewRequestScreen from './src/screens/NewRequestScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import WelcomeSplashScreen from './src/screens/WelcomeSplashScreen';
import { ADMIN_EMAIL, PAYMENTS_ENABLED } from './src/constants';
import WebAppFrame from './src/components/WebAppFrame';
import { handleStripeRedirect } from './src/services/cardSetup';
import { parseEmailVerifiedLink } from './src/services/emailVerification';
import { hasCompletedOnboarding, setOnboardingCompleted } from './src/services/onboarding';
import { supabase } from './src/services/supabase';

// The splash screen was designed with no buttons, so it auto-advances instead of waiting for a
// tap. This also doubles as the "loading" cover while the session/onboarding check resolves -
// isReady and this minimum timer both have to clear before we move on, so a fast session check
// doesn't make the splash flash by instantly - and a slow one keeps the splash up until it's done.
const MIN_SPLASH_MS = 4000;

export default function App() {
  return (
    <WebAppFrame>
      <AppContent />
    </WebAppFrame>
  );
}

function AppContent() {
  const [isReady, setIsReady] = useState(false);
  const [minSplashElapsed, setMinSplashElapsed] = useState(false);
  const [isSplashGone, setIsSplashGone] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'forgotPassword'>('login');
  const [mainScreen, setMainScreen] = useState<'home' | 'newRequest' | 'myRide' | 'admin' | 'profile'>('home');
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [showEmailVerified, setShowEmailVerified] = useState(false);

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
      return (
        <NewRequestScreen
          requestId={editingRequestId ?? undefined}
          onSubmitted={() => {
            setEditingRequestId(null);
            setMainScreen('home');
          }}
          onCancel={() => {
            setEditingRequestId(null);
            setMainScreen('home');
          }}
        />
      );
    }

    if (mainScreen === 'myRide') {
      return <MyRideScreen onBack={() => setMainScreen('home')} onCreateRequest={openNewRequest} />;
    }

    if (mainScreen === 'profile') {
      return <ProfileScreen onBack={() => setMainScreen('home')} />;
    }

    if (mainScreen === 'admin') {
      return <AdminScreen session={session} onBack={() => setMainScreen('home')} />;
    }

    return (
      <HomeScreen
        onCreateRequest={() => openNewRequest()}
        onOpenMyRide={() => setMainScreen('myRide')}
        isAdmin={session.user?.email === ADMIN_EMAIL}
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
