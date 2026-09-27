import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import {
  fetchRideReceipt,
  formatCents,
  receiptPhotoUrl,
  RideReceipt,
  submitRideReceipt,
  uploadReceiptPhoto,
} from '../services/payments';
import { baseText, colors, spacing } from '../theme/colors';
import { formatBarcelonaDateTime } from '../utils/formatDateTime';
import ErrorNotice from './ErrorNotice';
import PrimaryButton from './PrimaryButton';
import SecondaryButton from './SecondaryButton';

type Props = {
  groupId: string;
  // The payer's own arrival: before it there's no taxi receipt yet, so the button stays hidden.
  arrivalAt: string;
};

// Server refusals -> what the payer is told.
const ERROR_KEYS: Record<string, string> = {
  unreadable: 'receipt.unreadable',
  not_a_taxi_receipt: 'receipt.notATaxiReceipt',
  no_total: 'receipt.noTotal',
  ride_not_started: 'receipt.tooEarly',
  already_accepted: 'receipt.locked',
  already_captured: 'receipt.locked',
  too_many_attempts: 'receipt.tooManyAttempts',
  scan_failed: 'receipt.scanFailed',
};

// Payments prototype, phase 5: after the ride the payer photographs the taxi receipt - camera
// only, no gallery, and no typed amount. The server reads the total and the date from the photo
// and checks it belongs to this ride; doubtful receipts go to FLOQQ for review before anyone is
// charged. Shown inside PayerCard, for the payer only.
export default function ReceiptCard({ groupId, arrivalAt }: Props) {
  const { t } = useTranslation();

  const [receipt, setReceipt] = useState<RideReceipt | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await fetchRideReceipt(groupId);
    setIsLoaded(true);
    if (error) {
      console.warn('fetchRideReceipt failed', error);
      return;
    }
    setReceipt(data);
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleTakePhoto = async () => {
    setErrorMessage(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setErrorMessage(t('receipt.cameraDenied'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5 });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;

    setIsSubmitting(true);
    const upload = await uploadReceiptPhoto(groupId, asset.uri, asset.mimeType ?? null);
    if (upload.error || !upload.path) {
      console.warn('uploadReceiptPhoto failed', upload.error);
      setErrorMessage(t('receipt.photoFailed'));
      setIsSubmitting(false);
      return;
    }

    const { result: response, error } = await submitRideReceipt(groupId, upload.path);
    if (error || response?.error) {
      console.warn('submitRideReceipt failed', response ?? error);
      const code = response?.error === 'unreadable' ? response.reason : response?.error;
      setErrorMessage(t(ERROR_KEYS[code ?? ''] ?? 'payments.error'));
    }
    await load();
    setIsSubmitting(false);
  };

  const handleViewPhoto = async () => {
    if (!receipt?.photo_path) return;
    const url = await receiptPhotoUrl(receipt.photo_path);
    if (url) await WebBrowser.openBrowserAsync(url);
    else setErrorMessage(t('payments.error'));
  };

  if (!isLoaded) return null;

  if (!receipt && Date.now() < new Date(arrivalAt).getTime()) {
    return <Text style={styles.note}>{t('receipt.afterRide')}</Text>;
  }

  const readLine = receipt
    ? t('receipt.readLine', {
        total: formatCents(receipt.total_cents),
        date: receipt.receipt_at ? formatBarcelonaDateTime(receipt.receipt_at) : t('receipt.noDate'),
      })
    : null;

  const takePhotoButton = (
    <PrimaryButton
      label={isSubmitting ? t('receipt.reading') : receipt ? t('receipt.retakeButton') : t('receipt.takePhoto')}
      onPress={handleTakePhoto}
      loading={isSubmitting}
    />
  );

  return (
    <View style={styles.section} accessibilityLiveRegion="polite">
      <Text style={styles.title}>{t('receipt.title')}</Text>

      {!receipt ? (
        <>
          <Text style={styles.note}>{t('receipt.explainer')}</Text>
          <Text style={styles.hint}>{t('receipt.photoTips')}</Text>
          {takePhotoButton}
        </>
      ) : receipt.status === 'ACCEPTED' ? (
        <>
          <Text style={styles.done}>{t('receipt.accepted')}</Text>
          <Text style={styles.line}>{readLine}</Text>
          <Text style={styles.line}>{t('receipt.summaryYourShare', { share: formatCents(receipt.payer_share_cents) })}</Text>
          <Text style={styles.line}>{t('receipt.summaryBack', { back: formatCents(receipt.reimbursement_cents) })}</Text>
          {receipt.guarantee_used ? (
            <Text style={styles.guarantee}>
              {t('receipt.guaranteeUsed', {
                amount: formatCents(receipt.guarantee_cents),
                holds: formatCents(receipt.holds_total_cents),
              })}
            </Text>
          ) : (
            <Text style={styles.note}>{t('receipt.covered')}</Text>
          )}
        </>
      ) : receipt.status === 'NEEDS_REVIEW' ? (
        <>
          <Text style={styles.line}>{readLine}</Text>
          <Text style={styles.warning}>{t('receipt.inReview')}</Text>
          <Text style={styles.hint}>{t('receipt.wrongPhotoHint')}</Text>
          {takePhotoButton}
        </>
      ) : (
        <>
          <Text style={styles.warning}>
            {receipt.review_note ? t('receipt.rejectedWithNote', { note: receipt.review_note }) : t('receipt.rejected')}
          </Text>
          <Text style={styles.hint}>{t('receipt.photoTips')}</Text>
          {takePhotoButton}
        </>
      )}

      {receipt?.photo_path ? <SecondaryButton label={t('receipt.viewPhoto')} icon="image-outline" onPress={handleViewPhoto} /> : null}
      {errorMessage ? <ErrorNotice message={errorMessage} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.x3,
  },
  title: {
    ...baseText.body,
    fontWeight: '700',
    marginTop: spacing.x3,
    marginBottom: spacing.x1,
  },
  line: {
    ...baseText.body,
    marginBottom: spacing.x1,
  },
  note: {
    ...baseText.bodySmall,
    marginTop: spacing.x2,
    marginBottom: spacing.x3,
  },
  hint: {
    ...baseText.caption,
    marginBottom: spacing.x3,
  },
  warning: {
    ...baseText.bodySmall,
    color: colors.warning,
    marginTop: spacing.x2,
    marginBottom: spacing.x3,
  },
  guarantee: {
    ...baseText.bodySmall,
    color: colors.warning,
    marginTop: spacing.x2,
    marginBottom: spacing.x3,
  },
  done: {
    ...baseText.bodySmall,
    color: colors.success,
    marginTop: spacing.x2,
    marginBottom: spacing.x2,
  },
});
