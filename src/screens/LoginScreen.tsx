import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import { supabase } from '../services/supabase';
import { baseText, colors, overlays, spacing } from '../theme/colors';

type Props = {
  onSwitchToSignUp: () => void;
  onForgotPassword: () => void;
};

export default function LoginScreen({ onSwitchToSignUp, onForgotPassword }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogin = async () => {
    setErrorMessage(null);
    setIsSubmitting(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setIsSubmitting(false);
    if (error) {
      console.warn('signInWithPassword failed', error);
      setErrorMessage(t('auth.loginError'));
    }
  };

  // Real Apple Sign-In needs an Apple Developer Program account and a configured Supabase OAuth
  // provider, neither of which exists yet - this is a visual placeholder only, matching the
  // solo-taxi button's "coming soon" pattern elsewhere in the app.
  const handleAppleSignIn = () => {
    Alert.alert(t('common.comingSoon'));
  };

  // Opens the Google consent screen in a native auth session and exchanges the resulting
  // tokens for a Supabase session. This will only complete end-to-end once the Google Cloud
  // OAuth client + Supabase provider config exist (see the setup steps this depends on) - and,
  // same limitation already documented in ForgotPasswordScreen, Expo Go doesn't reliably
  // register the app's custom URL scheme for the redirect back, so full testing needs a real
  // dev/standalone build, not Expo Go.
  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    const redirectTo = Linking.createURL('/');

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });

    if (error || !data?.url) {
      console.warn('signInWithOAuth (google) failed', error);
      setErrorMessage(t('auth.loginError'));
      return;
    }

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) {
      return;
    }

    const params = new URLSearchParams(result.url.split('#')[1] ?? '');
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (!accessToken || !refreshToken) {
      console.warn('Google OAuth redirect missing tokens', result.url);
      setErrorMessage(t('auth.loginError'));
      return;
    }

    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (sessionError) {
      console.warn('setSession (google) failed', sessionError);
      setErrorMessage(t('auth.loginError'));
    }
  };

  return (
    <ScreenBackground
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={overlays.scrimHeavy}
    >
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Image source={require('../../assets/icon-full.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.wordmark}>FLOQQ</Text>

          <Text style={styles.title}>{t('auth.loginTitle')}</Text>
          <Text style={styles.subtitle}>{t('auth.loginSubtitle')}</Text>

          <AuthTextInput
            variant="card"
            leadingIcon="mail-outline"
            placeholder={t('auth.emailPlaceholder')}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <AuthTextInput
            variant="card"
            leadingIcon="lock-closed-outline"
            trailingIcon={isPasswordVisible ? 'eye-off-outline' : 'eye-outline'}
            onTrailingIconPress={() => setIsPasswordVisible((v) => !v)}
            trailingIconLabel={isPasswordVisible ? t('auth.hidePassword') : t('auth.showPassword')}
            placeholder={t('auth.passwordPlaceholder')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!isPasswordVisible}
          />

          {errorMessage ? <ErrorNotice message={errorMessage} onRetry={handleLogin} retryLabel={t('common.retry')} /> : null}

          <PrimaryButton label={t('auth.loginButton')} onPress={handleLogin} loading={isSubmitting} />

          <Pressable
            onPress={onForgotPassword}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={t('auth.forgotPasswordLink')}
          >
            <Text style={styles.forgotPasswordText}>{t('auth.forgotPasswordLink')}</Text>
          </Pressable>

          <View style={styles.separatorRow}>
            <View style={styles.separatorLine} />
            <Text style={styles.separatorText}>{t('auth.orSeparator')}</Text>
            <View style={styles.separatorLine} />
          </View>

          <SecondaryButton icon="logo-apple" label={t('auth.continueWithApple')} onPress={handleAppleSignIn} />
          <View style={styles.buttonGap} />
          <SecondaryButton icon="logo-google" label={t('auth.continueWithGoogle')} onPress={handleGoogleSignIn} />

          <Pressable
            onPress={onSwitchToSignUp}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={`${t('auth.noAccount')} ${t('auth.signUpLink')}`}
          >
            <Text style={styles.switchText}>
              {t('auth.noAccount')} <Text style={styles.switchLink}>{t('auth.signUpLink')}</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    paddingTop: spacing.x12,
    paddingHorizontal: spacing.x6,
    paddingBottom: spacing.x12,
    alignItems: 'center',
  },
  logo: {
    // Same badge as the splash screen, scaled down (splash uses 96) since this screen has
    // more content competing for space.
    width: 64,
    height: 64,
  },
  wordmark: {
    ...baseText.h1,
    marginTop: spacing.x2,
    marginBottom: spacing.x6,
  },
  title: {
    ...baseText.h1,
    textAlign: 'center',
  },
  subtitle: {
    ...baseText.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.x2,
    marginBottom: spacing.x8,
  },
  forgotPasswordText: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.x6,
  },
  buttonGap: {
    height: spacing.x3,
  },
  separatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: spacing.x3,
    marginBottom: spacing.x6,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: overlays.overlayWhite16,
  },
  separatorText: {
    ...baseText.caption,
    color: colors.textSecondary,
  },
  switchText: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.x6,
  },
  switchLink: {
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
