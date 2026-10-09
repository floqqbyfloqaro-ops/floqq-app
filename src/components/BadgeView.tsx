import * as Brightness from 'expo-brightness';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { confirmFound, continueWithout, Meetup, MeetupMember, startRide } from '../services/findGroup';
import { baseText, colors, radii, spacing } from '../theme/colors';
import Avatar from './Avatar';
import Card from './Card';
import ErrorNotice from './ErrorNotice';
import GroupBadge from './GroupBadge';
import PrimaryButton from './PrimaryButton';
import SecondaryButton from './SecondaryButton';

type Props = {
  meetup: Meetup;
  myRequestId: string;
  // The screen's own clock (ms), so "the wait is over" appears without a reload.
  now: number;
  // Something changed on the server (a confirmation, a member left behind, the ride started).
  onChanged: () => void;
};

// "Keep waiting" hides the choice for this long before it is offered again.
const KEEP_WAITING_MS = 5 * 60_000;

type Step = 'idle' | 'confirmContinue' | 'confirmTaxi';

// The last few metres: the group's badge, held up on the phone so its members recognise each
// other, and "I've found my group". The group is found once EVERY member has confirmed; a member
// who never shows up can be left behind by the others after a wait, as long as two passengers
// remain. Needs no location at all.
export default function BadgeView({ meetup, myRequestId, now, onChanged }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('idle');
  const [keepWaitingUntil, setKeepWaitingUntil] = useState(0);

  // As bright as the screen goes while the badge is shown, and back to what it was afterwards.
  useEffect(() => {
    let previous: number | null = null;
    let cancelled = false;
    (async () => {
      try {
        previous = await Brightness.getBrightnessAsync();
        if (!cancelled) await Brightness.setBrightnessAsync(1);
      } catch {
        // No brightness control (e.g. on the web): the badge is simply shown as it is.
      }
    })();
    return () => {
      cancelled = true;
      (async () => {
        try {
          if (Platform.OS === 'android') await Brightness.restoreSystemBrightnessAsync();
          else if (previous != null) await Brightness.setBrightnessAsync(previous);
        } catch {
          // Nothing to restore.
        }
      })();
    };
  }, []);

  const me = meetup.members.find((member) => member.isMe);
  const iConfirmed = me?.foundAt != null;
  const groupFound = meetup.meetupCompletedAt != null;
  const rideStarted = meetup.rideStartedAt != null;
  const missing = meetup.members.filter((member) => member.foundAt == null);
  const waitOver = meetup.continueWithoutFrom != null && now >= new Date(meetup.continueWithoutFrom).getTime();
  // Offered to the members who are there, about the one(s) who aren't.
  const showNoShowChoice = !groupFound && iConfirmed && waitOver && missing.length > 0 && now >= keepWaitingUntil;
  const canContinueWithout = meetup.members.length - missing.length >= 2;

  const nameOf = (member: MeetupMember) => (member.isMe ? t('matchFound.you') : (member.firstName ?? t('matchFound.traveler')));
  const missingNames = missing.map(nameOf).join(', ');

  const run = async (action: () => Promise<{ ok: boolean; error: string | null }>, failureKey: string) => {
    setErrorMessage(null);
    setBusy(true);
    const result = await action();
    setBusy(false);
    setStep('idle');
    if (!result.ok) {
      console.warn('meetup action failed', result.error);
      setErrorMessage(t(result.error === 'too_few_remaining' ? 'badge.continueTooFew' : failureKey));
    }
    onChanged();
  };

  const handleContinueWithout = () =>
    run(async () => {
      for (const member of missing) {
        const result = await continueWithout(myRequestId, member.requestId);
        if (!result.ok) return result;
      }
      return { ok: true, error: null };
    }, 'badge.continueError');

  return (
    <View>
      {meetup.badge ? (
        <View style={styles.badgeStage}>
          <GroupBadge color={meetup.badge.color} number={meetup.badge.number} pulsing />
        </View>
      ) : (
        <Text style={styles.pending}>{t('badge.pending')}</Text>
      )}
      <Text style={styles.holdUp}>{t('badge_hold_up')}</Text>

      {errorMessage ? <ErrorNotice message={errorMessage} /> : null}

      <Card style={styles.card}>
        <Text style={styles.cardLabel}>{t('badge.membersLabel')}</Text>
        {meetup.members.map((member, index) => (
          <View key={member.requestId} style={styles.memberRow}>
            <Avatar index={index} size={40} />
            <Text style={styles.memberName}>{nameOf(member)}</Text>
            <Text style={[styles.memberStatus, member.foundAt != null && styles.memberStatusFound]}>
              {t(member.foundAt != null ? 'badge.memberFound' : 'badge.memberNotYet')}
            </Text>
          </View>
        ))}
      </Card>

      {rideStarted ? (
        <Text style={styles.note}>{t('findGroup.ended')}</Text>
      ) : groupFound ? (
        <Card style={styles.card} highlighted>
          <Text style={styles.foundTitle}>{t('badge.groupFoundTitle')}</Text>
          <Text style={styles.note}>{t('badge.groupFoundBody')}</Text>
          {step === 'confirmTaxi' ? (
            <>
              <Text style={styles.question}>{t('badge.taxiConfirmQuestion')}</Text>
              <View style={styles.buttonGap}>
                <PrimaryButton
                  label={t('badge.taxiConfirmYes')}
                  onPress={() => run(() => startRide(myRequestId), 'badge.taxiError')}
                  loading={busy}
                />
              </View>
              <SecondaryButton label={t('badge.taxiConfirmNo')} onPress={() => setStep('idle')} disabled={busy} />
            </>
          ) : (
            <PrimaryButton label={t('badge.inTheTaxi')} onPress={() => setStep('confirmTaxi')} />
          )}
        </Card>
      ) : !iConfirmed ? (
        <PrimaryButton
          label={t('found_my_group')}
          onPress={() => run(() => confirmFound(myRequestId), 'badge.foundError')}
          loading={busy}
        />
      ) : showNoShowChoice ? (
        <Card style={styles.card}>
          <Text style={styles.foundTitle}>{t('badge.noShowTitle', { names: missingNames })}</Text>
          {step === 'confirmContinue' ? (
            <>
              <Text style={styles.question}>{t('badge.continueConfirmQuestion', { names: missingNames })}</Text>
              <View style={styles.buttonGap}>
                <PrimaryButton
                  label={t('badge.continueConfirmYes', { names: missingNames })}
                  onPress={handleContinueWithout}
                  loading={busy}
                />
              </View>
              <SecondaryButton label={t('badge.keepWaiting')} onPress={() => setStep('idle')} disabled={busy} />
            </>
          ) : (
            <>
              <Text style={styles.note}>{t(canContinueWithout ? 'badge.noShowBody' : 'badge.continueTooFew')}</Text>
              <View style={styles.buttonGap}>
                <SecondaryButton
                  label={t('badge.keepWaiting')}
                  icon="time-outline"
                  onPress={() => setKeepWaitingUntil(now + KEEP_WAITING_MS)}
                />
              </View>
              {canContinueWithout ? (
                <SecondaryButton
                  label={t('badge.continueWithout', { names: missingNames })}
                  icon="arrow-forward-outline"
                  onPress={() => setStep('confirmContinue')}
                />
              ) : null}
            </>
          )}
        </Card>
      ) : (
        <Text style={styles.note}>{t('badge.waitingForOthers')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  badgeStage: {
    alignItems: 'center',
    marginTop: spacing.x4,
    marginBottom: spacing.x6,
  },
  pending: {
    ...baseText.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginVertical: spacing.x8,
  },
  holdUp: {
    ...baseText.h3,
    textAlign: 'center',
    marginBottom: spacing.x6,
  },
  card: {
    marginBottom: spacing.x4,
  },
  cardLabel: {
    ...baseText.label,
    marginBottom: spacing.x3,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    marginBottom: spacing.x3,
  },
  memberName: {
    ...baseText.body,
    fontWeight: '600',
    flex: 1,
  },
  memberStatus: {
    ...baseText.bodySmall,
    paddingHorizontal: spacing.x3,
    paddingVertical: spacing.x1,
    borderRadius: radii.pill,
  },
  memberStatusFound: {
    color: colors.success,
    backgroundColor: colors.successSoft,
  },
  foundTitle: {
    ...baseText.h3,
    marginBottom: spacing.x2,
  },
  note: {
    ...baseText.body,
    color: colors.textSecondary,
    marginBottom: spacing.x4,
  },
  question: {
    ...baseText.body,
    fontWeight: '600',
    marginBottom: spacing.x3,
  },
  buttonGap: {
    marginBottom: spacing.x3,
  },
});
