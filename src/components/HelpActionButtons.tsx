import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { HelpAction } from '../services/helpChat';
import { baseText, borders, colors, radii, spacing } from '../theme/colors';

type Props = {
  actions: HelpAction[];
  onAction: (action: HelpAction) => void;
};

const ICONS: Record<HelpAction, keyof typeof Ionicons.glyphMap> = {
  open_my_ride: 'car-outline',
  edit_ride: 'create-outline',
  cancel_ride: 'close-circle-outline',
  payment_methods: 'card-outline',
  show_badge: 'shapes-outline',
  location_settings: 'location-outline',
};

// Buttons under an answer that open a screen. They never do anything by themselves: cancelling a
// ride or changing a card happens on that screen, with its usual confirmation.
export default function HelpActionButtons({ actions, onAction }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      {actions.map((action) => (
        <Pressable key={action} onPress={() => onAction(action)} style={styles.button} accessibilityRole="button" accessibilityHint={t('help.actionHint')}>
          <Ionicons name={ICONS[action]} size={16} color={colors.accentPrimaryStrong} />
          <Text style={styles.text}>{t(`help.action.${action}`)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.x2,
    marginTop: spacing.x2,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x1,
    minHeight: 40,
    paddingHorizontal: spacing.x3,
    borderRadius: radii.pill,
    borderWidth: borders.regular,
    borderColor: colors.accentPrimaryStrong,
    backgroundColor: colors.accentPrimarySoft,
  },
  text: {
    ...baseText.bodySmall,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
