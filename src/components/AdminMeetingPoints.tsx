import type { TFunction } from 'i18next';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { MEETING_POINT_MIN_SEPARATION_METERS } from '../constants';
import { ClosePair, pointsTooClose } from '../services/guidanceRules';
import { MeetingPoint, meetingPointText, missingForActivation, wordingLanguageFor } from '../services/meetingPointRules';
import { fetchMeetingPoints, shippedText } from '../services/meetingPoints';
import { baseText, colors, spacing } from '../theme/colors';
import { formatBarcelonaDateTime } from '../utils/formatDateTime';
import Card from './Card';
import ErrorNotice from './ErrorNotice';
import Skeleton from './Skeleton';
import StatusPill from './StatusPill';

type Props = {
  onOpen: (point: MeetingPoint) => void;
};

// The language the admin reads the list in.
export const adminWordingLanguage = wordingLanguageFor;

// For one point: a warning per other active point in its terminal that lies too close to it - the
// arrow can't reliably tell two such points apart. A warning only; it blocks nothing.
export function closePointWarnings(pointId: string, pairs: ClosePair[], t: TFunction): string[] {
  return pairs
    .filter((pair) => pair.a.id === pointId || pair.b.id === pointId)
    .map((pair) =>
      t('adminMeetingPoints.tooClose', {
        meters: Math.round(pair.meters),
        code: (pair.a.id === pointId ? pair.b : pair.a).short_code,
      })
    );
}

// Admin dashboard, "Meeting points" tab: every point per terminal, with what it still needs
// before passengers can be sent to it. Tapping one opens its editor.
export default function AdminMeetingPoints({ onOpen }: Props) {
  const { t, i18n } = useTranslation();
  const [points, setPoints] = useState<MeetingPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await fetchMeetingPoints();
    setIsLoading(false);
    if (error) {
      console.warn('fetchMeetingPoints failed', error);
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setPoints(data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (isLoading) {
    return (
      <View accessible accessibilityLabel={t('admin.loading')}>
        {[0, 1, 2].map((i) => (
          <Card key={i} style={styles.row}>
            <Skeleton width={120} height={18} style={styles.skeletonGap} />
            <Skeleton width={200} height={14} />
          </Card>
        ))}
      </View>
    );
  }

  if (loadFailed) {
    return <ErrorNotice message={t('adminMeetingPoints.loadError')} onRetry={load} retryLabel={t('common.retry')} />;
  }

  const language = adminWordingLanguage(i18n.language);
  const terminals = [...new Set(points.map((point) => point.terminal))];
  const closePairs = pointsTooClose(points, MEETING_POINT_MIN_SEPARATION_METERS);

  return (
    <View>
      {points.length === 0 ? <Text style={styles.emptyText}>{t('adminMeetingPoints.empty')}</Text> : null}
      {terminals.map((terminal) => (
        <View key={terminal}>
          <Text style={styles.terminalHeader} accessibilityRole="header">
            {t('adminMeetingPoints.terminal', { terminal })}
          </Text>
          {points
            .filter((point) => point.terminal === terminal)
            .map((point) => {
              const name = meetingPointText(point, 'name', language, shippedText);
              const missing = missingForActivation(point, shippedText);
              const statusLabel = t(point.is_active ? 'adminMeetingPoints.active' : 'adminMeetingPoints.inactive');
              const verifiedLabel = point.verified_at
                ? t('adminMeetingPoints.verifiedOn', { date: formatBarcelonaDateTime(point.verified_at) })
                : null;
              const missingLabel = missing.length
                ? t('adminMeetingPoints.missing', {
                    items: missing.map((item) => t(`adminMeetingPoints.missingItem.${item}`)).join(', '),
                  })
                : null;
              return (
                <Card
                  key={point.id}
                  onPress={() => onOpen(point)}
                  style={styles.row}
                  accessibilityLabel={[point.short_code, name, statusLabel, verifiedLabel, missingLabel]
                    .filter(Boolean)
                    .join(', ')}
                >
                  <Text style={styles.code}>{point.short_code}</Text>
                  <Text style={styles.name}>{name}</Text>
                  {verifiedLabel ? <Text style={styles.meta}>{verifiedLabel}</Text> : null}
                  {missingLabel ? <Text style={styles.missing}>{missingLabel}</Text> : null}
                  {closePointWarnings(point.id, closePairs, t).map((warning) => (
                    <Text key={warning} style={styles.missing}>
                      {warning}
                    </Text>
                  ))}
                  <StatusPill status={point.is_active ? 'Group Confirmed' : 'Searching'} label={statusLabel} />
                </Card>
              );
            })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginBottom: spacing.x3,
  },
  skeletonGap: {
    marginBottom: spacing.x2,
  },
  emptyText: {
    ...baseText.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.x4,
  },
  terminalHeader: {
    ...baseText.h3,
    marginTop: spacing.x2,
    marginBottom: spacing.x3,
  },
  code: {
    ...baseText.label,
    marginBottom: spacing.x1,
  },
  name: {
    ...baseText.body,
    fontWeight: '600',
    marginBottom: spacing.x1,
  },
  meta: {
    ...baseText.caption,
    color: colors.info,
    marginBottom: spacing.x1,
  },
  missing: {
    ...baseText.caption,
    color: colors.warning,
    marginBottom: spacing.x2,
  },
});
