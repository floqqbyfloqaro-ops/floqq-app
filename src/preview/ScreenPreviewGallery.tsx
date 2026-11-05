import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadMyAvatar } from '../services/myAvatar';
import { baseText, colors, radii, spacing } from '../theme/colors';
import { PREVIEW_ENTRIES, PreviewEntry } from './entries';
import { makePreviewData, PREVIEW_USER_ID, PreviewData } from './fixtures';
import { startPreview, stopPreview, subscribePreviewNotices } from './previewMode';

type Props = {
  // Back to the app; the preview is already off when this is called.
  onClose: () => void;
};

// How long "Preview - action disabled" stays up.
const NOTICE_MS = 2500;

// "Screen preview": every screen of the app, filled with sample data, without a ride request,
// a payment or a match. For development and test builds only (App.tsx shows the button). The
// preview is on for as long as this is open: see previewMode.ts for what that switches off.
export default function ScreenPreviewGallery({ onClose }: Props) {
  const [open, setOpen] = useState<{ entry: PreviewEntry; data: PreviewData; key: number } | null>(null);

  useEffect(() => {
    startPreview(makePreviewData('searching'));
    loadMyAvatar(PREVIEW_USER_ID);
    return stopPreview;
  }, []);

  const openEntry = async (id: string) => {
    const entry = PREVIEW_ENTRIES.find((candidate) => candidate.id === id);
    if (!entry) return;
    // Fresh sample data each time: what a previous screen pretended to change is gone.
    const data = entry.data();
    startPreview(data);
    loadMyAvatar(PREVIEW_USER_ID);
    await entry.prepare?.().catch(() => {});
    setOpen((previous) => ({ entry, data, key: (previous?.key ?? 0) + 1 }));
  };

  const close = () => {
    stopPreview();
    onClose();
  };

  if (open) {
    const nav = { open: openEntry, gallery: () => setOpen(null) };
    return (
      <View style={styles.root}>
        <View key={open.key} style={styles.root}>
          {open.entry.render(nav, open.data)}
        </View>
        <PreviewOverlay onGallery={nav.gallery} />
      </View>
    );
  }

  return <GalleryList onOpen={openEntry} onClose={close} />;
}

function GalleryList({ onOpen, onClose }: { onOpen: (id: string) => void; onClose: () => void }) {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      style={styles.gallery}
      contentContainerStyle={[styles.galleryContent, { paddingTop: insets.top + spacing.x6, paddingBottom: insets.bottom + spacing.x8 }]}
    >
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Screen preview
        </Text>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back to the app">
          <Ionicons name="close" size={26} color={colors.textPrimary} />
        </Pressable>
      </View>
      <Text style={styles.subtitle}>Sample data only. Nothing is saved, sent or charged.</Text>

      {PREVIEW_ENTRIES.map((entry, index) => {
        const number = index + 1;
        return (
          <Pressable
            key={entry.id}
            onPress={() => onOpen(entry.id)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            accessibilityRole="button"
            accessibilityLabel={[entry.screen, entry.state].filter(Boolean).join(', ')}
          >
            <Text style={styles.rowNumber}>{number}</Text>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{entry.screen}</Text>
              {entry.state ? <Text style={styles.rowState}>{entry.state}</Text> : null}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// On top of every previewed screen: the PREVIEW label (tap it for the gallery) and, briefly under
// it, "Preview - action disabled".
function PreviewOverlay({ onGallery }: { onGallery: () => void }) {
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
      <Pressable
        onPress={onGallery}
        hitSlop={8}
        style={styles.badge}
        accessibilityRole="button"
        accessibilityLabel="Preview. Back to the screen gallery"
      >
        <Text style={styles.badgeText}>PREVIEW</Text>
        <Ionicons name="grid-outline" size={14} color={colors.textInverse} />
      </Pressable>
      {notice ? (
        <View pointerEvents="none" style={styles.notice} accessibilityLiveRegion="polite">
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  gallery: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  galleryContent: {
    paddingHorizontal: spacing.x6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...baseText.h1,
  },
  subtitle: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.x2,
    marginBottom: spacing.x6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    paddingVertical: spacing.x3,
    paddingHorizontal: spacing.x4,
    marginBottom: spacing.x2,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceCardSolid,
  },
  rowPressed: {
    opacity: 0.7,
  },
  rowNumber: {
    ...baseText.caption,
    width: 22,
    color: colors.textSecondary,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    ...baseText.body,
    fontWeight: '600',
  },
  rowState: {
    ...baseText.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  // Across the top of the screen, the label and the notice under it, centred.
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
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
