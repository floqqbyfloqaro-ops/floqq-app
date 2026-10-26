import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TEAM_LANGUAGES as LANGUAGES } from '../services/helpChat';
import { fetchSupportSettings, saveSupportSettings, SupportSettings } from '../services/helpMetrics';
import { baseText, borders, colors, radii, spacing } from '../theme/colors';
import AuthTextInput from './AuthTextInput';
import Card from './Card';
import ErrorNotice from './ErrorNotice';
import PrimaryButton from './PrimaryButton';

// Admin dashboard, Help tab: the support settings - the team's WhatsApp number (WhatsApp is offered
// to passengers as soon as it is set), where new-ticket alerts go, the languages the team speaks,
// and how long help conversations are kept. Support hours are around the clock for now.
export default function AdminSupportSettings() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<SupportSettings | null>(null);
  const [whatsapp, setWhatsapp] = useState('');
  const [alertEmail, setAlertEmail] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [retention, setRetention] = useState('90');
  const [saving, setSaving] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await fetchSupportSettings();
    if (error || !data) return setErrorKey('adminSupportSettings.loadError');
    setErrorKey(null);
    setSettings(data);
    setWhatsapp(data.whatsapp_number ?? '');
    setAlertEmail(data.alert_email ?? '');
    setLanguages(data.team_languages);
    setRetention(String(data.retention_days));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaved(false);
    const number = whatsapp.trim();
    const digits = number.replace(/\D/g, '');
    if (number && (!number.startsWith('+') || digits.length < 8 || digits.length > 15)) return setErrorKey('adminSupportSettings.invalidWhatsapp');
    const email = alertEmail.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setErrorKey('adminSupportSettings.invalidEmail');
    const days = Number(retention);
    if (!Number.isInteger(days) || days < 7 || days > 730) return setErrorKey('adminSupportSettings.invalidRetention');
    if (languages.length === 0) return setErrorKey('adminSupportSettings.invalidLanguages');
    setErrorKey(null);
    setSaving(true);
    const { data, error } = await saveSupportSettings({
      whatsapp_number: number || null,
      alert_email: email || null,
      team_languages: LANGUAGES.filter((l) => languages.includes(l)),
      retention_days: days,
    });
    setSaving(false);
    if (error || !data) return setErrorKey('adminSupportSettings.saveError');
    setSettings(data);
    setSaved(true);
  };

  if (!settings) return errorKey ? <ErrorNotice message={t(errorKey)} onRetry={load} retryLabel={t('common.retry')} /> : null;

  return (
    <Card style={styles.card}>
      <Text style={styles.title} accessibilityRole="header">
        {t('adminSupportSettings.title')}
      </Text>
      <Text style={styles.label}>{t('adminSupportSettings.whatsapp')}</Text>
      <AuthTextInput variant="card" value={whatsapp} onChangeText={setWhatsapp} placeholder="+34 600 000 000" keyboardType="phone-pad" accessibilityLabel={t('adminSupportSettings.whatsapp')} />
      <Text style={styles.hint}>{t('adminSupportSettings.whatsappHint')}</Text>

      <Text style={styles.label}>{t('adminSupportSettings.alertEmail')}</Text>
      <AuthTextInput
        variant="card"
        value={alertEmail}
        onChangeText={setAlertEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={t('adminSupportSettings.alertEmail')}
      />

      <Text style={styles.label}>{t('adminSupportSettings.languages')}</Text>
      <View style={styles.chips}>
        {LANGUAGES.map((language) => {
          const on = languages.includes(language);
          return (
            <Pressable
              key={language}
              onPress={() => setLanguages((current) => (on ? current.filter((l) => l !== language) : [...current, language]))}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <Text style={styles.chipText}>{t(`adminHelp.language.${language}`)}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={styles.label}>{t('adminSupportSettings.retention')}</Text>
      <AuthTextInput variant="card" value={retention} onChangeText={setRetention} keyboardType="number-pad" accessibilityLabel={t('adminSupportSettings.retention')} />
      <Text style={styles.hint}>{t('adminSupportSettings.retentionHint')}</Text>
      <Text style={styles.hint}>{t('adminSupportSettings.hours')}</Text>

      {errorKey ? <ErrorNotice message={t(errorKey)} /> : null}
      <PrimaryButton label={t('adminSupportSettings.save')} onPress={save} loading={saving} />
      {saved ? (
        <Text style={styles.saved} accessibilityLiveRegion="polite">
          {t('adminSupportSettings.saved')}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.x4,
  },
  title: {
    ...baseText.h3,
    marginBottom: spacing.x2,
  },
  label: {
    ...baseText.label,
    marginTop: spacing.x2,
    marginBottom: spacing.x2,
  },
  hint: {
    ...baseText.caption,
    color: colors.textSecondary,
    marginBottom: spacing.x2,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.x2,
    marginBottom: spacing.x2,
  },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.x4,
    borderRadius: radii.pill,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
  },
  chipOn: {
    borderColor: colors.accentPrimaryStrong,
    backgroundColor: colors.accentPrimarySoft,
  },
  chipText: {
    ...baseText.bodySmall,
    fontWeight: '600',
  },
  saved: {
    ...baseText.bodySmall,
    color: colors.success,
    textAlign: 'center',
    marginTop: spacing.x3,
  },
});
