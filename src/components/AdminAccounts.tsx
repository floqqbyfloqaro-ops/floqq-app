import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  correctDateOfBirth,
  fetchProfileEvents,
  fetchUnderAgeAccounts,
  findAccountByEmail,
  FlaggedAccount,
  FoundAccount,
  ProfileEvent,
} from '../services/adminAccounts';
import { isPlausibleEmail } from '../services/profileRules';
import { baseText, colors, spacing } from '../theme/colors';
import { formatBarcelonaDateTime } from '../utils/formatDateTime';
import AuthTextInput from './AuthTextInput';
import Card from './Card';
import DateOfBirthField, { formatDateOfBirth } from './DateOfBirthField';
import ErrorNotice from './ErrorNotice';
import PrimaryButton from './PrimaryButton';
import SecondaryButton from './SecondaryButton';
import Skeleton from './Skeleton';

type Props = {
  // Only the "accounts under 18" warning, for the top of the dashboard's first tab.
  warningsOnly?: boolean;
  // Reloads when this changes (the dashboard's pull-to-refresh).
  refreshKey?: number;
  // From the warning: open the Accounts tab.
  onOpenAccounts?: () => void;
};

// Admin dashboard, "Accounts" tab: accounts flagged under 18, and an account looked up by its
// email - its date of birth, how it was entered or corrected, and the correction itself (the only
// way to change a date of birth once set; recorded with who, when and why).
export default function AdminAccounts({ warningsOnly = false, refreshKey = 0, onOpenAccounts }: Props) {
  const { t, i18n } = useTranslation();
  const [flagged, setFlagged] = useState<FlaggedAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [email, setEmail] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [found, setFound] = useState<FoundAccount | null>(null);
  const [events, setEvents] = useState<ProfileEvent[]>([]);

  const [newDate, setNewDate] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [correctionMessage, setCorrectionMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const loadFlagged = useCallback(async () => {
    const { data, error } = await fetchUnderAgeAccounts();
    setIsLoading(false);
    if (error) {
      console.warn('fetchUnderAgeAccounts failed', error);
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setFlagged(data ?? []);
  }, []);

  useEffect(() => {
    loadFlagged();
  }, [loadFlagged, refreshKey]);

  const date = (iso: string | null) => (iso ? formatDateOfBirth(iso, i18n.language) : t('adminAccounts.noDateOfBirth'));
  const nameOf = (account: { first_name: string; last_name: string; email: string }) =>
    `${account.first_name} ${account.last_name}`.trim() || account.email;

  const stillUnderAge = flagged.filter((account) => account.still_under_age);

  if (warningsOnly) {
    if (stillUnderAge.length === 0) return null;
    return (
      <Card style={styles.row} onPress={onOpenAccounts} accessibilityLabel={t('adminAccounts.warning', { count: stillUnderAge.length })}>
        <Text style={styles.warningTitle}>{t('adminAccounts.warning', { count: stillUnderAge.length })}</Text>
        <Text style={styles.warningText}>{t('adminAccounts.warningDetail')}</Text>
      </Card>
    );
  }

  const openAccount = async (account: FoundAccount | null) => {
    setFound(account);
    setNewDate(null);
    setNote('');
    setIsConfirming(false);
    setCorrectionMessage(null);
    setEvents([]);
    if (!account) return;
    const { data, error } = await fetchProfileEvents(account.user_id);
    if (error) console.warn('fetchProfileEvents failed', error);
    setEvents(data ?? []);
  };

  const handleSearch = async (lookup: string = email) => {
    setSearchMessage(null);
    if (!isPlausibleEmail(lookup)) {
      setSearchMessage(t('profileEdit.emailInvalid'));
      return;
    }
    setIsSearching(true);
    const { account, error } = await findAccountByEmail(lookup);
    setIsSearching(false);
    if (error) {
      console.warn('findAccountByEmail failed', error);
      setSearchMessage(t('adminAccounts.searchError'));
      return;
    }
    if (!account) setSearchMessage(t('adminAccounts.notFound'));
    await openAccount(account);
  };

  const handleCorrect = async () => {
    if (!found || !newDate) return;
    setIsSaving(true);
    const { error } = await correctDateOfBirth(found.user_id, newDate, note);
    setIsSaving(false);
    setIsConfirming(false);
    if (error) {
      console.warn('correctDateOfBirth failed', error);
      setCorrectionMessage({ text: t('adminAccounts.correctError'), ok: false });
      return;
    }
    const { account } = await findAccountByEmail(found.email);
    await openAccount(account);
    setCorrectionMessage({ text: t('adminAccounts.corrected'), ok: true });
    loadFlagged();
  };

  const eventLine = (event: ProfileEvent) => {
    const when = formatBarcelonaDateTime(event.created_at);
    if (event.event_type === 'date_of_birth_corrected') {
      return t('adminAccounts.eventCorrected', {
        when,
        from: date(event.details?.from ?? null),
        to: date(event.details?.to ?? null),
        note: event.details?.note || '-',
      });
    }
    if (event.event_type === 'date_of_birth_set') {
      return t(event.details?.under_age ? 'adminAccounts.eventSetUnderAge' : 'adminAccounts.eventSet', { when });
    }
    return `${when} · ${event.event_type}`;
  };

  return (
    <View>
      <Text style={styles.intro}>{t('adminAccounts.intro')}</Text>

      <Text style={styles.sectionTitle}>{t('adminAccounts.flaggedTitle')}</Text>
      {isLoading ? (
        <Card style={styles.row} accessible accessibilityLabel={t('admin.loading')}>
          <Skeleton width={160} height={18} style={styles.skeletonGap} />
          <Skeleton width={220} height={14} />
        </Card>
      ) : loadFailed ? (
        <ErrorNotice message={t('adminAccounts.loadError')} onRetry={loadFlagged} retryLabel={t('common.retry')} />
      ) : flagged.length === 0 ? (
        <Text style={styles.empty}>{t('adminAccounts.flaggedEmpty')}</Text>
      ) : (
        flagged.map((account) => (
          <Card
            key={account.user_id}
            style={styles.row}
            onPress={() => {
              setEmail(account.email);
              handleSearch(account.email);
            }}
            accessibilityLabel={`${nameOf(account)}, ${account.email}`}
          >
            <Text style={styles.name}>{nameOf(account)}</Text>
            <Text style={styles.meta}>{account.email}</Text>
            <Text style={styles.meta}>
              {t('adminAccounts.bornFlagged', {
                date: date(account.date_of_birth),
                flagged: formatBarcelonaDateTime(account.under_age_at),
              })}
            </Text>
            <Text style={account.still_under_age ? styles.warningText : styles.okText}>
              {t(account.still_under_age ? 'adminAccounts.stillUnderAge' : 'adminAccounts.nowAdult')}
            </Text>
          </Card>
        ))
      )}

      <Text style={styles.sectionTitle}>{t('adminAccounts.findTitle')}</Text>
      <Card style={styles.row}>
        <AuthTextInput
          placeholder={t('adminAccounts.emailPlaceholder')}
          accessibilityLabel={t('adminAccounts.emailPlaceholder')}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
        />
        <SecondaryButton label={t('adminAccounts.search')} icon="search-outline" onPress={() => handleSearch()} loading={isSearching} />
        {searchMessage ? <Text style={styles.meta}>{searchMessage}</Text> : null}
      </Card>

      {found ? (
        <Card style={styles.row}>
          <Text style={styles.name}>{nameOf(found)}</Text>
          <Text style={styles.meta}>{found.email}</Text>
          <Text style={styles.meta}>{t('adminAccounts.provider', { provider: found.provider })}</Text>
          <Text style={styles.field}>{t('adminAccounts.dateOfBirth', { date: date(found.date_of_birth) })}</Text>
          {found.under_age_at ? (
            <Text style={styles.warningText}>
              {t('adminAccounts.flaggedOn', { date: formatBarcelonaDateTime(found.under_age_at) })}
            </Text>
          ) : null}

          {events.length > 0 ? (
            <View style={styles.history}>
              <Text style={styles.label}>{t('adminAccounts.historyTitle')}</Text>
              {events.map((event) => (
                <Text key={event.id} style={styles.meta}>
                  {eventLine(event)}
                </Text>
              ))}
            </View>
          ) : null}

          <Text style={styles.label}>{t('adminAccounts.correctTitle')}</Text>
          <DateOfBirthField value={newDate} onChange={setNewDate} />
          <AuthTextInput
            placeholder={t('adminAccounts.notePlaceholder')}
            accessibilityLabel={t('adminAccounts.notePlaceholder')}
            value={note}
            onChangeText={setNote}
          />
          {isConfirming && newDate ? (
            <View style={styles.confirm}>
              <Text style={styles.warningText}>
                {t('adminAccounts.correctConfirm', { from: date(found.date_of_birth), to: date(newDate) })}
              </Text>
              <View style={styles.confirmRow}>
                <Pressable onPress={handleCorrect} disabled={isSaving} accessibilityRole="button" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <Text style={styles.confirmLink}>{t('adminAccounts.correctYes')}</Text>
                </Pressable>
                <Pressable onPress={() => setIsConfirming(false)} accessibilityRole="button" hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <Text style={styles.cancelLink}>{t('adminAirlines.changeCancel')}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <PrimaryButton
              label={t('adminAccounts.correctButton')}
              onPress={() => setIsConfirming(true)}
              disabled={!newDate || newDate === found.date_of_birth || note.trim() === ''}
              loading={isSaving}
            />
          )}
          {correctionMessage ? (
            <Text style={correctionMessage.ok ? styles.okText : styles.warningText}>{correctionMessage.text}</Text>
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  intro: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.x4,
  },
  sectionTitle: {
    ...baseText.h3,
    marginTop: spacing.x2,
    marginBottom: spacing.x3,
  },
  row: {
    marginBottom: spacing.x3,
  },
  skeletonGap: {
    marginBottom: spacing.x2,
  },
  empty: {
    ...baseText.body,
    color: colors.textSecondary,
    marginBottom: spacing.x4,
  },
  name: {
    ...baseText.body,
    fontWeight: '600',
    marginBottom: spacing.x1,
  },
  meta: {
    ...baseText.caption,
    color: colors.textSecondary,
    marginTop: spacing.x1,
  },
  field: {
    ...baseText.body,
    marginTop: spacing.x3,
  },
  label: {
    ...baseText.label,
    marginTop: spacing.x4,
    marginBottom: spacing.x2,
  },
  history: {
    marginTop: spacing.x2,
  },
  warningTitle: {
    ...baseText.body,
    color: colors.warning,
    fontWeight: '700',
    marginBottom: spacing.x1,
  },
  warningText: {
    ...baseText.caption,
    color: colors.warning,
    marginTop: spacing.x1,
  },
  okText: {
    ...baseText.caption,
    color: colors.success,
    marginTop: spacing.x2,
  },
  confirm: {
    gap: spacing.x3,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: spacing.x6,
  },
  confirmLink: {
    ...baseText.caption,
    color: colors.warning,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  cancelLink: {
    ...baseText.caption,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
});
