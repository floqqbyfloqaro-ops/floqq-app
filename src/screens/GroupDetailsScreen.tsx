import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { baseText, colors, spacing } from '../theme/colors';

type Props = {
  onBack: () => void;
};

// Placeholder for the confirmed-group passenger experience - design pending. Wired up now so a
// confirmed ride has somewhere to go from MyRideScreen; not the same file as the existing
// GroupDetailScreen.tsx, which is the admin-facing fare-split/confirm screen.
export default function GroupDetailsScreen({ onBack }: Props) {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <Pressable
        onPress={onBack}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel={t('admin.back')}
      >
        <Text style={styles.backText}>{t('admin.back')}</Text>
      </Pressable>
      <Text style={styles.title}>{t('groupDetailsPlaceholder.title')}</Text>
      <Text style={styles.placeholder}>{t('groupDetailsPlaceholder.body')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
    paddingTop: spacing.x12,
    paddingHorizontal: spacing.x6,
  },
  backText: {
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
    marginBottom: spacing.x3,
  },
  title: {
    ...baseText.h2,
    marginBottom: spacing.x6,
  },
  placeholder: {
    ...baseText.body,
    color: colors.textSecondary,
  },
});
