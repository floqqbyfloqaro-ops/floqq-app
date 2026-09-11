import './src/i18n';

import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import AdminScreen from './src/screens/AdminScreen';
import HomeScreen from './src/screens/HomeScreen';
import LoginScreen from './src/screens/LoginScreen';
import NewRequestScreen from './src/screens/NewRequestScreen';
import OnboardingScreen from './src/screens/OnboardingScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import { ADMIN_EMAIL } from './src/constants';
import { hasCompletedOnboarding, setOnboardingCompleted } from './src/services/onboarding';
import { supabase } from './src/services/supabase';
import { colors } from './src/theme/colors';

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [mainScreen, setMainScreen] = useState<'home' | 'newRequest' | 'admin'>('home');

  useEffect(() => {
    Promise.all([hasCompletedOnboarding(), supabase.auth.getSession()]).then(([completed, { data }]) => {
      setShowOnboarding(!completed);
      setSession(data.session);
      setIsReady(true);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  if (!isReady) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
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
    return authMode === 'login' ? (
      <LoginScreen onSwitchToSignUp={() => setAuthMode('signup')} />
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

  if (mainScreen === 'admin') {
    return <AdminScreen session={session} onBack={() => setMainScreen('home')} />;
  }

  return (
    <HomeScreen
      onCreateRequest={() => setMainScreen('newRequest')}
      isAdmin={session.user?.email === ADMIN_EMAIL}
      onOpenAdmin={() => setMainScreen('admin')}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
