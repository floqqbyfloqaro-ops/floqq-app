import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { baseText, colors, radii, spacing } from '../theme/colors';
import { isPreviewMode, subscribePreviewNotices } from './previewMode';

type Props = {
  // On a previewed screen: the PREVIEW label goes back to the gallery, "Next" opens the next
  // screen of the journey. Left out inside a pop-up, where the label is only a label.
  onGallery?: () => void;
  onNext?: () => void;
  // "3/25": where this screen is in the journey.
  position?: string;
};

// How long "Preview - action disabled" stays up.
const NOTICE_MS = 2500;

// Across the top of every previewed screen - and of every pop-up opened on one (Modal.tsx), which
// would otherwise cover it: the PREVIEW label and, briefly under it, "Preview - action disabled".
export default function PreviewOverlay({ onGallery, onNext, position }: Props) {
  const insets = useSafeAreaInsets();
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribePreviewNotices((message) => {
      setNotice(message);
      clearTimeout(timer);
      timer = setTimeout(() => setNotice(null), NOTICE_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  return (
    <View pointerEvents="box-none" style={[styles.overlay, { top: insets.top + spacing.x1 }]}>
      <View pointerEvents="box-none" style={styles.bar}>
        <Pressable
          onPress={onGallery}
          disabled={!onGallery}
          hitSlop={8}
          style={styles.badge}
          accessibilityRole={onGallery ? 'button' : 'text'}
          accessibilityLabel={onGallery ? 'Preview. Back to the screen gallery' : 'Preview'}
        >
          <Text style={styles.badgeText}>{position ? `PREVIEW ${position}` : 'PREVIEW'}</Text>
          {onGallery ? <Ionicons name="grid-outline" size={14} color={colors.textInverse} /> : null}
        </Pressable>
        {onNext ? (
          <Pressable onPress={onNext} hitSlop={8} style={styles.next} accessibilityRole="button" accessibilityLabel="Next screen">
            <Text style={styles.nextText}>Next</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.accentGold} />
          </Pressable>
        ) : null}
      </View>
      {notice ? (
        <View pointerEvents="none" style={styles.notice} accessibilityLiveRegion="polite">
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}
    </View>
  );
}

// Inside a pop-up: the label, only while the preview is on.
export function PreviewModalLabel() {
  return isPreviewMode() ? <PreviewOverlay /> : null;
}

const styles = StyleSheet.create({
  // Across the top of the screen, the label and the notice under it, centred.
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: spacing.x2,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x1,
    paddingHorizontal: spacing.x3,
    paddingVertical: spacing.x1,
    borderRadius: radii.pill,
    backgroundColor: colors.accentGold,
  },
  badgeText: {
    ...baseText.caption,
    color: colors.textInverse,
    fontWeight: '800',
    letterSpacing: 1,
  },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.x3,
    paddingVertical: spacing.x1,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accentGold,
    backgroundColor: colors.bgElevated,
  },
  nextText: {
    ...baseText.caption,
    color: colors.accentGold,
    fontWeight: '700',
  },
  notice: {
    paddingHorizontal: spacing.x4,
    paddingVertical: spacing.x3,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceCardSolid,
    borderWidth: 1,
    borderColor: colors.accentGold,
  },
  noticeText: {
    ...baseText.bodySmall,
    color: colors.textPrimary,
  },
});
