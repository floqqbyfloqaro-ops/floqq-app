import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { baseText, colors, radii, spacing } from '../theme/colors';

// Shown on every screen where money is reserved or saved: payments only ever run with Stripe test
// keys (the server and cardSetup.ts refuse live ones), so nothing real is charged.
export default function TestModeBadge() {
  const { t } = useTranslation();
  return (
    <View style={styles.badge} accessible accessibilityRole="text">
      <Text style={styles.text}>{t('payments.testMode')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.warningSoft,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.x3,
    paddingVertical: spacing.x1,
    marginBottom: spacing.x3,
  },
  text: {
    ...baseText.caption,
    color: colors.warning,
    fontWeight: '700',
  },
});
