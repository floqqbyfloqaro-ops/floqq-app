import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { baseText, colors, radii, spacing } from '../theme/colors';
import type { RouteMapProps } from './RouteMap';

// react-native-maps has no web version: the web app shows this note where the phone shows the map.
export default function RouteMap({ height = 180 }: RouteMapProps) {
  const { t } = useTranslation();

  return (
    <View style={[styles.frame, { height }]}>
      <Text style={styles.note}>{t('matchFound.mapWebOnly')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radii.md,
    backgroundColor: colors.surfaceCardSolid,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.x4,
  },
  note: {
    ...baseText.bodySmall,
    textAlign: 'center',
  },
});
