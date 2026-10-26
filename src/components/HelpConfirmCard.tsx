import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import type { CancelConsequence, ConfirmCard } from '../services/helpChat';
import { formatCents } from '../services/payments';
import { baseText, borders, colors, radii, spacing } from '../theme/colors';
import PrimaryButton from './PrimaryButton';
import SecondaryButton from './SecondaryButton';

type Props = {
  card: ConfirmCard;
  // Absent when the conversation is only being read (the archive): no buttons then.
  onDecide?: (actionId: string, decision: 'confirm' | 'keep') => Promise<void>;
};

// What cancelling does to the money - in the app's own cancel-screen words (FindingMatchScreen,
// CancelConfirmedRide), so the card says exactly what the app would.
function consequenceText(t: (key: string, options?: Record<string, string>) => string, consequence: CancelConsequence): string {
  switch (consequence.kind) {
    case 'searching':
      return t('findingMatch.cancelConfirmMessage');
    case 'free':
      return t('myRide.cancelFree', { amount: formatCents(consequence.releasedCents) });
    case 'fee_kept':
      return t('myRide.cancelFeeKept', { fee: formatCents(consequence.feeCents), released: formatCents(consequence.releasedCents) });
    case 'no_charge':
      return t('myRide.cancelNoCharge');
  }
}

// Something the assistant can do for the passenger - cancel their ride, resend the email change
// confirmation - shown before it happens. Only the tap on its button does it; afterwards the card
// says how it ended (done, kept, or it couldn't be done).
export default function HelpConfirmCard({ card, onDecide }: Props) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState<'confirm' | 'keep' | null>(null);

  const decide = async (decision: 'confirm' | 'keep') => {
    if (!onDecide || busy) return;
    setBusy(decision);
    await onDecide(card.actionId, decision);
    setBusy(null);
  };

  const isCancel = card.type === 'confirm_cancel';
  const doneLabel = t(isCancel ? 'help.card.cancelled' : 'help.card.resent');
  const outcome =
    card.status === 'done' ? doneLabel : card.status === 'kept' ? t(isCancel ? 'help.card.kept' : 'help.card.notSent') : card.status === 'failed' ? t('help.card.failed') : null;

  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      {card.type === 'confirm_cancel' ? (
        <>
          <Text style={styles.title}>{t('myRide.cancelConfirmTitle')}</Text>
          <Text style={styles.main} numberOfLines={2}>
            {card.destination}
          </Text>
          <Text style={styles.meta}>
            {new Date(card.at).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
            {t(card.rideStatus === 'searching' ? 'help.card.searching' : 'help.card.grouped')}
          </Text>
          <Text style={styles.consequence}>{consequenceText(t, card.consequence)}</Text>
        </>
      ) : (
        <>
          <Text style={styles.title}>{t('help.card.resendTitle')}</Text>
          <Text style={styles.main}>{card.email}</Text>
        </>
      )}

      {outcome ? (
        <View style={styles.outcome}>
          <Ionicons
            name={card.status === 'done' ? 'checkmark-circle' : card.status === 'failed' ? 'alert-circle' : 'remove-circle-outline'}
            size={18}
            color={card.status === 'done' ? colors.success : card.status === 'failed' ? colors.dangerStrong : colors.textSecondary}
          />
          <Text style={styles.outcomeText}>{outcome}</Text>
        </View>
      ) : onDecide ? (
        <View style={styles.buttons}>
          <PrimaryButton label={t(isCancel ? 'help.card.cancelMyRide' : 'help.card.resendEmail')} onPress={() => decide('confirm')} loading={busy === 'confirm'} disabled={busy != null} />
          <SecondaryButton label={t(isCancel ? 'help.card.keepIt' : 'help.card.notNow')} onPress={() => decide('keep')} disabled={busy != null} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.x2,
    padding: spacing.x4,
    borderRadius: radii.md,
    borderWidth: borders.regular,
    borderColor: colors.accentPrimaryStrong,
    backgroundColor: colors.surfaceCard,
    gap: spacing.x1,
  },
  title: {
    ...baseText.label,
    color: colors.textSecondary,
  },
  main: {
    ...baseText.body,
    fontWeight: '700',
  },
  meta: {
    ...baseText.caption,
    color: colors.textSecondary,
  },
  consequence: {
    ...baseText.bodySmall,
    marginTop: spacing.x2,
  },
  buttons: {
    gap: spacing.x2,
    marginTop: spacing.x3,
  },
  outcome: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
    marginTop: spacing.x3,
  },
  outcomeText: {
    ...baseText.bodySmall,
    fontWeight: '700',
  },
});
