import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { PAYMENTS_ENABLED, SERVICE_FEE_EUR } from '../constants';
import { cancelPassengerRequest, ServiceFeeStatus } from '../services/passengerRequests';
import { fetchMyRidePayment, formatCents } from '../services/payments';
import { baseText, spacing } from '../theme/colors';
import ErrorNotice from './ErrorNotice';
import PrimaryButton from './PrimaryButton';
import SecondaryButton from './SecondaryButton';

type Props = {
  requestId: string;
  groupId: string;
  serviceFeeStatus: ServiceFeeStatus;
  onCancelled: () => void;
};

// A passenger can always cancel their ride, also once the group is confirmed. Before confirming,
// this spells out exactly what it costs: with payments on, a reserved seat keeps only the FLOQQ
// fee and releases the rest; without a reservation nothing is charged.
export default function CancelConfirmedRide({ requestId, groupId, serviceFeeStatus, onCancelled }: Props) {
  const { t } = useTranslation();

  const [warning, setWarning] = useState<string | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fee = SERVICE_FEE_EUR.toFixed(2);

  const handleStart = async () => {
    setErrorMessage(null);

    if (!PAYMENTS_ENABLED) {
      setWarning(serviceFeeStatus === 'paid' ? t('myRide.cancelLegacyFee', { fee }) : t('myRide.cancelNoCharge'));
      return;
    }

    setIsPreparing(true);
    const { data: payment } = await fetchMyRidePayment(requestId, groupId);
    setIsPreparing(false);

    if (payment?.payment_status === 'HOLD_PLACED') {
      setWarning(
        t('myRide.cancelFeeKept', {
          fee: formatCents(payment.platform_fee_cents),
          released: formatCents(payment.hold_amount_cents - payment.platform_fee_cents),
        })
      );
    } else {
      setWarning(t('myRide.cancelNoCharge'));
    }
  };

  const handleConfirm = async () => {
    setErrorMessage(null);
    setIsCancelling(true);
    const { error } = await cancelPassengerRequest(requestId);
    setIsCancelling(false);

    if (error) {
      console.warn('cancelPassengerRequest failed', error);
      setErrorMessage(t('findingMatch.cancelError'));
      return;
    }
    setWarning(null);
    onCancelled();
  };

  if (!warning) {
    return (
      <View style={styles.container}>
        <SecondaryButton label={t('myRide.cancelRideButton')} onPress={handleStart} disabled={isPreparing} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('myRide.cancelConfirmTitle')}</Text>
      <Text style={styles.note} accessibilityLiveRegion="polite">
        {warning}
      </Text>
      <Text style={styles.note}>{t('myRide.cancelOthersNote')}</Text>
      {errorMessage ? <ErrorNotice message={errorMessage} onRetry={handleConfirm} retryLabel={t('common.retry')} /> : null}
      <View style={styles.actions}>
        <PrimaryButton label={t('myRide.cancelConfirmButton')} onPress={handleConfirm} loading={isCancelling} />
        <SecondaryButton label={t('home.activeRideKeep')} onPress={() => setWarning(null)} disabled={isCancelling} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.x4,
  },
  title: {
    ...baseText.body,
    fontWeight: '700',
    marginBottom: spacing.x1,
  },
  note: {
    ...baseText.bodySmall,
    marginBottom: spacing.x3,
  },
  actions: {
    gap: spacing.x2,
  },
});
