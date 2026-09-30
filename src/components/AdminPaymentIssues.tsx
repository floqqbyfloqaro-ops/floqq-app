import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { fetchPaymentIssues, formatCents, PaymentIssues, runAdminPaymentAction } from '../services/payments';
import type { AdminPaymentAction } from '../services/payments';
import { baseText, colors, spacing } from '../theme/colors';
import { formatBarcelonaDateTime } from '../utils/formatDateTime';
import Card from './Card';
import ErrorNotice from './ErrorNotice';
import PrimaryButton from './PrimaryButton';
import SecondaryButton from './SecondaryButton';

type Props = {
  onOpenGroup: (groupId: string) => void;
  // Changes whenever the dashboard reloads, so this list reloads with it.
  refreshKey: number;
};

// Payments prototype, phase 7: everything about payments that needs the admin, at the top of the
// dashboard - amounts passengers still owe (a reservation that couldn't be charged), payouts held
// or stuck, receipts to review before the reservations expire, and payers who haven't sent a
// receipt. Hidden when there's nothing to do.
export default function AdminPaymentIssues({ onOpenGroup, refreshKey }: Props) {
  const { t } = useTranslation();

  const [issues, setIssues] = useState<PaymentIssues | null>(null);
  const [actingKey, setActingKey] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { issues: loaded, error } = await fetchPaymentIssues();
    if (error) {
      console.warn('fetchPaymentIssues failed', error);
      return;
    }
    setIssues(loaded);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const run = async (key: string, body: AdminPaymentAction) => {
    setErrorMessage(null);
    setActingKey(key);
    const { error } = await runAdminPaymentAction(body);
    setActingKey(null);
    if (error) {
      setErrorMessage(t('paymentIssues.actionError', { reason: error }));
    }
    await load();
  };

  if (!issues) return null;
  const count =
    issues.outstanding.length + issues.payouts.length + issues.receipts.length + issues.missingReceipts.length;
  if (count === 0) return null;

  const expiryNote = (groupId: string) =>
    issues.holdExpiries[groupId]
      ? t('paymentIssues.holdsExpire', { time: formatBarcelonaDateTime(issues.holdExpiries[groupId]) })
      : '';

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{t('paymentIssues.title', { count })}</Text>
      {errorMessage ? <ErrorNotice message={errorMessage} /> : null}

      {issues.outstanding.map((row) => {
        const name = row.passenger_requests?.passenger_name?.trim() || row.passenger_requests?.flight_number || '-';
        return (
          <Card key={`o-${row.id}`} style={styles.card}>
            <Text style={styles.flag}>
              {t('paymentIssues.outstanding', { name, amount: formatCents(row.outstanding_cents) })}
            </Text>
            <Text style={styles.detail}>
              {t(`paymentIssues.reason.${row.outstanding_reason}`, { defaultValue: row.outstanding_reason ?? '-' })}
              {row.outstanding_since ? ` · ${formatBarcelonaDateTime(row.outstanding_since)}` : ''}
              {row.outstanding_note ? ` · ${row.outstanding_note}` : ''}
            </Text>
            <View style={styles.actions}>
              <PrimaryButton
                label={t('paymentIssues.recharge', { amount: formatCents(row.outstanding_cents) })}
                onPress={() => run(`r-${row.id}`, { action: 'recharge', ridePaymentId: row.id })}
                loading={actingKey === `r-${row.id}`}
                disabled={actingKey != null}
              />
              <SecondaryButton
                label={t('paymentIssues.writeOff')}
                onPress={() => run(`w-${row.id}`, { action: 'write_off', ridePaymentId: row.id })}
                loading={actingKey === `w-${row.id}`}
                disabled={actingKey != null}
              />
              {row.group_id ? <SecondaryButton label={t('paymentIssues.openRide')} onPress={() => onOpenGroup(row.group_id!)} /> : null}
            </View>
          </Card>
        );
      })}

      {issues.payouts.map((payout) => (
        <Card key={`p-${payout.group_id}`} style={styles.card}>
          <Text style={styles.flag}>
            {payout.status === 'HELD_FOR_REVIEW'
              ? t('paymentIssues.payoutHeld', { amount: formatCents(payout.amount_cents) })
              : t('paymentIssues.payoutStuck', { amount: formatCents(payout.amount_cents), reason: payout.failure_reason ?? '-' })}
          </Text>
          <View style={styles.actions}>
            {payout.status === 'HELD_FOR_REVIEW' ? (
              <PrimaryButton
                label={t('paymentIssues.approvePayout')}
                onPress={() => run(`a-${payout.group_id}`, { action: 'approve_payout', groupId: payout.group_id })}
                loading={actingKey === `a-${payout.group_id}`}
                disabled={actingKey != null}
              />
            ) : null}
            <SecondaryButton label={t('paymentIssues.openRide')} onPress={() => onOpenGroup(payout.group_id)} />
          </View>
        </Card>
      ))}

      {issues.receipts.map((receipt) => (
        <Card key={`rc-${receipt.group_id}`} style={styles.card} onPress={() => onOpenGroup(receipt.group_id)}>
          <Text style={styles.flag}>
            {t(receipt.status === 'REJECTED' ? 'paymentIssues.receiptRejected' : 'paymentIssues.receiptReview')}
          </Text>
          <Text style={styles.detail}>{expiryNote(receipt.group_id)}</Text>
        </Card>
      ))}

      {issues.missingReceipts.map((group) => (
        <Card key={`m-${group.id}`} style={styles.card} onPress={() => onOpenGroup(group.id)}>
          <Text style={styles.flag}>
            {t('paymentIssues.noReceipt', { time: formatBarcelonaDateTime(group.receipt_deadline_at) })}
          </Text>
          <Text style={styles.detail}>{expiryNote(group.id)}</Text>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.x4,
  },
  sectionTitle: {
    ...baseText.h3,
    marginBottom: spacing.x3,
  },
  card: {
    marginBottom: spacing.x3,
    gap: spacing.x1,
  },
  flag: {
    ...baseText.bodySmall,
    color: colors.warning,
    fontWeight: '700',
  },
  detail: {
    ...baseText.caption,
    color: colors.info,
  },
  actions: {
    gap: spacing.x2,
    marginTop: spacing.x2,
  },
});
