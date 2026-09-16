import './src/i18n';

import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';

import AdminScreen from './src/screens/AdminScreen';
import ForgotPasswordScreen from './src/screens/ForgotPasswordScreen';
import HomeScreen from './src/screens/HomeScreen';
import LoginScreen from './src/screens/LoginScreen';
import MyRideScreen from './src/screens/MyRideScreen';
import NewRequestScreen from './src/screens/NewRequestScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import WelcomeSplashScreen from './src/screens/WelcomeSplashScreen';
import { ADMIN_EMAIL } from './src/constants';
import { hasCompletedOnboarding, setOnboardingCompleted } from './src/services/onboarding';
import { supabase } from './src/services/supabase';

// The splash screen was designed with no buttons, so it auto-advances instead of waiting for a
// tap. This also doubles as the "loading" cover while the session/onboarding check resolves -
// isReady and this minimum timer both have to clear before we move on, so a fast session check
// doesn't make the splash flash by instantly.
const MIN_SPLASH_MS = 1800;

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [minSplashElapsed, setMinSplashElapsed] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'forgotPassword'>('login');
  const [mainScreen, setMainScreen] = useState<'home' | 'newRequest' | 'myRide' | 'admin'>('home');

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

  if (!isReady || !minSplashElapsed) {
    return <WelcomeSplashScreen />;
  }

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
        onSubmitted={() => setMainScreen('home')}
        onCancel={() => setMainScreen('home')}
      />
    );
  }

  if (mainScreen === 'myRide') {
    return (
      <MyRideScreen onBack={() => setMainScreen('home')} onCreateRequest={() => setMainScreen('newRequest')} />
    );
  }

  if (mainScreen === 'admin') {
    return <AdminScreen session={session} onBack={() => setMainScreen('home')} />;
  }

  return (
    <HomeScreen
      onCreateRequest={() => setMainScreen('newRequest')}
      onOpenMyRide={() => setMainScreen('myRide')}
      isAdmin={session.user?.email === ADMIN_EMAIL}
      onOpenAdmin={() => setMainScreen('admin')}
    />
  );
}
