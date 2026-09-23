import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

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
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const handleSignUp = async () => {
    setErrorMessage(null);
    setInfoMessage(null);

    if (!fullName.trim()) {
      setErrorMessage(t('auth.missingNameError'));
      return;
    }

    setIsSubmitting(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName.trim() } },
    });
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
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={overlays.scrimHeavy}
    >
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Image source={require('../../assets/icon-full.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.wordmark}>FLOQQ</Text>

          <Text style={styles.title}>{t('auth.signUpTitle')}</Text>

          <AuthTextInput
            variant="card"
            leadingIcon="person-outline"
            placeholder={t('auth.fullNamePlaceholder')}
            value={fullName}
            onChangeText={setFullName}
            autoCapitalize="words"
            autoCorrect={false}
            textContentType="name"
          />
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
