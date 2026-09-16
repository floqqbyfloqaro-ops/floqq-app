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
  onSwitchToLogin: () => void;
};

export default function SignUpScreen({ onSwitchToLogin }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleSignUp = async () => {
    setErrorMessage(null);
    setInfoMessage(null);
    setIsSubmitting(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setIsSubmitting(false);

    if (error) {
      console.warn('signUp failed', error);
      setErrorMessage(t('auth.signUpError'));
      return;
    }

    if (!data.session) {
      setInfoMessage(t('auth.confirmEmailMessage'));
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
        <Text style={styles.title}>{t('auth.signUpTitle')}</Text>

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

        {errorMessage ? <ErrorNotice message={errorMessage} onRetry={handleSignUp} retryLabel={t('common.retry')} /> : null}
        {infoMessage ? <Text style={styles.info}>{infoMessage}</Text> : null}

        <PrimaryButton label={t('auth.signUpButton')} onPress={handleSignUp} loading={isSubmitting} />

        <Pressable
          onPress={onSwitchToLogin}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={`${t('auth.haveAccount')} ${t('auth.loginLink')}`}
        >
          <Text style={styles.switchText}>
            {t('auth.haveAccount')} <Text style={styles.switchLink}>{t('auth.loginLink')}</Text>
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
  info: {
    ...baseText.bodySmall,
    color: colors.info,
    marginBottom: spacing.x4,
    textAlign: 'center',
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
