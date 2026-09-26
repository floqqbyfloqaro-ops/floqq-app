import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import type { MyTaxiGroup } from '../services/passengerRequests';
import {
  fetchMyPayoutState,
  fetchMyRidePayment,
  formatCents,
  PayoutState,
  refreshPayoutState,
  startPayoutOnboarding,
} from '../services/payments';
import { baseText, colors, spacing } from '../theme/colors';
import ErrorNotice from './ErrorNotice';
import PrimaryButton from './PrimaryButton';
import SecondaryButton from './SecondaryButton';

type Props = {
  requestId: string;
  group: MyTaxiGroup;
};

// Payments prototype, phase 4: the designated payer (the passenger who gets off last) pays the
// taxi and gets the others' shares back through Stripe Connect. Shown on My ride under the seat
// reservation. Payout setup isn't required before the ride - it can also be finished afterwards.
// The role can't be passed on (only the last passenger can pay the full fare): a payer who can't
// pay cancels their seat, and whoever then gets off last becomes the payer.
export default function PayerCard({ requestId, group }: Props) {
  const { t } = useTranslation();

  const [shareCents, setShareCents] = useState<number | null>(null);
  const [feeCents, setFeeCents] = useState<number | null>(null);
  const [payout, setPayout] = useState<PayoutState | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isPayer = group.payer_request_id === requestId;

  useEffect(() => {
    fetchMyRidePayment(requestId, group.id).then(({ data }) => {
      if (!data) return;
      setShareCents(data.estimated_share_cents);
      setFeeCents(data.platform_fee_cents);
    });
  }, [requestId, group.id]);

  // The saved state first (fast), then Stripe's current one if it may have moved on since.
  const loadPayout = useCallback(async () => {
    const { state } = await fetchMyPayoutState();
    if (!state) return;
    setPayout(state);
    if (state.status === 'PENDING' || state.status === 'RESTRICTED') {
      const { state: fresh } = await refreshPayoutState();
      if (fresh) setPayout(fresh);
    }
  }, []);

  useEffect(() => {
    if (isPayer) loadPayout();
  }, [isPayer, loadPayout]);

  const handleSetUpPayout = async () => {
    setErrorMessage(null);
    setIsActing(true);
    const returnUrl = Linking.createURL('payout-return');
    const { url, error } = await startPayoutOnboarding(returnUrl);
    if (error || !url) {
      console.warn('startPayoutOnboarding failed', error);
      setErrorMessage(t('payments.error'));
      setIsActing(false);
      return;
    }
    // Stripe's own pages; they send the payer back to returnUrl, which closes this browser.
    await WebBrowser.openAuthSessionAsync(url, returnUrl);
    const { state } = await refreshPayoutState();
    if (state) setPayout(state);
    setIsActing(false);
  };

  const handleCheckAgain = async () => {
    setIsActing(true);
    const { state } = await refreshPayoutState();
    if (state) setPayout(state);
    setIsActing(false);
  };

  // "You'll pay about €38 for the taxi and get about €25 back automatically": the group's estimated
  // fare, minus this passenger's own estimated share.
  const preview =
    group.total_fare != null && shareCents != null
      ? t('payer_preview', {
          taxi: Math.round(Number(group.total_fare)),
          back: Math.max(0, Math.round((Number(group.total_fare) * 100 - shareCents) / 100)),
        })
      : null;

  if (!isPayer) {
    return group.payer_request_id ? <Text style={styles.note}>{t('payer.someoneElsePays')}</Text> : null;
  }

  return (
    <View style={styles.section}>
      <Text style={styles.title}>{t('payer.title')}</Text>
      {preview ? <Text style={styles.preview}>{preview}</Text> : null}
      {feeCents != null ? <Text style={styles.note}>{t('payer.feeOnly', { fee: formatCents(feeCents) })}</Text> : null}

      {!payout ? (
        <Text style={styles.note}>{t('payer.checkingPayout')}</Text>
      ) : payout.status === 'COMPLETE' ? (
        <Text style={styles.done} accessibilityLiveRegion="polite">
          {t('payer.payoutReady')}
        </Text>
      ) : payout.status === 'PENDING' && payout.detailsSubmitted ? (
        <>
          <Text style={styles.note}>{t('payer.payoutChecking')}</Text>
          <SecondaryButton label={t('payer.checkAgainButton')} onPress={handleCheckAgain} />
        </>
      ) : (
        <>
          <Text style={styles.note}>
            {payout.status === 'RESTRICTED'
              ? t('payer.payoutNeedsMore')
              : payout.status === 'PENDING'
                ? t('payer.payoutUnfinished')
                : t('payer.payoutExplainer')}
          </Text>
          <PrimaryButton
            label={payout.status === 'NOT_STARTED' ? t('payer.setUpButton') : t('payer.continueButton')}
            onPress={handleSetUpPayout}
            loading={isActing}
          />
        </>
      )}

      {errorMessage ? <ErrorNotice message={errorMessage} /> : null}

      <Text style={styles.hint}>{t('payer.cantPay')}</Text>
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
  preview: {
    ...baseText.body,
    marginBottom: spacing.x2,
  },
  note: {
    ...baseText.bodySmall,
    marginTop: spacing.x2,
    marginBottom: spacing.x3,
  },
  hint: {
    ...baseText.caption,
    marginTop: spacing.x2,
  },
  done: {
    ...baseText.bodySmall,
    color: colors.success,
    marginTop: spacing.x2,
    marginBottom: spacing.x3,
  },
});
