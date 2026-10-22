import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { RATING_COMMENT_MAX, RATING_REASONS, RatingReason } from '../services/rideSummaryRules';
import { baseText, borders, colors, overlays, radii, spacing } from '../theme/colors';
import AuthTextInput from './AuthTextInput';
import PrimaryButton from './PrimaryButton';
import SecondaryButton from './SecondaryButton';

// Where "Report a safety problem" writes to, until FLOQQ has its own report flow.
const SUPPORT_EMAIL = 'floqqbyfloqaro@gmail.com';

type Props = {
  visible: boolean;
  stars: number;
  // The ride's reference, for the safety report.
  requestId: string;
  initialReasons: RatingReason[];
  initialComment: string;
  busy: boolean;
  onSend: (reasons: RatingReason[], comment: string) => void;
  // Keeps the stars alone.
  onSkip: () => void;
};

// "What could we do better?" after 1 to 4 stars: tap reasons first (the keyboard only opens when
// they tap the comment), an optional comment, Send or Skip. Fits a small phone with the keyboard
// open: it scrolls, and the buttons stay reachable.
export default function RatingFollowUpSheet({
  visible,
  stars,
  requestId,
  initialReasons,
  initialComment,
  busy,
  onSend,
  onSkip,
}: Props) {
  const { t } = useTranslation();
  const [reasons, setReasons] = useState<RatingReason[]>(initialReasons);
  const [comment, setComment] = useState(initialComment);

  useEffect(() => {
    if (!visible) return;
    setReasons(initialReasons);
    setComment(initialComment);
  }, [visible, initialReasons, initialComment]);

  const toggle = (reason: RatingReason) =>
    setReasons((current) => (current.includes(reason) ? current.filter((r) => r !== reason) : [...current, reason]));

  const reportSafety = () => {
    const subject = encodeURIComponent(t('ratingSheet.safetySubject'));
    const body = encodeURIComponent(t('ratingSheet.safetyBody', { reference: requestId }));
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`).catch(() => {});
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onSkip}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <Text style={styles.title}>{t('rating_improve_title')}</Text>
            <Text style={styles.subtitle}>{t('ratingSheet.starsGiven', { count: stars })}</Text>

            <View style={styles.chips} accessibilityRole="list">
              {RATING_REASONS.map((reason) => {
                const selected = reasons.includes(reason);
                return (
                  <Pressable
                    key={reason}
                    onPress={() => toggle(reason)}
                    style={[styles.chip, selected && styles.chipSelected]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{t(`ratingReasons.${reason}`)}</Text>
                  </Pressable>
                );
              })}
            </View>

            {reasons.includes('other_passengers') ? (
              <Pressable onPress={reportSafety} accessibilityRole="link" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.safetyLink}>{t('ratingSheet.reportSafety')}</Text>
              </Pressable>
            ) : null}

            <AuthTextInput
              placeholder={t('ratingSheet.commentPlaceholder')}
              accessibilityLabel={t('ratingSheet.commentPlaceholder')}
              value={comment}
              onChangeText={setComment}
              multiline
              maxLength={RATING_COMMENT_MAX}
              helperText={t('ratingSheet.commentCount', { count: comment.length, max: RATING_COMMENT_MAX })}
            />

            <View style={styles.buttons}>
              <PrimaryButton label={t('ratingSheet.send')} onPress={() => onSend(reasons, comment)} loading={busy} />
            </View>
            <SecondaryButton label={t('ratingSheet.skip')} onPress={onSkip} disabled={busy} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: overlays.scrimMedium,
  },
  sheet: {
    maxHeight: '90%',
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
  },
  content: {
    padding: spacing.x6,
    paddingBottom: spacing.x8,
  },
  title: {
    ...baseText.h2,
    marginBottom: spacing.x1,
  },
  subtitle: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.x4,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.x2,
    marginBottom: spacing.x4,
  },
  chip: {
    minHeight: 40,
    paddingHorizontal: spacing.x4,
    borderRadius: radii.pill,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    justifyContent: 'center',
  },
  chipSelected: {
    borderColor: colors.accentPrimary,
    backgroundColor: colors.accentPrimarySoft,
  },
  chipText: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  chipTextSelected: {
    color: colors.textPrimary,
  },
  safetyLink: {
    ...baseText.bodySmall,
    color: colors.warning,
    fontWeight: '600',
    textDecorationLine: 'underline',
    marginBottom: spacing.x4,
  },
  buttons: {
    marginTop: spacing.x2,
    marginBottom: spacing.x3,
  },
});
