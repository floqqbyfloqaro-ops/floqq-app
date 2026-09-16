import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
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

  return (
    <ScreenBackground
      source={require('../../assets/bg-hero.png')}
      naturalWidth={329}
      naturalHeight={1536}
      scrimColor={overlays.scrimHeavy}
    >
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={styles.title}>{t('auth.loginTitle')}</Text>

        <AuthTextInput
          placeholder={t('auth.emailPlaceholder')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <AuthTextInput
          placeholder={t('auth.passwordPlaceholder')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
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
      </KeyboardAvoidingView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.x6,
    justifyContent: 'center',
  },
  title: {
    ...baseText.h1,
    textAlign: 'center',
    marginBottom: spacing.x8,
  },
  forgotPasswordText: {
    ...baseText.bodySmall,
    textAlign: 'center',
    marginBottom: spacing.x4,
  },
  switchText: {
    ...baseText.bodySmall,
    textAlign: 'center',
  },
  switchLink: {
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
