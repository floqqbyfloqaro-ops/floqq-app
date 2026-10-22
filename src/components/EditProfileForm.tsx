import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { cleanPersonName, isPlausibleEmail, isValidPersonName, NAME_MAX_LENGTH } from '../services/profileRules';
import { MyAccount, MyProfile, requestEmailChange, updateMyName } from '../services/profile';
import { baseText, colors, spacing } from '../theme/colors';
import AuthTextInput from './AuthTextInput';
import ErrorNotice from './ErrorNotice';
import PrimaryButton from './PrimaryButton';
import SecondaryButton from './SecondaryButton';

type Props = {
  profile: MyProfile;
  account: MyAccount;
  onCancel: () => void;
  // Called once everything asked for is saved, with the confirmation to show on the profile.
  onSaved: (message: string) => void;
};

// Editing the passenger's name and email, with Save and Cancel. The rules are checked here first
// (profileRules.ts) so the passenger sees what is wrong under the field; the server checks them
// again and has the last word. An email managed by Google or Apple isn't editable.
export default function EditProfileForm({ profile, account, onCancel, onSaved }: Props) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState(profile.firstName);
  const [lastName, setLastName] = useState(profile.lastName);
  const [email, setEmail] = useState(account.pendingEmail ?? account.email);
  const [errors, setErrors] = useState<{ firstName?: string; lastName?: string; email?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const emailEditable = account.provider === 'email';

  const handleSave = async () => {
    setFormError(null);
    const nextErrors: typeof errors = {};
    if (!isValidPersonName(firstName)) nextErrors.firstName = t('profileEdit.nameInvalid', { max: NAME_MAX_LENGTH });
    if (!isValidPersonName(lastName)) nextErrors.lastName = t('profileEdit.nameInvalid', { max: NAME_MAX_LENGTH });
    const newEmail = email.trim();
    const emailChanged =
      emailEditable &&
      newEmail.toLowerCase() !== account.email.toLowerCase() &&
      newEmail.toLowerCase() !== (account.pendingEmail ?? '').toLowerCase();
    if (emailChanged && !isPlausibleEmail(newEmail)) nextErrors.email = t('profileEdit.emailInvalid');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const nameChanged =
      cleanPersonName(firstName) !== profile.firstName || cleanPersonName(lastName) !== profile.lastName;

    setIsSaving(true);
    if (nameChanged) {
      const { error } = await updateMyName(firstName, lastName);
      if (error) {
        setIsSaving(false);
        if (error === 'invalid_first_name') setErrors({ firstName: t('profileEdit.nameInvalid', { max: NAME_MAX_LENGTH }) });
        else if (error === 'invalid_last_name') setErrors({ lastName: t('profileEdit.nameInvalid', { max: NAME_MAX_LENGTH }) });
        else setFormError(t('profileEdit.saveError'));
        return;
      }
    }
    if (emailChanged) {
      const { error } = await requestEmailChange(newEmail);
      if (error) {
        setIsSaving(false);
        const message =
          error === 'email_exists'
            ? t('profileEdit.emailTaken')
            : error === 'invalid'
              ? t('profileEdit.emailInvalid')
              : error === 'rate_limited'
                ? t('profileEdit.emailRateLimited')
                : t('profileEdit.saveError');
        setErrors({ email: message });
        // The name may already be saved: say so, so nobody types it again.
        if (nameChanged) setFormError(t('profileEdit.nameSavedEmailFailed'));
        return;
      }
    }
    setIsSaving(false);
    onSaved(emailChanged ? t('profileEdit.savedEmailSent', { email: newEmail }) : t('profileEdit.saved'));
  };

  return (
    <View>
      <Text style={styles.title}>{t('profileEdit.title')}</Text>

      {formError ? <ErrorNotice message={formError} /> : null}

      <Text style={styles.label}>{t('profileEdit.firstName')}</Text>
      <AuthTextInput
        placeholder={t('profileEdit.firstName')}
        accessibilityLabel={t('profileEdit.firstName')}
        value={firstName}
        onChangeText={setFirstName}
        autoCapitalize="words"
        autoComplete="given-name"
        textContentType="givenName"
        maxLength={NAME_MAX_LENGTH + 10}
        errorText={errors.firstName}
      />
      <Text style={styles.label}>{t('profileEdit.lastName')}</Text>
      <AuthTextInput
        placeholder={t('profileEdit.lastName')}
        accessibilityLabel={t('profileEdit.lastName')}
        value={lastName}
        onChangeText={setLastName}
        autoCapitalize="words"
        autoComplete="family-name"
        textContentType="familyName"
        maxLength={NAME_MAX_LENGTH + 10}
        errorText={errors.lastName}
        helperText={t('profileEdit.firstNameShared')}
      />

      <Text style={styles.label}>{t('profileEdit.email')}</Text>
      {emailEditable ? (
        <AuthTextInput
          placeholder={t('profileEdit.email')}
          accessibilityLabel={t('profileEdit.email')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          errorText={errors.email}
          helperText={t('profileEdit.emailHelp')}
        />
      ) : (
        <View style={styles.readOnly}>
          <Text style={styles.readOnlyValue} selectable>
            {account.email}
          </Text>
          <Text style={styles.readOnlyNote}>
            {t(account.provider === 'apple' ? 'profile.emailManagedApple' : 'profile.emailManagedGoogle')}
          </Text>
        </View>
      )}

      <View style={styles.buttons}>
        <PrimaryButton label={t('profileEdit.save')} onPress={handleSave} loading={isSaving} />
      </View>
      <SecondaryButton label={t('profileEdit.cancel')} onPress={onCancel} disabled={isSaving} />
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    ...baseText.h2,
    marginBottom: spacing.x6,
  },
  label: {
    ...baseText.label,
    marginBottom: spacing.x2,
  },
  readOnly: {
    marginBottom: spacing.x4,
  },
  readOnlyValue: {
    ...baseText.body,
  },
  readOnlyNote: {
    ...baseText.caption,
    color: colors.textSecondary,
    marginTop: spacing.x1,
  },
  buttons: {
    marginTop: spacing.x4,
    marginBottom: spacing.x3,
  },
});
