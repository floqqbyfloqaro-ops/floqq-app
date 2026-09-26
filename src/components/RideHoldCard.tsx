import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { authenticateHold, CARD_SETUP_SUPPORTED, stripeReturnUrl } from '../services/cardSetup';
import { fetchMyRidePayment, formatCents, placeRideHold, RidePayment } from '../services/payments';
import { baseText, colors, spacing } from '../theme/colors';
import ErrorNotice from './ErrorNotice';
import PrimaryButton from './PrimaryButton';
import SecondaryButton from './SecondaryButton';

type Props = {
  requestId: string;
  groupId: string;
  onOpenProfile: () => void;
};

// While the reservation is being prepared or the bank is still confirming, re-check this often.
const POLL_INTERVAL_MS = 4000;
// After the passenger finishes a step, wait this long for Stripe's webhook to reach the server.
const RESULT_POLL_ATTEMPTS = 8;
const RESULT_POLL_INTERVAL_MS = 1500;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

// Payments prototype, phase 3: the passenger's seat reservation (card hold) for a confirmed group,
// shown on My ride. Whether the hold is placed is always read back from the server.
export default function RideHoldCard({ requestId, groupId, onOpenProfile }: Props) {
  const { t } = useTranslation();

  const [payment, setPayment] = useState<RidePayment | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [needsCard, setNeedsCard] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await fetchMyRidePayment(requestId, groupId);
    setIsLoaded(true);
    if (error) {
      console.warn('fetchMyRidePayment failed', error);
      setErrorMessage(t('payments.error'));
      return null;
    }
    setPayment(data);
    return data;
  }, [requestId, groupId, t]);

  useEffect(() => {
    load();
  }, [load]);

  const isWaiting = !payment || payment.payment_status === 'HOLD_PENDING_AUTH';
  useEffect(() => {
    if (!isWaiting || isActing) return;
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isWaiting, isActing, load]);

  const waitForResult = async () => {
    for (let attempt = 0; attempt < RESULT_POLL_ATTEMPTS; attempt += 1) {
      const latest = await load();
      if (latest && latest.payment_status !== 'HOLD_PENDING_AUTH' && latest.payment_status !== 'NOT_STARTED') return;
      await wait(RESULT_POLL_INTERVAL_MS);
    }
  };

  const handleReserve = async () => {
    if (!payment) return;
    setErrorMessage(null);
    setNotice(null);
    setNeedsCard(false);
    setIsActing(true);

    const { result, error } = await placeRideHold(payment.id, stripeReturnUrl());

    if (error) {
      if (result?.error === 'no_payment_method') {
        setNeedsCard(true);
      } else if (result?.error === 'deadline_passed' || result?.error === 'window_not_open' || result?.error === 'not_in_group') {
        await load();
      } else {
        console.warn('placeRideHold failed', error);
        setErrorMessage(t('payments.error'));
      }
      setIsActing(false);
      return;
    }

    if (result?.status === 'HOLD_PENDING_AUTH' && result.clientSecret && result.publishableKey) {
      if (!CARD_SETUP_SUPPORTED) {
        setNotice(t('payments.webAuth'));
        setIsActing(false);
        await load();
        return;
      }
      setNotice(t('payments.pendingAuth'));
      const auth = await authenticateHold(result.clientSecret, result.publishableKey);
      if (auth.status === 'failed') {
        console.warn('authenticateHold failed', auth.message);
      }
    }

    await waitForResult();
    setNotice(null);
    setIsActing(false);
  };

  if (!isLoaded) {
    return <Text style={styles.note}>{t('payments.checking')}</Text>;
  }

  if (!payment) {
    return <Text style={styles.note}>{t('payments.preparing')}</Text>;
  }

  const amount = formatCents(payment.hold_amount_cents);
  const now = Date.now();
  const opensAt = payment.hold_window_opens_at ? new Date(payment.hold_window_opens_at).getTime() : now;
  const deadlinePassed = payment.hold_deadline_at != null && now > new Date(payment.hold_deadline_at).getTime();

  if (payment.payment_status === 'HOLD_PLACED') {
    return (
      <Text style={styles.placed} accessibilityLiveRegion="polite">
        {t('hold_placed_message', { amount })}
      </Text>
    );
  }

  if (payment.payment_status === 'RELEASED' || payment.payment_status === 'CAPTURED' || payment.payment_status === 'REFUNDED') {
    return <Text style={styles.note}>{t('payments.released')}</Text>;
  }

  if (now < opensAt) {
    return <Text style={styles.note}>{t('payments.opensOn', { amount, date: formatDateTime(payment.hold_window_opens_at!) })}</Text>;
  }

  if (deadlinePassed) {
    return <Text style={styles.note}>{t('payments.deadlinePassed')}</Text>;
  }

  const isPendingAuth = payment.payment_status === 'HOLD_PENDING_AUTH';

  return (
    <View>
      <Text style={styles.title}>{t('payments.reserveTitle')}</Text>
      <Text style={styles.note}>
        {t('payments.reserveExplainer', {
          amount,
          share: formatCents(payment.estimated_share_cents),
          fee: formatCents(payment.platform_fee_cents),
        })}
      </Text>
      {payment.hold_deadline_at ? (
        <Text style={styles.deadline}>{t('payments.deadline', { time: formatDateTime(payment.hold_deadline_at) })}</Text>
      ) : null}

      {payment.failure_reason === 'share_increased' && payment.payment_status === 'NOT_STARTED' ? (
        <Text style={styles.note}>{t('payments.shareIncreased')}</Text>
      ) : null}
      {payment.payment_status === 'HOLD_FAILED' ? <ErrorNotice message={t('payments.failed')} /> : null}
      {errorMessage ? <ErrorNotice message={errorMessage} /> : null}
      {notice ? (
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      ) : null}

      {needsCard ? (
        <>
          <Text style={styles.note}>{t('payments.noCard')}</Text>
          <SecondaryButton label={t('payments.addCardButton')} onPress={onOpenProfile} />
        </>
      ) : (
        <PrimaryButton
          label={isPendingAuth ? t('payments.continueAuth') : t('payments.reserveButton', { amount })}
          onPress={handleReserve}
          loading={isActing}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    ...baseText.body,
    fontWeight: '700',
    marginTop: spacing.x3,
    marginBottom: spacing.x1,
  },
  note: {
    ...baseText.bodySmall,
    marginTop: spacing.x3,
    marginBottom: spacing.x3,
  },
  deadline: {
    ...baseText.caption,
    color: colors.warning,
    marginBottom: spacing.x3,
  },
  placed: {
    ...baseText.bodySmall,
    color: colors.success,
    marginTop: spacing.x3,
  },
});
