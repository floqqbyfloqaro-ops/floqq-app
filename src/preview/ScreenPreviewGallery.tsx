import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { loadMyAvatar } from '../services/myAvatar';
import { baseText, colors, radii, spacing } from '../theme/colors';
import { PREVIEW_ENTRIES, PreviewEntry } from './entries';
import { makePreviewData, PREVIEW_USER_ID, PreviewData } from './fixtures';
import PreviewOverlay from './PreviewOverlay';
import { startPreview, stopPreview } from './previewMode';

type Props = {
  // Back to the app; the preview is already off when this is called.
  onClose: () => void;
};

// The languages the app ships in, to check every translation.
const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'fr', label: 'FR' },
  { code: 'es', label: 'ES' },
] as const;

// "Screen preview": every screen of the app, filled with sample data, without a ride request,
// a payment or a match. For development and test builds only (App.tsx shows the button). The
// preview is on for as long as this is open: see previewMode.ts for what that switches off.
export default function ScreenPreviewGallery({ onClose }: Props) {
  const { i18n } = useTranslation();
  const [open, setOpen] = useState<{ entry: PreviewEntry; data: PreviewData; key: number } | null>(null);
  // The app's own language, put back when the gallery closes.
  const appLanguage = useRef(i18n.language);

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
    if (i18n.language !== appLanguage.current) i18n.changeLanguage(appLanguage.current);
    onClose();
  };

  if (open) {
    const index = PREVIEW_ENTRIES.indexOf(open.entry);
    const next = PREVIEW_ENTRIES[index + 1];
    const nav = { open: openEntry, gallery: () => setOpen(null) };
    return (
      <View style={styles.root}>
        <View key={open.key} style={styles.root}>
          {open.entry.render(nav, open.data)}
        </View>
        <PreviewOverlay
          onGallery={nav.gallery}
          // The last screen leads back to the gallery.
          onNext={() => (next ? openEntry(next.id) : setOpen(null))}
          position={`${index + 1}/${PREVIEW_ENTRIES.length}`}
        />
      </View>
    );
  }

  return (
    <GalleryList
      language={i18n.language}
      onLanguage={(code) => i18n.changeLanguage(code)}
      onOpen={openEntry}
      onClose={close}
    />
  );
}

type ListProps = {
  language: string;
  onLanguage: (code: string) => void;
  onOpen: (id: string) => void;
  onClose: () => void;
};

function GalleryList({ language, onLanguage, onOpen, onClose }: ListProps) {
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

      <View style={styles.languages} accessibilityRole="radiogroup" accessibilityLabel="Language">
        {LANGUAGES.map(({ code, label }) => {
          const selected = language.startsWith(code);
          return (
            <Pressable
              key={code}
              onPress={() => onLanguage(code)}
              style={[styles.language, selected && styles.languageSelected]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`Language ${label}`}
            >
              <Text style={[styles.languageText, selected && styles.languageTextSelected]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        onPress={() => onOpen(PREVIEW_ENTRIES[0].id)}
        style={({ pressed }) => [styles.start, pressed && styles.rowPressed]}
        accessibilityRole="button"
      >
        <Ionicons name="play" size={16} color={colors.textInverse} />
        <Text style={styles.startText}>Walk through the whole journey</Text>
      </Pressable>

      {PREVIEW_ENTRIES.map((entry, index) => (
        <Pressable
          key={entry.id}
          onPress={() => onOpen(entry.id)}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          accessibilityRole="button"
          accessibilityLabel={[entry.screen, entry.state].filter(Boolean).join(', ')}
        >
          <Text style={styles.rowNumber}>{index + 1}</Text>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>{entry.screen}</Text>
            {entry.state ? <Text style={styles.rowState}>{entry.state}</Text> : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </Pressable>
      ))}
    </ScrollView>
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
    marginBottom: spacing.x4,
  },
  languages: {
    flexDirection: 'row',
    gap: spacing.x2,
    marginBottom: spacing.x4,
  },
  language: {
    paddingHorizontal: spacing.x4,
    paddingVertical: spacing.x2,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  languageSelected: {
    borderColor: colors.accentPrimary,
    backgroundColor: colors.accentPrimarySoft,
  },
  languageText: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  languageTextSelected: {
    color: colors.textPrimary,
  },
  start: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x2,
    paddingVertical: spacing.x3,
    marginBottom: spacing.x6,
    borderRadius: radii.md,
    backgroundColor: colors.accentGold,
  },
  startText: {
    ...baseText.body,
    color: colors.textInverse,
    fontWeight: '700',
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
});
