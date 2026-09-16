import { Pressable, StyleSheet, Text, View } from 'react-native';

import { baseText, borders, colors, radii, spacing } from '../theme/colors';

type Props = {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
};

export default function ErrorNotice({ message, onRetry, retryLabel = 'Try again' }: Props) {
  // The container is deliberately NOT a single `accessible` node: it contains an
  // interactive retry button that needs its own screen-reader focus stop, so collapsing
  // the whole thing into one element (as accessibilityRole="alert" would encourage) would
  // make the retry action unreachable via VoiceOver/TalkBack.
  return (
    <View style={styles.container}>
      <Text style={styles.icon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        ⚠️
      </Text>
      <View style={styles.textColumn}>
        <Text style={styles.message} accessibilityLiveRegion="polite" accessibilityRole="text">
          {message}
        </Text>
        {onRetry ? (
          <Pressable
            onPress={onRetry}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={retryLabel}
          >
            <Text style={styles.retry}>{retryLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.x2,
    backgroundColor: colors.dangerSoft,
    borderWidth: borders.regular,
    borderColor: 'rgba(239, 68, 68, 0.28)',
    borderRadius: radii.md,
    padding: spacing.x3,
    marginBottom: spacing.x4,
  },
  icon: {
    fontSize: 16,
    lineHeight: 20,
  },
  textColumn: {
    flex: 1,
  },
  message: {
    ...baseText.bodySmall,
    color: colors.dangerStrong,
  },
  retry: {
    ...baseText.bodySmall,
    color: colors.dangerStrong,
    fontWeight: '700',
    textDecorationLine: 'underline',
    marginTop: spacing.x1,
  },
});
