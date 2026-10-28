import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { HelpAction, HelpMessage, isConfirmCard } from '../services/helpChat';
import { plainText } from '../services/helpMarkdown';
import { useMyAvatarId } from '../services/myAvatar';
import { baseText, borders, colors, radii, spacing } from '../theme/colors';
import Avatar from './Avatar';
import HelpActionButtons from './HelpActionButtons';
import HelpAvatar from './HelpAvatar';
import HelpConfirmCard from './HelpConfirmCard';
import HelpDataCard from './HelpDataCard';
import HelpEmergencyCard from './HelpEmergencyCard';
import HelpMarkdown from './HelpMarkdown';
import TypingDots from './TypingDots';

type Props = {
  message: HelpMessage;
  // Consecutive messages from the same side are grouped: one avatar, one time.
  firstInGroup: boolean;
  lastInGroup: boolean;
  // The answer still being written: no time yet; dots until its first word.
  streaming?: boolean;
  onAction: (action: HelpAction) => void;
  // A tap on a confirmation card's button; absent where the conversation is only read.
  onDecide?: (actionId: string, decision: 'confirm' | 'keep') => Promise<void>;
};

// One message in the help chat: the assistant's on the left with the F glyph, the passenger's on the
// right in the accent colour, with their avatar. Under an answer: its cards and its buttons. ("Was this helpful?" is
// asked once, on the closing card - not under every answer.)
function HelpMessageRow({ message, firstInGroup, lastInGroup, streaming = false, onAction, onDecide }: Props) {
  const { t, i18n } = useTranslation();
  const isUser = message.role === 'user';
  const myAvatarId = useMyAvatarId();
  const time = new Date(message.created_at).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });

  if (isUser) {
    return (
      <View style={[styles.userRow, firstInGroup && styles.groupGap]}>
        <View style={styles.userColumn}>
          <View style={styles.userBubble} accessible accessibilityLabel={t('help.youSaid', { text: message.content, time })}>
            <Text style={styles.userText} selectable>
              {message.content}
            </Text>
          </View>
          {lastInGroup ? <Text style={[styles.time, styles.timeRight]}>{time}</Text> : null}
        </View>
        <View style={styles.avatarSlot}>{firstInGroup ? <Avatar avatarId={myAvatarId} size="small" /> : null}</View>
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
          isConfirmCard(card) ? (
            <HelpConfirmCard key={card.actionId} card={card} onDecide={onDecide} />
          ) : (
            <HelpDataCard key={`${card.type}-${index}`} card={card} />
          )
        ))}
        {message.actions?.length ? <HelpActionButtons actions={message.actions} onAction={onAction} /> : null}
        {!streaming && lastInGroup ? <Text style={[styles.time, styles.timeLeft]}>{time}</Text> : null}
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
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    gap: spacing.x2,
    marginTop: spacing.x1,
  },
  userColumn: {
    flexShrink: 1,
    maxWidth: '82%',
    alignItems: 'flex-end',
  },
  userBubble: {
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
  time: {
    ...baseText.caption,
    color: colors.textDisabled,
  },
  timeRight: {
    marginTop: spacing.x1,
  },
  timeLeft: {
    marginTop: spacing.x1,
  },
});
