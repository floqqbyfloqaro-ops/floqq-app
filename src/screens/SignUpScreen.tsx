import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import DateOfBirthField from '../components/DateOfBirthField';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import VerifyEmailNotice from '../components/VerifyEmailNotice';
import { signUpWithEmail } from '../services/emailVerification';
import { MIN_PASSWORD_LENGTH } from '../services/passwordRules';
import {
  barcelonaToday,
  cleanPersonName,
  isAdultOn,
  isValidPersonName,
  NAME_MAX_LENGTH,
  parseIsoDate,
} from '../services/profileRules';
import { baseText, colors, overlays, spacing } from '../theme/colors';

type Props = {
  onSwitchToLogin: () => void;
};

export default function SignUpScreen({ onSwitchToLogin }: Props) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ firstName?: string; lastName?: string; dateOfBirth?: string; password?: string }>({});
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);

  const handleSignUp = async () => {
    setErrorMessage(null);

    const errors: typeof fieldErrors = {};
    if (!isValidPersonName(firstName)) errors.firstName = t('profileEdit.nameInvalid', { max: NAME_MAX_LENGTH });
    if (!isValidPersonName(lastName)) errors.lastName = t('profileEdit.nameInvalid', { max: NAME_MAX_LENGTH });
    if (!dateOfBirth) errors.dateOfBirth = t('dateOfBirth.required');
    // Supabase Auth's own minimum (password_min_length) is the same.
    if (password.length < MIN_PASSWORD_LENGTH) errors.password = t('auth.passwordTooShortError');
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    // Under 18: said kindly, and nothing is sent - no account, no data. (The server refuses it too.)
    const born = dateOfBirth ? parseIsoDate(dateOfBirth) : null;
    if (!born || !isAdultOn(born, barcelonaToday())) {
      setFieldErrors({ dateOfBirth: t('dateOfBirth.underAge') });
      return;
    }

    setIsSubmitting(true);
    const { data, error } = await signUpWithEmail({
      firstName: cleanPersonName(firstName),
      lastName: cleanPersonName(lastName),
      email: email.trim(),
      password,
      dateOfBirth: dateOfBirth!,
    });
    setIsSubmitting(false);

    if (error) {
      console.warn('signUp failed', error);
      setErrorMessage(t('auth.signUpError'));
      return;
    }

    // No session means "Confirm email" is on: the account exists but can't log in until verified.
    if (!data.session) {
      setPendingVerificationEmail(email.trim());
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

          {pendingVerificationEmail ? (
            <VerifyEmailNotice email={pendingVerificationEmail} onBackToLogin={onSwitchToLogin} justSent />
          ) : (
            <>
            <Text style={styles.title}>{t('auth.signUpTitle')}</Text>

            <AuthTextInput
              variant="card"
              leadingIcon="person-outline"
              placeholder={t('profileEdit.firstName')}
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
              autoCorrect={false}
              textContentType="givenName"
              errorText={fieldErrors.firstName}
            />
            <AuthTextInput
              variant="card"
              leadingIcon="person-outline"
              placeholder={t('profileEdit.lastName')}
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
              autoCorrect={false}
              textContentType="familyName"
              errorText={fieldErrors.lastName}
            />
            <View style={styles.dateOfBirth}>
              <Text style={styles.label}>{t('dateOfBirth.label')}</Text>
              <DateOfBirthField value={dateOfBirth} onChange={setDateOfBirth} errorText={fieldErrors.dateOfBirth} />
              <Text style={styles.hint}>{t('dateOfBirth.signUpHint')}</Text>
            </View>
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
              errorText={fieldErrors.password}
              textContentType="newPassword"
              autoComplete="new-password"
            />

            {errorMessage ? <ErrorNotice message={errorMessage} onRetry={handleSignUp} retryLabel={t('common.retry')} /> : null}

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
            </>
          )}
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
  dateOfBirth: {
    alignSelf: 'stretch',
    marginBottom: spacing.x4,
  },
  label: {
    ...baseText.label,
    marginBottom: spacing.x2,
  },
  hint: {
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
