import { Ionicons } from '@expo/vector-icons';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { HelpAction, HelpMessage } from '../services/helpChat';
import { plainText } from '../services/helpMarkdown';
import { baseText, borders, colors, radii, spacing } from '../theme/colors';
import HelpActionButtons from './HelpActionButtons';
import HelpAvatar from './HelpAvatar';
import HelpDataCard from './HelpDataCard';
import HelpEmergencyCard from './HelpEmergencyCard';
import HelpMarkdown from './HelpMarkdown';
import TypingDots from './TypingDots';

type Props = {
  message: HelpMessage;
  // Consecutive messages from the same side are grouped: one avatar, one time.
  firstInGroup: boolean;
  lastInGroup: boolean;
  // The answer still being written: no time, no feedback yet; dots until its first word.
  streaming?: boolean;
  onAction: (action: HelpAction) => void;
  onFeedback: (messageId: string, value: 'up' | 'down' | null, note?: string) => void;
};

// One message in the help chat: the assistant's on the left with the F glyph, the passenger's on the
// right in the accent colour. Under an answer: its cards, its buttons, and a small thumbs up / down.
function HelpMessageRow({ message, firstInGroup, lastInGroup, streaming = false, onAction, onFeedback }: Props) {
  const { t, i18n } = useTranslation();
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(message.feedback ?? null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [noteSent, setNoteSent] = useState(false);
  const isUser = message.role === 'user';
  const time = new Date(message.created_at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });

  const rate = (value: 'up' | 'down') => {
    const next = feedback === value ? null : value;
    setFeedback(next);
    setNoteOpen(next === 'down');
    setNoteSent(false);
    onFeedback(message.id, next);
  };

  if (isUser) {
    return (
      <View style={[styles.userRow, firstInGroup && styles.groupGap]}>
        <View style={styles.userBubble} accessible accessibilityLabel={t('help.youSaid', { text: message.content, time })}>
          <Text style={styles.userText} selectable>
            {message.content}
          </Text>
        </View>
        {lastInGroup ? <Text style={[styles.time, styles.timeRight]}>{time}</Text> : null}
      </View>
    );
  }

  const waitingForFirstWord = streaming && !message.content;
  return (
    <View style={[styles.assistantRow, firstInGroup && styles.groupGap]}>
      <View style={styles.avatarSlot}>{firstInGroup ? <HelpAvatar /> : null}</View>
      <View style={styles.assistantColumn}>
        {message.emergency ? <HelpEmergencyCard /> : null}
        <View
          style={styles.assistantBubble}
          accessible={!streaming}
          // Read once the answer is complete, not word by word.
          accessibilityLabel={streaming ? undefined : t('help.assistantSaid', { text: plainText(message.content), time })}
        >
          {waitingForFirstWord ? <TypingDots /> : <HelpMarkdown text={message.content} />}
        </View>
        {(message.cards ?? []).map((card, index) => (
          <HelpDataCard key={`${card.type}-${index}`} card={card} />
        ))}
        {message.actions?.length ? <HelpActionButtons actions={message.actions} onAction={onAction} /> : null}
        {!streaming && lastInGroup ? (
          <View style={styles.footer}>
            <Text style={styles.time}>{time}</Text>
            <View style={styles.thumbs}>
              <Pressable
                onPress={() => rate('up')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('help.thumbsUp')}
                accessibilityState={{ selected: feedback === 'up' }}
              >
                <Ionicons name={feedback === 'up' ? 'thumbs-up' : 'thumbs-up-outline'} size={16} color={feedback === 'up' ? colors.accentPrimaryStrong : colors.textDisabled} />
              </Pressable>
              <Pressable
                onPress={() => rate('down')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={t('help.thumbsDown')}
                accessibilityState={{ selected: feedback === 'down' }}
              >
                <Ionicons name={feedback === 'down' ? 'thumbs-down' : 'thumbs-down-outline'} size={16} color={feedback === 'down' ? colors.accentPrimaryStrong : colors.textDisabled} />
              </Pressable>
            </View>
          </View>
        ) : null}
        {noteOpen && !noteSent ? (
          <View style={styles.noteRow}>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={t('help.whatWasMissing')}
              placeholderTextColor={colors.textSecondary}
              style={styles.noteInput}
              maxLength={500}
              accessibilityLabel={t('help.whatWasMissing')}
              returnKeyType="send"
              onSubmitEditing={() => {
                if (!note.trim()) return;
                onFeedback(message.id, 'down', note.trim());
                setNoteSent(true);
              }}
            />
          </View>
        ) : null}
        {noteSent ? <Text style={styles.thanks}>{t('help.thanksForFeedback')}</Text> : null}
      </View>
    </View>
  );
}

export default memo(HelpMessageRow);

const styles = StyleSheet.create({
  groupGap: {
    marginTop: spacing.x3,
  },
  userRow: {
    alignItems: 'flex-end',
    marginTop: spacing.x1,
  },
  userBubble: {
    maxWidth: '82%',
    paddingVertical: spacing.x2,
    paddingHorizontal: spacing.x3,
    borderRadius: radii.lg,
    borderBottomRightRadius: radii.sm,
    backgroundColor: colors.accentPrimary,
  },
  userText: {
    ...baseText.body,
    color: colors.white,
  },
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.x2,
    marginTop: spacing.x1,
  },
  avatarSlot: {
    width: 32,
  },
  assistantColumn: {
    flex: 1,
    maxWidth: '88%',
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.x2,
    paddingHorizontal: spacing.x3,
    borderRadius: radii.lg,
    borderTopLeftRadius: radii.sm,
    backgroundColor: colors.surfaceCardSolid,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    marginTop: spacing.x1,
  },
  thumbs: {
    flexDirection: 'row',
    gap: spacing.x3,
  },
  time: {
    ...baseText.caption,
    color: colors.textDisabled,
  },
  timeRight: {
    marginTop: spacing.x1,
  },
  noteRow: {
    marginTop: spacing.x2,
  },
  noteInput: {
    ...baseText.bodySmall,
    color: colors.textPrimary,
    paddingVertical: spacing.x2,
    paddingHorizontal: spacing.x3,
    borderRadius: radii.md,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCard,
  },
  thanks: {
    ...baseText.caption,
    color: colors.success,
    marginTop: spacing.x1,
  },
});
