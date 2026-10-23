import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { baseText, borders, colors, radii, spacing } from '../theme/colors';

// Shown first, above the answer, whenever a message suggests danger: call 112, one tap.
export default function HelpEmergencyCard() {
  const { t } = useTranslation();
  return (
    <View style={styles.card} accessibilityRole="alert">
      <View style={styles.row}>
        <Ionicons name="warning" size={20} color={colors.dangerStrong} />
        <Text style={styles.text}>{t('help.emergencyFirst')}</Text>
      </View>
      <Pressable
        onPress={() => Linking.openURL('tel:112')}
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel={t('help.call112')}
      >
        <Ionicons name="call" size={18} color={colors.white} />
        <Text style={styles.buttonText}>{t('help.call112')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.x3,
    borderRadius: radii.md,
    borderWidth: borders.regular,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
    gap: spacing.x3,
    marginBottom: spacing.x2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.x2,
  },
  text: {
    ...baseText.body,
    flex: 1,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x2,
    minHeight: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.danger,
  },
  buttonText: {
    ...baseText.body,
    color: colors.white,
    fontWeight: '700',
  },
});
