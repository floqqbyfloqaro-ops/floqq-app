import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { baseText, borders, colors, radii, spacing } from '../theme/colors';

type Props = {
  // 'question': "Anything else I can help with?"; 'problem': "Did that solve it?".
  kind: 'question' | 'problem';
  // "No, that's all" / "Yes, it's solved".
  onDone: () => void;
  // "Yes, another question" (just carries on) / "No, still a problem" (the team).
  onMore: () => void;
  disabled?: boolean;
};

// The two answers under the assistant's one "are you done?" question - asked at most once per
// conversation, only when the passenger's reaction was unclear.
export default function HelpFollowupButtons({ kind, onDone, onMore, disabled = false }: Props) {
  const { t } = useTranslation();
  const done = t(kind === 'problem' ? 'help.followup.solvedYes' : 'help.followup.thatsAll');
  const more = t(kind === 'problem' ? 'help.followup.solvedNo' : 'help.followup.anotherQuestion');
  return (
    <View style={styles.row}>
      <Pressable onPress={onDone} disabled={disabled} style={styles.chip} accessibilityRole="button" accessibilityLabel={done}>
        <Text style={styles.chipText}>{done}</Text>
      </Pressable>
      <Pressable onPress={onMore} disabled={disabled} style={styles.chip} accessibilityRole="button" accessibilityLabel={more}>
        <Text style={styles.chipText}>{more}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.x2,
    marginTop: spacing.x3,
    marginLeft: 40,
  },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.x4,
    borderRadius: radii.pill,
    borderWidth: borders.regular,
    borderColor: colors.accentPrimaryStrong,
    backgroundColor: colors.surfaceCardSolid,
  },
  chipText: {
    ...baseText.bodySmall,
    fontWeight: '700',
  },
});
