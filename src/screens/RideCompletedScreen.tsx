import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import Card from '../components/Card';
import CompletedCheck from '../components/CompletedCheck';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import RatingFollowUpSheet from '../components/RatingFollowUpSheet';
import Skeleton from '../components/Skeleton';
import { subscribeToRide } from '../services/matchOffer';
import { formatCents } from '../services/payments';
import { fetchRideSummary, markCompletionSeen, RideSummary, saveRating } from '../services/rideCompletion';
import { LineStatus, RatingReason, ratingNeedsFollowUp, rideSummaryView, SummaryLine } from '../services/rideSummaryRules';
import { baseText, borders, colors, spacing } from '../theme/colors';

type Props = {
  requestId: string;
  // "Done": back to the home screen. The ride stays in "My trips".
  onDone: () => void;
};

// How often the summary is re-read while it still has something pending, on top of the live
// updates on the ride and its group (a capture changes neither).
const PENDING_RECHECK_MS = 30_000;

const STATUS_KEYS: Record<Exclude<LineStatus, null>, string> = {
  paid: 'rideSummary.statusPaid',
  paidToTaxi: 'rideSummary.statusPaidToTaxi',
  pending: 'rideSummary.statusPending',
  notPaid: 'rideSummary.statusNotPaid',
  failed: 'rideSummary.statusFailed',
};

// "Ride completed": this passenger's ride is over. A summary that never says "Paid" for anything
// that wasn't charged (rideSummaryRules.ts), and an optional rating. Updates by itself when the
// taxi receipt arrives or the share is charged.
export default function RideCompletedScreen({ requestId, onDone }: Props) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<RideSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const [stars, setStars] = useState(0);
  const [reasons, setReasons] = useState<RatingReason[]>([]);
  const [comment, setComment] = useState('');
  const [showSheet, setShowSheet] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [ratingMessage, setRatingMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const { summary: next, error } = await fetchRideSummary(requestId);
    setIsLoading(false);
    setIsRefreshing(false);
    if (error || !next) {
      if (error) console.warn('fetchRideSummary failed', error);
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setSummary(next);
  }, [requestId]);

  useEffect(() => {
    load();
  }, [load]);

  // Seen: not shown by itself again (after an automatic completion).
  const seen = summary?.completionSeenAt != null;
  useEffect(() => {
    if (summary && summary.completedAt && !seen) markCompletionSeen(requestId);
  }, [summary, seen, requestId]);

  // The rating saved earlier, once.
  const savedRating = summary?.rating ?? null;
  useEffect(() => {
    if (!savedRating) return;
    setStars(savedRating.stars);
    setReasons(savedRating.reasons);
    setComment(savedRating.comment ?? '');
  }, [savedRating]);

  const view = summary ? rideSummaryView(summary) : null;
  const hasPending = view?.showPendingNote ?? false;

  // Live: the receipt arriving changes the group; a capture is picked up by the recheck.
  const groupId = summary?.groupId ?? null;
  useEffect(() => {
    const unsubscribe = subscribeToRide('ridecompleted', requestId, groupId, load);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, [requestId, groupId, load]);
  useEffect(() => {
    if (!hasPending) return;
    const timer = setInterval(load, PENDING_RECHECK_MS);
    return () => clearInterval(timer);
  }, [hasPending, load]);

  const save = async (nextStars: number, nextReasons: RatingReason[], nextComment: string | null) => {
    setIsSaving(true);
    const { error } = await saveRating(requestId, nextStars, nextReasons, nextComment);
    setIsSaving(false);
    setShowSheet(false);
    if (error) {
      setRatingMessage({ text: t('rideSummary.ratingError'), ok: false });
      return;
    }
    setRatingMessage({
      text: t(nextStars === 5 ? 'rideSummary.ratingThanksFive' : 'rideSummary.ratingThanks'),
      ok: true,
    });
  };

  const handleStars = (value: number) => {
    setStars(value);
    setRatingMessage(null);
    if (ratingNeedsFollowUp(value)) {
      setShowSheet(true);
    } else {
      setReasons([]);
      setComment('');
      save(value, [], null);
    }
  };

  const money = (cents: number | null) => (cents != null ? `€${formatCents(cents)}` : t('matchFound.fareUnknown'));

  const line = (label: string, value: SummaryLine, note?: string | null) => (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {note ? <Text style={styles.rowNote}>{note}</Text> : null}
      </View>
      <View style={styles.rowValue}>
        <Text style={styles.amount}>
          {value.isEstimate && value.amountCents != null
            ? t('rideSummary.estimated', { amount: money(value.amountCents) })
            : money(value.amountCents)}
        </Text>
        {value.status ? (
          <Text style={[styles.status, value.status === 'paid' || value.status === 'paidToTaxi' ? styles.statusPaid : value.status === 'failed' ? styles.statusFailed : null]}>
            {t(STATUS_KEYS[value.status])}
          </Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              setIsRefreshing(true);
              load();
            }}
            tintColor={colors.accentPrimaryStrong}
          />
        }
      >
        <CompletedCheck />
        <Text style={styles.title} accessibilityRole="header">
          {t('ride_completed_title')}
        </Text>
        <Text style={styles.subtitle}>{t('ride_completed_subtitle')}</Text>

        {loadFailed ? <ErrorNotice message={t('rideSummary.loadError')} onRetry={load} retryLabel={t('common.retry')} /> : null}

        {isLoading ? (
          <Card style={styles.card} accessible accessibilityLabel={t('admin.loading')}>
            <Skeleton width="80%" height={18} style={styles.skeletonGap} />
            <Skeleton width="70%" height={18} style={styles.skeletonGap} />
            <Skeleton width="60%" height={18} />
          </Card>
        ) : summary && view ? (
          <Card style={styles.card}>
            {line(t('rideSummary.taxiFare'), view.fare)}
            {line(t('rideSummary.yourShare'), view.share)}
            {line(t('rideSummary.floqqFee'), view.fee)}
            <View style={styles.divider} />
            <View style={styles.row}>
              <Text style={styles.totalLabel}>{t('rideSummary.totalPaid')}</Text>
              <Text style={styles.totalAmount}>{money(view.totalPaidCents)}</Text>
            </View>
            {view.payerReturn ? (
              <Text style={styles.note}>
                {t(view.payerReturn.sent ? 'rideSummary.payerReturnSent' : 'rideSummary.payerReturnPending', {
                  amount: money(view.payerReturn.amountCents),
                })}
              </Text>
            ) : null}
            {view.showPendingNote ? <Text style={styles.note}>{t('final_amount_pending')}</Text> : null}
          </Card>
        ) : null}

        {summary ? (
          <Card style={styles.card}>
            <Text style={styles.rateTitle}>{t('rate_experience')}</Text>
            <View style={styles.stars} accessibilityRole="adjustable" accessibilityLabel={t('rate_experience')}>
              {[1, 2, 3, 4, 5].map((value) => (
                <Pressable
                  key={value}
                  onPress={() => handleStars(value)}
                  disabled={isSaving}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                  accessibilityRole="button"
                  accessibilityLabel={t('rideSummary.starLabel', { count: value })}
                  accessibilityState={{ selected: value <= stars }}
                >
                  <Ionicons name={value <= stars ? 'star' : 'star-outline'} size={36} color={colors.warning} />
                </Pressable>
              ))}
            </View>
            {ratingMessage ? (
              <Text style={ratingMessage.ok ? styles.thanks : styles.ratingError} accessibilityLiveRegion="polite">
                {ratingMessage.text}
              </Text>
            ) : null}
          </Card>
        ) : null}

        <PrimaryButton label={t('rideSummary.done')} onPress={onDone} />
      </ScrollView>

      <RatingFollowUpSheet
        visible={showSheet}
        stars={stars}
        requestId={requestId}
        initialReasons={reasons}
        initialComment={comment}
        busy={isSaving}
        onSend={(nextReasons, nextComment) => {
          setReasons(nextReasons);
          setComment(nextComment);
          save(stars, nextReasons, nextComment);
        }}
        onSkip={() => {
          setReasons([]);
          setComment('');
          save(stars, [], null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  content: {
    paddingTop: spacing.x12,
    paddingHorizontal: spacing.x6,
    paddingBottom: spacing.x12,
  },
  title: {
    ...baseText.h1,
    textAlign: 'center',
    marginTop: spacing.x2,
    marginBottom: spacing.x2,
  },
  subtitle: {
    ...baseText.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.x6,
  },
  card: {
    marginBottom: spacing.x4,
  },
  skeletonGap: {
    marginBottom: spacing.x3,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.x3,
    paddingVertical: spacing.x2,
  },
  rowText: {
    flex: 1,
  },
  rowLabel: {
    ...baseText.body,
  },
  rowNote: {
    ...baseText.caption,
    color: colors.textSecondary,
  },
  rowValue: {
    alignItems: 'flex-end',
  },
  amount: {
    ...baseText.body,
    fontWeight: '600',
  },
  status: {
    ...baseText.caption,
    color: colors.textSecondary,
    marginTop: spacing.x1,
  },
  statusPaid: {
    color: colors.success,
  },
  statusFailed: {
    color: colors.dangerStrong,
  },
  divider: {
    height: borders.regular,
    backgroundColor: colors.borderSubtle,
    marginVertical: spacing.x2,
  },
  totalLabel: {
    ...baseText.body,
    fontWeight: '700',
  },
  totalAmount: {
    ...baseText.h3,
  },
  note: {
    ...baseText.caption,
    color: colors.textSecondary,
    marginTop: spacing.x2,
  },
  rateTitle: {
    ...baseText.h3,
    textAlign: 'center',
    marginBottom: spacing.x3,
  },
  stars: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.x3,
  },
  thanks: {
    ...baseText.bodySmall,
    color: colors.success,
    textAlign: 'center',
    marginTop: spacing.x3,
  },
  ratingError: {
    ...baseText.bodySmall,
    color: colors.dangerStrong,
    textAlign: 'center',
    marginTop: spacing.x3,
  },
});
