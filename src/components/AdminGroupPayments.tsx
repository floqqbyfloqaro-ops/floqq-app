import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { AdminRidePayment, AdminRidePayout, fetchGroupPayments, formatCents, RideReceipt } from '../services/payments';
import { baseText, colors, spacing } from '../theme/colors';
import { formatBarcelonaDateTime } from '../utils/formatDateTime';
import Card from './Card';

type Props = {
  groupId: string;
  receipt: RideReceipt | null;
  // The group's designated payer and their payout account, while the group still has one.
  payerRequestId: string | null;
  payerPayout: string | null;
};

const PROBLEM_STATUSES = ['HOLD_FAILED', 'CAPTURE_FAILED'];

function passengerName(payment: AdminRidePayment) {
  return payment.passenger_requests?.passenger_name?.trim() || payment.passenger_requests?.flight_number || '-';
}

// Payments prototype, phase 8: the admin's read-only overview of one group's money on the group
// detail screen - each passenger's reservation and charge, the payer, the receipt, the transfers
// to the payer and the Ride Payment Guarantee. What needs doing stays in AdminPaymentIssues and
// AdminReceiptReview. Hidden until the group has payments.
export default function AdminGroupPayments({ groupId, receipt, payerRequestId, payerPayout }: Props) {
  const { t } = useTranslation();

  const [payments, setPayments] = useState<AdminRidePayment[]>([]);
  const [payout, setPayout] = useState<AdminRidePayout | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchGroupPayments(groupId).then((result) => {
      if (cancelled) return;
      if (result.error) console.warn('fetchGroupPayments failed', result.error);
      setPayments(result.payments);
      setPayout(result.payout);
    });
    return () => {
      cancelled = true;
    };
  }, [groupId]);

  if (payments.length === 0 && !payout) return null;

  // A finished ride's group no longer names its payer; the payout still does.
  const payerId = payerRequestId ?? payout?.payer_request_id ?? null;
  const payerPayment = payments.find((p) => p.request_id != null && p.request_id === payerId);
  // After the charges this includes shares that couldn't be captured, not only short reservations.
  const guaranteeCents = payout?.guarantee_cents ?? receipt?.guarantee_cents ?? 0;

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{t('adminPayments.title')}</Text>

      {payments.map((payment) => {
        const amounts = [
          t('adminPayments.reserved', { amount: formatCents(payment.hold_amount_cents) }),
          payment.captured_cents != null ? t('adminPayments.charged', { amount: formatCents(payment.captured_cents) }) : null,
          payment.released_cents != null ? t('adminPayments.released', { amount: formatCents(payment.released_cents) }) : null,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <View key={payment.id} style={styles.block}>
            <Text style={styles.name}>
              {passengerName(payment)}
              {payment.request_id != null && payment.request_id === payerId ? ` · ${t('adminPayments.paysTaxi')}` : ''}
            </Text>
            <Text style={PROBLEM_STATUSES.includes(payment.payment_status) ? styles.problem : styles.detail}>
              {t(`adminPayments.status.${payment.payment_status}`)}
            </Text>
            <Text style={styles.detail}>{amounts}</Text>
            {payment.failure_reason ? (
              <Text style={styles.detail}>{t('adminPayments.failure', { reason: payment.failure_reason })}</Text>
            ) : null}
            {payment.outstanding_cents ? (
              <Text style={payment.outstanding_resolution ? styles.detail : styles.problem}>
                {t(`adminPayments.outstanding.${payment.outstanding_resolution ?? 'open'}`, {
                  amount: formatCents(payment.outstanding_cents),
                })}
              </Text>
            ) : null}
            {payment.guarantee_cents > 0 ? (
              <Text style={styles.problem}>
                {t('adminPayments.memberGuarantee', { amount: formatCents(payment.guarantee_cents) })}
              </Text>
            ) : null}
            {payment.payer_transfer_id ? (
              <Text style={styles.detail} selectable>
                {t('adminPayments.transfer', { id: payment.payer_transfer_id })}
              </Text>
            ) : null}
          </View>
        );
      })}

      <View style={styles.block}>
        <Text style={styles.name}>{t('adminPayments.payerTitle')}</Text>
        <Text style={styles.detail}>
          {payerId
            ? [
                payerPayment ? passengerName(payerPayment) : null,
                payerPayout ? t('adminPayments.payoutAccount', { payout: t(`groupDetail.payout.${payerPayout}`) }) : null,
              ]
                .filter(Boolean)
                .join(' · ') || '-'
            : t('adminPayments.noPayer')}
        </Text>
      </View>

      <View style={styles.block}>
        <Text style={styles.name}>{t('adminPayments.receiptTitle')}</Text>
        {receipt ? (
          <>
            <Text style={styles.detail}>
              {t('adminPayments.receiptLine', {
                total: formatCents(receipt.total_cents),
                status: t(`groupDetail.receiptStatus.${receipt.status}`),
              })}
            </Text>
            {receipt.settled_at ? (
              <Text style={styles.detail}>
                {t('adminPayments.chargedAt', { time: formatBarcelonaDateTime(receipt.settled_at) })}
              </Text>
            ) : receipt.settle_after ? (
              <Text style={styles.detail}>
                {t('adminPayments.chargeAt', { time: formatBarcelonaDateTime(receipt.settle_after) })}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.detail}>{t('adminPayments.noReceipt')}</Text>
        )}
      </View>

      <View style={styles.block}>
        <Text style={styles.name}>{t('adminPayments.payoutTitle')}</Text>
        {payout ? (
          <>
            <Text style={styles.detail}>
              {t('adminPayments.payoutLine', {
                sent: formatCents(payout.transferred_cents),
                amount: formatCents(payout.amount_cents),
                status: t(`adminPayments.payoutStatus.${payout.status}`),
              })}
            </Text>
            <Text style={styles.detail}>
              {t('adminPayments.payoutSplit', {
                captures: formatCents(payout.from_captures_cents),
                guarantee: formatCents(payout.guarantee_cents),
              })}
            </Text>
            {payout.sent_at ? (
              <Text style={styles.detail}>
                {t('adminPayments.payoutSentAt', { time: formatBarcelonaDateTime(payout.sent_at) })}
              </Text>
            ) : null}
            {payout.failure_reason ? (
              <Text style={styles.problem}>{t('adminPayments.payoutProblem', { reason: payout.failure_reason })}</Text>
            ) : null}
            {payout.guarantee_transfer_id ? (
              <Text style={styles.detail} selectable>
                {t('adminPayments.guaranteeTransfer', { id: payout.guarantee_transfer_id })}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.detail}>
            {receipt
              ? t('adminPayments.payoutNotStarted', { amount: formatCents(receipt.reimbursement_cents) })
              : t('adminPayments.payoutNoReceipt')}
          </Text>
        )}
      </View>

      <View style={styles.block}>
        <Text style={styles.name}>{t('adminPayments.guaranteeTitle')}</Text>
        <Text style={guaranteeCents > 0 ? styles.problem : styles.detail}>
          {guaranteeCents > 0
            ? t('adminPayments.guaranteeUsed', { amount: formatCents(guaranteeCents) })
            : t('adminPayments.guaranteeNotUsed')}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.x4,
    gap: spacing.x3,
  },
  title: {
    ...baseText.h3,
  },
  block: {
    gap: spacing.x1,
  },
  name: {
    ...baseText.bodySmall,
    fontWeight: '700',
  },
  detail: {
    ...baseText.caption,
    color: colors.info,
  },
  problem: {
    ...baseText.caption,
    color: colors.warning,
    fontWeight: '700',
  },
});
