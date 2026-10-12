import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { CalibrationRow, calibrationVerdict } from '../services/readyTimeRules';
import { supabase } from '../services/supabase';
import { baseText, colors, spacing } from '../theme/colors';
import Card from './Card';

type Props = {
  // Reloads when this changes (the dashboard's pull-to-refresh).
  refreshKey?: number;
};

// Admin dashboard: how far the calculated ready time (arrival at the gate plus a buffer per kind
// of flight) is from when passengers really reached the meeting point - per kind of flight, so
// the buffers can be adjusted (ready_time_settings in the Supabase dashboard). Only the admin can
// read this (admin_ready_time_calibration checks the role).
export default function AdminReadyTimeCalibration({ refreshKey = 0 }: Props) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<CalibrationRow[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_ready_time_calibration');
    if (error) {
      console.warn('admin_ready_time_calibration failed', error.message);
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setRows(
      ((data ?? []) as CalibrationRow[]).map((row) => ({
        ...row,
        rides: Number(row.rides),
        buffer_minutes: Number(row.buffer_minutes),
        average_difference_minutes: Number(row.average_difference_minutes),
      }))
    );
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (!rows && !loadFailed) return null;

  return (
    <Card style={styles.card}>
      <Text style={styles.title}>{t('adminCalibration.title')}</Text>
      <Text style={styles.intro}>{t('adminCalibration.intro')}</Text>
      {loadFailed ? (
        <Text style={styles.warning}>{t('adminCalibration.loadError')}</Text>
      ) : rows && rows.length === 0 ? (
        <Text style={styles.line}>{t('adminCalibration.empty')}</Text>
      ) : (
        (rows ?? []).map((row) => {
          const verdict = calibrationVerdict(row.average_difference_minutes);
          return (
            <View key={`${row.category}-${row.checked_bag}`} style={styles.row}>
              <Text style={styles.name}>
                {t(`adminCalibration.category.${row.category}.${row.checked_bag ? 'bag' : 'noBag'}`)}
              </Text>
              <Text style={styles.line}>
                {t('adminCalibration.basis', { rides: row.rides, buffer: Math.round(row.buffer_minutes) })}
              </Text>
              <Text style={verdict === 'onTime' ? styles.line : styles.warning}>
                {t(`adminCalibration.verdict.${verdict}`, {
                  minutes: Math.abs(row.average_difference_minutes).toFixed(1),
                })}
              </Text>
            </View>
          );
        })
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.x4,
  },
  title: {
    ...baseText.h3,
    marginBottom: spacing.x2,
  },
  intro: {
    ...baseText.caption,
    color: colors.textSecondary,
    marginBottom: spacing.x3,
  },
  row: {
    marginBottom: spacing.x3,
  },
  name: {
    ...baseText.body,
    fontWeight: '600',
    marginBottom: spacing.x1,
  },
  line: {
    ...baseText.caption,
    color: colors.info,
  },
  warning: {
    ...baseText.caption,
    color: colors.warning,
    fontWeight: '700',
  },
});
