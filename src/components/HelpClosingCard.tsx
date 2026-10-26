import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { baseText, borders, colors, radii, spacing } from '../theme/colors';

type Props = {
  // The conversation's one-line summary ("Refund status explained").
  title: string | null;
  // Already answered "Was this helpful?" (once per conversation).
  helpful: 'up' | 'down' | null;
  // Resolved by the FLOQQ team rather than the assistant.
  byTeam?: boolean;
  onRate: (value: 'up' | 'down') => void;
};

// At the end of a resolved conversation: what it was about, and an optional "Was this helpful?" -
// asked once, never required.
export default function HelpClosingCard({ title, helpful, byTeam = false, onRate }: Props) {
  const { t } = useTranslation();
  const [rated, setRated] = useState<'up' | 'down' | null>(helpful);

  const rate = (value: 'up' | 'down') => {
    if (rated) return;
    setRated(value);
    onRate(value);
  };

  return (
    <View style={styles.card} accessibilityLiveRegion="polite">
      <View style={styles.header}>
        <Ionicons name="checkmark-circle" size={20} color={colors.success} />
        <Text style={styles.title} numberOfLines={2}>
          {title ?? t(byTeam ? 'help.status.resolvedByTeam' : 'help.status.resolved')}
        </Text>
      </View>
      {rated ? (
        <Text style={styles.thanks}>{t('help.thanksForFeedback')}</Text>
      ) : (
        <View style={styles.rateRow}>
          <Text style={styles.question}>{t('help.wasHelpful')}</Text>
          <Pressable onPress={() => rate('up')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('help.thumbsUp')}>
            <Ionicons name="thumbs-up-outline" size={20} color={colors.textSecondary} />
          </Pressable>
          <Pressable onPress={() => rate('down')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('help.thumbsDown')}>
            <Ionicons name="thumbs-down-outline" size={20} color={colors.textSecondary} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.x4,
    padding: spacing.x4,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCard,
    gap: spacing.x3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
  },
  title: {
    ...baseText.body,
    fontWeight: '700',
    flex: 1,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x4,
  },
  question: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    flex: 1,
  },
  thanks: {
    ...baseText.bodySmall,
    color: colors.success,
  },
});
