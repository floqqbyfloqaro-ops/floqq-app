import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { formatCents, parseEuroToCents, receiptPhotoUrl, reviewRideReceipt, RideReceipt } from '../services/payments';
import { baseText, colors, spacing } from '../theme/colors';
import { formatBarcelonaDateTime } from '../utils/formatDateTime';
import AuthTextInput from './AuthTextInput';
import Card from './Card';
import ErrorNotice from './ErrorNotice';
import PrimaryButton from './PrimaryButton';
import SecondaryButton from './SecondaryButton';

type Props = {
  groupId: string;
  receipt: RideReceipt;
  onChanged: () => void;
};

// Payments prototype, phase 5: the admin's view of a group's taxi receipt on the group detail
// screen - what was read from the photo, why it needs review, the photo itself, and the decision:
// approve (optionally with a corrected total, e.g. when the photo was read wrongly) or reject.
export default function AdminReceiptReview({ groupId, receipt, onChanged }: Props) {
  const { t } = useTranslation();

  const [totalInput, setTotalInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [acting, setActing] = useState<'approve' | 'reject' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleViewPhoto = async () => {
    if (!receipt.photo_path) return;
    const url = await receiptPhotoUrl(receipt.photo_path);
    if (url) await WebBrowser.openBrowserAsync(url);
    else setErrorMessage(t('groupDetail.receiptActionError'));
  };

  const handleReview = async (action: 'approve' | 'reject') => {
    setErrorMessage(null);
    let totalCents: number | undefined;
    if (action === 'approve' && totalInput.trim()) {
      const parsed = parseEuroToCents(totalInput);
      if (parsed == null || parsed <= 0) {
        setInputError(t('receipt.invalidTotal'));
        return;
      }
      totalCents = parsed;
    }
    setInputError(null);
    setActing(action);
    const { error } = await reviewRideReceipt(groupId, action, { totalCents, note: noteInput.trim() || undefined });
    setActing(null);
    if (error) {
      console.warn('reviewRideReceipt failed', error);
      setErrorMessage(t('groupDetail.receiptActionError'));
      return;
    }
    setTotalInput('');
    setNoteInput('');
    onChanged();
  };

  const statusStyle =
    receipt.status === 'ACCEPTED' ? styles.accepted : receipt.status === 'REJECTED' ? styles.rejected : styles.review;

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{t('groupDetail.receiptTitle')}</Text>
      <Text style={statusStyle}>{t(`groupDetail.receiptStatus.${receipt.status}`)}</Text>

      {receipt.review_reasons.length > 0 ? (
        <Text style={styles.review}>
          {receipt.review_reasons.map((r) => t(`groupDetail.receiptReason.${r}`, { defaultValue: r })).join(' · ')}
        </Text>
      ) : null}

      <Text style={styles.subtitle}>
        {t('groupDetail.receiptTotals', {
          total: formatCents(receipt.total_cents),
          holds: formatCents(receipt.holds_total_cents),
          back: formatCents(receipt.reimbursement_cents),
        })}
        {receipt.total_source === 'admin' ? ` ${t('groupDetail.receiptCorrected')}` : ''}
      </Text>
      <Text style={styles.note}>
        {t('groupDetail.receiptRead', {
          date: receipt.receipt_at ? formatBarcelonaDateTime(receipt.receipt_at) : '-',
          licence: receipt.taxi_licence ?? '-',
          number: receipt.receipt_number ?? '-',
        })}
      </Text>

      {receipt.guarantee_used ? (
        <Text style={styles.review}>{t('groupDetail.receiptGuaranteeUsed', { amount: formatCents(receipt.guarantee_cents) })}</Text>
      ) : (
        <Text style={styles.note}>{t('groupDetail.receiptCovered')}</Text>
      )}
      {receipt.review_note ? <Text style={styles.note}>{t('groupDetail.receiptNote', { note: receipt.review_note })}</Text> : null}

      {receipt.photo_path ? (
        <SecondaryButton label={t('groupDetail.receiptViewPhoto')} icon="image-outline" onPress={handleViewPhoto} />
      ) : (
        <Text style={styles.note}>{t('groupDetail.receiptNoPhoto')}</Text>
      )}

      {receipt.status !== 'REJECTED' ? (
        <View style={styles.actions}>
          <AuthTextInput
            variant="card"
            leadingIcon="receipt-outline"
            placeholder={t('groupDetail.receiptCorrectPlaceholder')}
            accessibilityLabel={t('groupDetail.receiptCorrectPlaceholder')}
            value={totalInput}
            onChangeText={setTotalInput}
            keyboardType="decimal-pad"
            errorText={inputError ?? undefined}
          />
          <AuthTextInput
            variant="card"
            leadingIcon="chatbox-outline"
            placeholder={t('groupDetail.receiptNotePlaceholder')}
            accessibilityLabel={t('groupDetail.receiptNotePlaceholder')}
            value={noteInput}
            onChangeText={setNoteInput}
          />
          {errorMessage ? <ErrorNotice message={errorMessage} /> : null}
          <PrimaryButton
            label={receipt.status === 'ACCEPTED' ? t('groupDetail.receiptSaveCorrection') : t('groupDetail.receiptApprove')}
            onPress={() => handleReview('approve')}
            loading={acting === 'approve'}
            disabled={acting != null}
          />
          <SecondaryButton
            label={t('groupDetail.receiptReject')}
            onPress={() => handleReview('reject')}
            loading={acting === 'reject'}
            disabled={acting != null}
          />
        </View>
      ) : errorMessage ? (
        <ErrorNotice message={errorMessage} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.x4,
    gap: spacing.x2,
  },
  title: {
    ...baseText.body,
    fontWeight: '600',
  },
  subtitle: {
    ...baseText.bodySmall,
  },
  note: {
    ...baseText.caption,
    color: colors.info,
  },
  review: {
    ...baseText.caption,
    color: colors.warning,
    fontWeight: '700',
  },
  accepted: {
    ...baseText.caption,
    color: colors.success,
    fontWeight: '700',
  },
  rejected: {
    ...baseText.caption,
    color: colors.dangerStrong,
    fontWeight: '700',
  },
  actions: {
    gap: spacing.x2,
    marginTop: spacing.x2,
  },
});
