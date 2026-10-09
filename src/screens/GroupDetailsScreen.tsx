import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Avatar from '../components/Avatar';
import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import Skeleton from '../components/Skeleton';
import { useLocationSharing } from '../hooks/useLocationSharing';
import { fetchMeetup, Meetup, MeetupMember } from '../services/findGroup';
import { memberSharingStatus } from '../services/locationSharingRules';
import { subscribeToRide } from '../services/matchOffer';
import { MyPassengerRequest } from '../services/passengerRequests';
import { baseText, borders, colors, overlays, radii, spacing } from '../theme/colors';

type Props = {
  request: MyPassengerRequest;
  onBack: () => void;
};

// How often the group is re-read on top of the live updates (a safety net for a missed one), and
// how often the clock-driven parts ("last seen", the window opening, the timeout) are refreshed.
const RECHECK_MS = 15_000;
const CLOCK_TICK_MS = 10_000;

// The passenger agreed to share their location with this group (our own explanation, shown before
// any system prompt). Remembered per group, on this phone only.
const consentKey = (groupId: string) => `findGroup.locationConsent.${groupId}`;

// "Find your group": the confirmed group's meetup. Members can share their live location with
// each other (and only each other) from the moment the first of them has landed. Not the same
// file as GroupDetailScreen.tsx, which is the admin-facing fare-split/confirm screen.
export default function GroupDetailsScreen({ request, onBack }: Props) {
  const { t } = useTranslation();

  const [meetup, setMeetup] = useState<Meetup | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [hasConsent, setHasConsent] = useState(false);
  const [showExplainer, setShowExplainer] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const load = useCallback(async () => {
    const { meetup: next, error } = await fetchMeetup(request.id);
    setIsLoading(false);
    if (error) {
      console.warn('fetchMeetup failed', error);
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    setMeetup(next);
  }, [request.id]);

  useEffect(() => {
    load();
    const unsubscribe = subscribeToRide('findgroup', request.id, request.group_id, load);
    const timer = setInterval(load, RECHECK_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [load, request.id, request.group_id]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const groupId = meetup?.groupId ?? null;
  useEffect(() => {
    if (!groupId) return;
    AsyncStorage.getItem(consentKey(groupId))
      .then((value) => setHasConsent(value === 'yes'))
      .catch(() => {});
  }, [groupId]);

  const windowOpen = meetup != null && now >= new Date(meetup.windowOpensAt).getTime();
  const timedOut = meetup != null && now >= new Date(meetup.sharingEndsAt).getTime();
  const rideStarted = meetup?.rideStartedAt != null;
  const active = meetup != null && windowOpen && !timedOut && !rideStarted;

  const sharing = useLocationSharing({
    groupId,
    myRequestId: request.id,
    active,
    inactiveReason: timedOut ? 'timeout' : 'group_ended',
  });

  const startSharing = async () => {
    setIsStarting(true);
    await sharing.start();
    setIsStarting(false);
  };

  const handleSharePress = () => {
    if (hasConsent) {
      startSharing();
    } else {
      setShowExplainer(true);
    }
  };

  const handleExplainerAccept = () => {
    setShowExplainer(false);
    setHasConsent(true);
    if (groupId) AsyncStorage.setItem(consentKey(groupId), 'yes').catch(() => {});
    startSharing();
  };

  const memberName = (member: MeetupMember) =>
    member.isMe ? t('matchFound.you') : (member.firstName ?? t('matchFound.traveler'));

  const memberStatus = (member: MeetupMember): { text: string; live: boolean } => {
    if (member.isMe) {
      if (!sharing.isSharing) return { text: t('findGroup.youNotSharing'), live: false };
      const accuracy = sharing.myFix?.accuracy;
      return {
        text:
          accuracy != null
            ? t('findGroup.youSharingAccuracy', { meters: Math.round(accuracy) })
            : t('findGroup.youSharing'),
        live: true,
      };
    }
    const position = sharing.positions[member.requestId];
    const status = memberSharingStatus(sharing.sharingIds.includes(member.requestId), position?.receivedAt ?? null, now);
    if (status.kind === 'sharing') return { text: t('findGroup.statusSharing'), live: true };
    if (status.kind === 'lastSeen') {
      return {
        text:
          status.minutesAgo < 1
            ? t('findGroup.statusLastSeenNow')
            : t('findGroup.statusLastSeen', { count: status.minutesAgo }),
        live: false,
      };
    }
    return { text: t('findGroup.statusNotSharing', { name: memberName(member) }), live: false };
  };

  const backButton = (
    <Pressable
      onPress={showExplainer ? () => setShowExplainer(false) : onBack}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      accessibilityRole="button"
      accessibilityLabel={t('admin.back')}
      style={styles.backButton}
    >
      <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
    </Pressable>
  );

  const accessNotice =
    sharing.access === 'denied'
      ? t('findGroup.accessDenied')
      : sharing.access === 'reduced'
        ? t('findGroup.accessReduced')
        : sharing.access === 'unavailable'
          ? t('findGroup.accessUnavailable')
          : null;

  return (
    <ScreenBackground
      source={require('../../assets/bg-content.png')}
      naturalWidth={317}
      naturalHeight={1536}
      scrimColor={overlays.scrimHeavy}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {backButton}

        {showExplainer ? (
          <View style={styles.explainer}>
            <View style={styles.explainerIcon}>
              <Ionicons name="location-outline" size={40} color={colors.accentPrimaryStrong} />
            </View>
            <Text style={styles.title}>{t('findGroup.explainerTitle')}</Text>
            <Text style={styles.explainerBody}>{t('location_share_explainer')}</Text>
            <View style={styles.buttonGap}>
              <PrimaryButton label={t('findGroup.shareButton')} onPress={handleExplainerAccept} />
            </View>
            <SecondaryButton label={t('findGroup.notNow')} onPress={() => setShowExplainer(false)} />
          </View>
        ) : (
          <>
            <Text style={styles.title}>{t('findGroup.title')}</Text>

            {loadFailed ? (
              <ErrorNotice message={t('findGroup.loadError')} onRetry={load} retryLabel={t('common.retry')} />
            ) : null}

            {isLoading ? (
              <Card accessible accessibilityLabel={t('admin.loading')}>
                <Skeleton width="60%" height={18} style={styles.skeletonGap} />
                <Skeleton width="90%" height={14} style={styles.skeletonGap} />
                <Skeleton width="80%" height={14} />
              </Card>
            ) : !meetup ? (
              <Text style={styles.subtitle}>{t('findGroup.noGroup')}</Text>
            ) : (
              <>
                <Text style={styles.subtitle}>
                  {rideStarted
                    ? t('findGroup.ended')
                    : timedOut
                      ? t('findGroup.timedOut')
                      : !windowOpen
                        ? t('findGroup.windowClosed', {
                            time: new Date(meetup.windowOpensAt).toLocaleTimeString([], { timeStyle: 'short' }),
                          })
                        : t('findGroup.subtitle')}
                </Text>

                <Card style={styles.card}>
                  <Text style={styles.cardLabel}>{t('findGroup.membersLabel')}</Text>
                  {meetup.members.map((member, index) => {
                    const status = memberStatus(member);
                    return (
                      <View key={member.requestId} style={styles.memberRow}>
                        <Avatar index={index} size={44} />
                        <View style={styles.memberText}>
                          <Text style={styles.memberName}>{memberName(member)}</Text>
                          <View style={styles.statusRow}>
                            <View style={[styles.statusDot, status.live && styles.statusDotLive]} />
                            <Text style={styles.memberStatus}>{status.text}</Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </Card>

                {active ? (
                  <>
                    {sharing.channelStatus === 'rejected' ? (
                      <Text style={styles.notice}>{t('findGroup.channelError')}</Text>
                    ) : null}

                    {sharing.isSharing ? (
                      <SecondaryButton label={t('findGroup.stopButton')} icon="close-circle-outline" onPress={sharing.stop} />
                    ) : (
                      <>
                        {accessNotice ? (
                          <Card style={styles.card}>
                            <Text style={styles.noticeText}>{accessNotice}</Text>
                            {sharing.access !== 'unavailable' ? (
                              <SecondaryButton
                                label={t('findGroup.openSettings')}
                                icon="settings-outline"
                                onPress={() => Linking.openSettings()}
                              />
                            ) : null}
                          </Card>
                        ) : null}
                        <PrimaryButton label={t('findGroup.shareButton')} onPress={handleSharePress} loading={isStarting} />
                        <Text style={styles.footnote}>{t('findGroup.shareFootnote')}</Text>
                      </>
                    )}
                  </>
                ) : null}
              </>
            )}
          </>
        )}
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingTop: spacing.x12,
    paddingHorizontal: spacing.x6,
    paddingBottom: spacing.x12,
  },
  backButton: {
    alignSelf: 'flex-start',
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: overlays.overlayWhite08,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.x6,
  },
  title: {
    ...baseText.h2,
    marginBottom: spacing.x2,
  },
  subtitle: {
    ...baseText.body,
    color: colors.textSecondary,
    marginBottom: spacing.x6,
  },
  skeletonGap: {
    marginBottom: spacing.x3,
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
  memberText: {
    flex: 1,
  },
  memberName: {
    ...baseText.body,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.textDisabled,
  },
  statusDotLive: {
    backgroundColor: colors.success,
  },
  memberStatus: {
    ...baseText.bodySmall,
    flex: 1,
  },
  notice: {
    ...baseText.bodySmall,
    color: colors.dangerStrong,
    marginBottom: spacing.x4,
  },
  noticeText: {
    ...baseText.bodySmall,
    color: colors.textPrimary,
    marginBottom: spacing.x3,
  },
  footnote: {
    ...baseText.caption,
    textAlign: 'center',
    marginTop: spacing.x3,
  },
  explainer: {
    alignItems: 'stretch',
  },
  explainerIcon: {
    alignSelf: 'center',
    width: 88,
    height: 88,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentPrimarySoft,
    marginBottom: spacing.x6,
  },
  explainerBody: {
    ...baseText.body,
    color: colors.textSecondary,
    marginBottom: spacing.x8,
  },
  buttonGap: {
    marginBottom: spacing.x3,
  },
});
