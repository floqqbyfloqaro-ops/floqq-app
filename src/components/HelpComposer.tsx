import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HELP_MAX_MESSAGE_CHARS } from '../constants';
import { baseText, borders, colors, radii, spacing } from '../theme/colors';

type Props = {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  disabled?: boolean;
  offline?: boolean;
};

// The counter only appears near the limit.
const COUNTER_FROM = HELP_MAX_MESSAGE_CHARS - 100;
const LINE_HEIGHT = baseText.body.lineHeight ?? 22;

// The help chat's input: grows up to four lines, then scrolls; the send button only works with
// something to send; a light tap of the phone on send.
export default function HelpComposer({ value, onChange, onSend, disabled = false, offline = false }: Props) {
  const { t } = useTranslation();
  const canSend = value.trim().length > 0 && !disabled;

  const send = () => {
    if (!canSend) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onSend();
  };

  return (
    <View>
      {offline ? (
        <View style={styles.offline} accessibilityLiveRegion="polite">
          <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />
          <Text style={styles.offlineText}>{t('help.offline')}</Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={t('help.inputPlaceholder')}
          placeholderTextColor={colors.textSecondary}
          accessibilityLabel={t('help.inputPlaceholder')}
          style={styles.input}
          multiline
          maxLength={HELP_MAX_MESSAGE_CHARS}
          textAlignVertical="top"
        />
        <Pressable
          onPress={send}
          disabled={!canSend}
          style={[styles.send, !canSend && styles.sendDisabled]}
          accessibilityRole="button"
          accessibilityLabel={t('help.send')}
          accessibilityState={{ disabled: !canSend }}
        >
          <Ionicons name="arrow-up" size={22} color={canSend ? colors.white : colors.textDisabled} />
        </Pressable>
      </View>
      {value.length >= COUNTER_FROM ? (
        <Text style={[styles.counter, value.length >= HELP_MAX_MESSAGE_CHARS && styles.counterFull]} accessibilityLiveRegion="polite">
          {t('help.charactersLeft', { count: HELP_MAX_MESSAGE_CHARS - value.length })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.x2,
  },
  input: {
    ...baseText.body,
    flex: 1,
    minHeight: 48,
    // Four lines, then it scrolls.
    maxHeight: LINE_HEIGHT * 4 + spacing.x3 * 2,
    paddingTop: spacing.x3,
    paddingBottom: spacing.x3,
    paddingHorizontal: spacing.x4,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCard,
    color: colors.textPrimary,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentPrimary,
  },
  sendDisabled: {
    backgroundColor: colors.surfaceCardSolid,
  },
  counter: {
    ...baseText.caption,
    color: colors.textSecondary,
    textAlign: 'right',
    marginTop: spacing.x1,
  },
  counterFull: {
    color: colors.warning,
  },
  offline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
    marginBottom: spacing.x2,
  },
  offlineText: {
    ...baseText.caption,
    color: colors.warning,
    flex: 1,
  },
});
