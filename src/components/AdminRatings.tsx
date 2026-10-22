import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { isFlaggedRating, topReasons } from '../services/rideSummaryRules';
import { supabase } from '../services/supabase';
import { baseText, colors, radii, spacing } from '../theme/colors';
import { formatBarcelonaDateTime } from '../utils/formatDateTime';
import Card from './Card';

type Props = {
  // Only the "low ratings to review" warning, for the top of the dashboard's first tab.
  warningsOnly?: boolean;
  refreshKey?: number;
  // Opens the ride's group.
  onOpenGroup?: (groupId: string) => void;
  // From the warning: open the History tab.
  onOpenHistory?: () => void;
};

// How far back the overview looks, and the warning on the first tab.
const OVERVIEW_DAYS = 30;
const WARNING_DAYS = 7;
const LATEST_LIMIT = 20;

type Overview = { count: number; average: number | null; distribution: Record<string, number>; reasons: Record<string, number> };

type LatestRating = {
  id: string;
  group_id: string | null;
  stars: number;
  reasons: string[];
  comment: string | null;
  created_at: string;
  passenger_requests: { passenger_name: string | null; destination_address: string } | null;
};

// Admin dashboard, History tab: what passengers think of their rides - the average, how the stars
// are spread, the reasons given most often, and the latest ratings with a comment or of 1-2 stars
// (flagged for review), each linking to its ride. Ratings are never shown to other passengers;
// only the admin can read them (row level security, admin_rating_summary).
export default function AdminRatings({ warningsOnly = false, refreshKey = 0, onOpenGroup, onOpenHistory }: Props) {
  const { t } = useTranslation();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [latest, setLatest] = useState<LatestRating[]>([]);
  const [lowCount, setLowCount] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    if (warningsOnly) {
      const since = new Date(Date.now() - WARNING_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { count, error } = await supabase
        .from('ride_ratings')
        .select('id', { count: 'exact', head: true })
        .lte('stars', 2)
        .gte('created_at', since);
      if (error) console.warn('counting low ratings failed', error.message);
      setLowCount(count ?? 0);
      return;
    }
    const [summaryResult, latestResult] = await Promise.all([
      supabase.rpc('admin_rating_summary', { p_days: OVERVIEW_DAYS }),
      supabase
        .from('ride_ratings')
        .select('id, group_id, stars, reasons, comment, created_at, passenger_requests(passenger_name, destination_address)')
        .or('comment.not.is.null,stars.lte.2')
        .order('created_at', { ascending: false })
        .limit(LATEST_LIMIT)
        .returns<LatestRating[]>(),
    ]);
    if (summaryResult.error || latestResult.error) {
      console.warn('loading ratings failed', summaryResult.error?.message ?? latestResult.error?.message);
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setOverview(summaryResult.data as Overview);
    setLatest(latestResult.data ?? []);
  }, [warningsOnly]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (warningsOnly) {
    if (lowCount === 0) return null;
    return (
      <Card style={styles.card} onPress={onOpenHistory} accessibilityLabel={t('adminRatings.warning', { count: lowCount, days: WARNING_DAYS })}>
        <Text style={styles.warningTitle}>{t('adminRatings.warning', { count: lowCount, days: WARNING_DAYS })}</Text>
        <Text style={styles.warningText}>{t('adminRatings.warningDetail')}</Text>
      </Card>
    );
  }

  const total = overview?.count ?? 0;

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{t('adminRatings.title')}</Text>
      <Text style={styles.intro}>{t('adminRatings.intro', { days: OVERVIEW_DAYS })}</Text>

      {loadFailed ? (
        <Text style={styles.warningText}>{t('adminRatings.loadError')}</Text>
      ) : !overview ? null : total === 0 ? (
        <Text style={styles.line}>{t('adminRatings.empty')}</Text>
      ) : (
        <>
          <View style={styles.averageRow}>
            <Text style={styles.average}>{Number(overview.average).toFixed(1)}</Text>
            <Ionicons name="star" size={22} color={colors.warning} />
            <Text style={styles.line}>{t('adminRatings.basis', { count: total })}</Text>
          </View>

          {[5, 4, 3, 2, 1].map((stars) => {
            const count = Number(overview.distribution[String(stars)] ?? 0);
            return (
              <View key={stars} style={styles.barRow} accessible accessibilityLabel={t('adminRatings.barLabel', { stars, count })}>
                <Text style={styles.barLabel}>{stars}★</Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      isFlaggedRating(stars) && styles.barFillLow,
                      { width: `${total > 0 ? Math.round((count / total) * 100) : 0}%` },
                    ]}
                  />
                </View>
                <Text style={styles.barCount}>{count}</Text>
              </View>
            );
          })}

          <Text style={styles.subtitle}>{t('adminRatings.reasonsTitle')}</Text>
          {topReasons(overview.reasons ?? {}, 5).length === 0 ? (
            <Text style={styles.line}>{t('adminRatings.noReasons')}</Text>
          ) : (
            topReasons(overview.reasons ?? {}, 5).map(({ reason, count }) => (
              <Text key={reason} style={styles.line}>
                {t(`ratingReasons.${reason}`)} · {count}
              </Text>
            ))
          )}
        </>
      )}

      {latest.length > 0 ? (
        <>
          <Text style={styles.subtitle}>{t('adminRatings.latestTitle')}</Text>
          {latest.map((rating) => (
            <Pressable
              key={rating.id}
              onPress={rating.group_id && onOpenGroup ? () => onOpenGroup(rating.group_id!) : undefined}
              disabled={!rating.group_id || !onOpenGroup}
              style={styles.latest}
              accessibilityRole={rating.group_id ? 'button' : undefined}
            >
              <Text style={styles.latestHeader}>
                {'★'.repeat(rating.stars)}
                {'☆'.repeat(5 - rating.stars)} · {formatBarcelonaDateTime(rating.created_at)}
              </Text>
              {isFlaggedRating(rating.stars) ? <Text style={styles.flag}>{t('adminRatings.needsReview')}</Text> : null}
              <Text style={styles.line}>
                {rating.passenger_requests?.passenger_name?.trim() || t('adminRatings.passenger')}
                {rating.passenger_requests?.destination_address ? ` · ${rating.passenger_requests.destination_address}` : ''}
              </Text>
              {rating.reasons.length > 0 ? (
                <Text style={styles.line}>{rating.reasons.map((reason) => t(`ratingReasons.${reason}`)).join(', ')}</Text>
              ) : null}
              {rating.comment ? <Text style={styles.comment}>“{rating.comment}”</Text> : null}
              {rating.group_id && onOpenGroup ? <Text style={styles.link}>{t('adminRatings.openRide')}</Text> : null}
            </Pressable>
          ))}
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.x4,
  },
  title: {
    ...baseText.h3,
    marginBottom: spacing.x1,
  },
  intro: {
    ...baseText.caption,
    color: colors.textSecondary,
    marginBottom: spacing.x3,
  },
  subtitle: {
    ...baseText.label,
    marginTop: spacing.x4,
    marginBottom: spacing.x2,
  },
  line: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
  },
  averageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
    marginBottom: spacing.x3,
  },
  average: {
    ...baseText.h1,
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
    marginBottom: spacing.x1,
  },
  barLabel: {
    ...baseText.caption,
    width: 28,
  },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceCardSolid,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.success,
  },
  barFillLow: {
    backgroundColor: colors.warning,
  },
  barCount: {
    ...baseText.caption,
    width: 32,
    textAlign: 'right',
  },
  latest: {
    paddingVertical: spacing.x3,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  latestHeader: {
    ...baseText.bodySmall,
    color: colors.warning,
    marginBottom: spacing.x1,
  },
  flag: {
    ...baseText.caption,
    color: colors.dangerStrong,
    fontWeight: '700',
    marginBottom: spacing.x1,
  },
  comment: {
    ...baseText.bodySmall,
    marginTop: spacing.x1,
  },
  link: {
    ...baseText.caption,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
    marginTop: spacing.x1,
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
  },
});
