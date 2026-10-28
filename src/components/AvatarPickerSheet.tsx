import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { setMyAvatar, useMyAvatarId } from '../services/myAvatar';
import { baseText, borders, colors, overlays, radii, spacing } from '../theme/colors';
import AvatarPicker from './AvatarPicker';
import PrimaryButton from './PrimaryButton';

const CONFIRMATION_MS = 2000;

type Props = {
  visible: boolean;
  onClose: () => void;
};

// "Choose your avatar" from the Profile screen: a tap saves at once - every screen shows the new
// avatar straight away - with a short "Avatar updated".
export default function AvatarPickerSheet({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const myAvatarId = useMyAvatarId();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) setMessage(null);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [visible]);

  const handleSelect = async (avatarId: number) => {
    if (avatarId === myAvatarId) return;
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setMessage(null);
    const { error } = await setMyAvatar(avatarId);
    setMessage({ text: t(error ? 'avatar.updateError' : 'avatar.updated'), error });
    if (!error) hideTimer.current = setTimeout(() => setMessage(null), CONFIRMATION_MS);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('avatar.done')} />
        <View style={[styles.sheet, { paddingBottom: spacing.x6 + insets.bottom }]}>
          <View style={styles.handle} />
          <Text style={styles.title} accessibilityRole="header">
            {t('avatar.chooseTitle')}
          </Text>
          <Text style={styles.subtitle}>{t('avatar.chooseSubtitle')}</Text>

          <AvatarPicker selectedId={myAvatarId} onSelect={handleSelect} />

          <Text
            style={[styles.message, message?.error && styles.messageError]}
            accessibilityLiveRegion="polite"
          >
            {message?.text ?? ' '}
          </Text>

          <PrimaryButton label={t('avatar.done')} onPress={onClose} />
        </View>
      </View>
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
    backgroundColor: colors.bgElevated,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.x6,
    paddingTop: spacing.x3,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.borderSubtle,
    marginBottom: spacing.x4,
  },
  title: {
    ...baseText.h3,
    marginBottom: spacing.x1,
  },
  subtitle: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.x6,
  },
  message: {
    ...baseText.bodySmall,
    color: colors.success,
    textAlign: 'center',
    marginVertical: spacing.x4,
  },
  messageError: {
    color: colors.dangerStrong,
  },
});
