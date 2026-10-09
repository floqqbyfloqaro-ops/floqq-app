import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Avatar from '../components/Avatar';
import BadgeView from '../components/BadgeView';
import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import GuidancePanel, { guidanceFace, guidanceShowsPhoto } from '../components/GuidancePanel';
import MeetingPointCard from '../components/MeetingPointCard';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import Skeleton from '../components/Skeleton';
import { useGuidance } from '../hooks/useGuidance';
import { useLocationSharing } from '../hooks/useLocationSharing';
import { useOwnLocation } from '../hooks/useOwnLocation';
import { fetchMeetup, markArrived, Meetup, MeetupMember, undoArrival } from '../services/findGroup';
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

// Remembered per group, on this phone only: the passenger agreed to share their location with
// this group (our own explanation, shown before any system prompt), and their badge was already
// opened for them once when they arrived.
const consentKey = (groupId: string) => `findGroup.locationConsent.${groupId}`;
const badgeOpenedKey = (groupId: string) => `findGroup.badgeOpened.${groupId}`;

// The screen stays on while the passenger is being guided: they are walking with a suitcase.
function KeepScreenAwake() {
  useKeepAwake();
  return null;
}

// "Find your group": the confirmed group's meetup at the airport. Three things, each on its own:
//   - Guidance: an arrow and distance to the group's fixed meeting point, from the passenger's
//     own position - used on the phone only, never sent anywhere, and shown whenever the app may
//     use the location.
//   - Sharing: a separate opt-in. The passenger's position then also goes to the other members
//     (and only them), which is what "sharing / last seen" in the members list comes from.
//   - The badge and "I'm at the meeting point": need no location at all, so nothing ever blocks
//     the meetup.
// Not the same file as GroupDetailScreen.tsx, which is the admin-facing fare-split/confirm screen.
export default function GroupDetailsScreen({ request, onBack }: Props) {
  const { t } = useTranslation();

  const [meetup, setMeetup] = useState<Meetup | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [hasConsent, setHasConsent] = useState(false);
  const [showExplainer, setShowExplainer] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [showBadge, setShowBadge] = useState(false);
  const [isArrivalBusy, setIsArrivalBusy] = useState(false);
  const [arrivalError, setArrivalError] = useState<string | null>(null);
  // After an "Undo" the phone no longer marks the passenger as arrived by itself for the rest of
  // this visit to the screen - it would only do it again a moment later.
  const [autoArrivalOff, setAutoArrivalOff] = useState(false);

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
  // Every member confirmed "I've found my group": the meetup is done, and with it the sharing.
  const groupFound = meetup?.meetupCompletedAt != null;
  // The meetup is on: someone has landed, and the ride hasn't started.
  const meetupRunning = meetup != null && windowOpen && !timedOut && !rideStarted;
  const sharingAllowed = meetupRunning && !groupFound;

  const me = meetup?.members.find((member) => member.isMe) ?? null;
  const arrived = me?.arrivedAt != null;

  const point = meetup?.meetingPoint ?? null;
  const target = point?.latitude != null && point.longitude != null ? { lat: point.latitude, lng: point.longitude } : null;

  // Guidance: the phone's own position, read whenever there is a meeting point to walk to.
  const ownLocation = useOwnLocation(meetup != null && !rideStarted && !timedOut);
  const hasLocation = ownLocation.access === 'granted';

  const handleArrival = useCallback(
    async (source: 'MANUAL' | 'AUTO') => {
      setArrivalError(null);
      setIsArrivalBusy(true);
      const result = await markArrived(request.id, source);
      setIsArrivalBusy(false);
      if (!result.ok) {
        console.warn('markArrived failed', result.error);
        // A missed detection is nothing the passenger asked for: only their own tap reports back.
        if (source === 'MANUAL') setArrivalError(t('guidance.arrivalError'));
        return;
      }
      await load();
    },
    [load, request.id, t]
  );

  const guidance = useGuidance({
    fix: ownLocation.fix,
    target,
    autoArrival: meetupRunning && !arrived && !autoArrivalOff,
    onAutoArrive: () => handleArrival('AUTO'),
  });

  const handleUndoArrival = async () => {
    setArrivalError(null);
    setAutoArrivalOff(true);
    setIsArrivalBusy(true);
    const result = await undoArrival(request.id);
    setIsArrivalBusy(false);
    if (!result.ok) {
      console.warn('undoArrival failed', result.error);
      setArrivalError(t('guidance.arrivalError'));
      return;
    }
    await load();
  };

  // The badge opens by itself once per ride, the moment the passenger is at the meeting point -
  // that is when it is needed. After that it is behind its button.
  useEffect(() => {
    if (!arrived || !groupId || rideStarted) return;
    let cancelled = false;
    AsyncStorage.getItem(badgeOpenedKey(groupId))
      .then((value) => {
        if (cancelled || value === 'yes') return;
        AsyncStorage.setItem(badgeOpenedKey(groupId), 'yes').catch(() => {});
        setShowBadge(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [arrived, groupId, rideStarted]);

  // Sharing with the group: a separate opt-in on top of the guidance.
  const sharing = useLocationSharing({
    groupId,
    myRequestId: request.id,
    active: sharingAllowed,
    inactiveReason: timedOut ? 'timeout' : 'group_ended',
    fix: ownLocation.fix,
    hasLocation,
  });

  const startSharing = async () => {
    setIsStarting(true);
    // Sharing needs the location too: ask now if the system prompt was never answered.
    const access = hasLocation ? 'granted' : await ownLocation.request();
    setIsStarting(false);
    if (access === 'granted') sharing.start();
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

  // One status per member: at the meeting point (their own word for it, or their phone's) wins
  // over what their location sharing says.
  const memberStatus = (member: MeetupMember): { text: string; live: boolean } => {
    if (member.arrivedAt != null) return { text: t('guidance.memberArrived'), live: true };
    if (member.isMe) {
      if (!sharing.isSharing) return { text: t('findGroup.youNotSharing'), live: false };
      const accuracy = ownLocation.fix?.accuracy;
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
      onPress={showExplainer ? () => setShowExplainer(false) : showBadge ? () => setShowBadge(false) : onBack}
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      accessibilityRole="button"
      accessibilityLabel={t('admin.back')}
      style={styles.backButton}
    >
      <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
    </Pressable>
  );

  const accessNotice =
    ownLocation.access === 'denied'
      ? t('findGroup.accessDenied')
      : ownLocation.access === 'reduced'
        ? t('findGroup.accessReduced')
        : ownLocation.access === 'unavailable'
          ? t('findGroup.accessUnavailable')
          : null;

  // The arrow and its states: only with a meeting point to walk to and a location to walk from.
  const showGuidance = meetup != null && point != null && target != null && hasLocation && !rideStarted && !timedOut;
  const face = guidanceFace(guidance, arrived);

  return (
    <ScreenBackground
      source={require('../../assets/bg-content.png')}
      naturalWidth={317}
      naturalHeight={1536}
      scrimColor={overlays.scrimHeavy}
    >
      {showGuidance ? <KeepScreenAwake /> : null}
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
        ) : showBadge && meetup ? (
          // Shown in place of the rest, not as another screen: leaving this screen would stop the
          // guidance and the sharing that may be running underneath.
          <>
            <Text style={styles.title}>{t('badge.title')}</Text>
            <BadgeView meetup={meetup} myRequestId={request.id} now={now} onChanged={load} />
          </>
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
                    : groupFound
                      ? t('findGroup.groupFound')
                      : timedOut
                        ? t('findGroup.timedOut')
                        : !windowOpen
                          ? t('findGroup.windowClosed', {
                              time: new Date(meetup.windowOpensAt).toLocaleTimeString([], { timeStyle: 'short' }),
                            })
                          : t('findGroup.subtitle')}
                </Text>

                {showGuidance && point ? (
                  <GuidancePanel point={point} guidance={guidance} arrived={arrived} onShowBadge={() => setShowBadge(true)} />
                ) : null}

                {/* The primary arrival signal: one tap, whatever the GPS says - and without any
                    location permission at all. */}
                {meetupRunning ? (
                  <View style={styles.arrival}>
                    {arrived ? (
                      <View style={styles.arrivedRow}>
                        <Text style={styles.arrivedText}>{t('guidance.atMeetingPointDone')}</Text>
                        <Pressable
                          onPress={handleUndoArrival}
                          disabled={isArrivalBusy}
                          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                          accessibilityRole="button"
                          accessibilityLabel={t('guidance.undo')}
                        >
                          <Text style={styles.undoText}>{t('guidance.undo')}</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <PrimaryButton
                        label={t('guidance.atMeetingPoint')}
                        onPress={() => handleArrival('MANUAL')}
                        loading={isArrivalBusy}
                      />
                    )}
                    {arrivalError ? <Text style={styles.notice}>{arrivalError}</Text> : null}
                  </View>
                ) : null}

                {/* Always there, whatever the GPS or the permissions say: the badge needs neither. */}
                {!rideStarted ? (
                  <View style={styles.badgeButton}>
                    <SecondaryButton label={t('badge.showButton')} icon="shapes-outline" onPress={() => setShowBadge(true)} />
                  </View>
                ) : null}

                <MeetingPointCard
                  terminal={meetup.terminal}
                  point={meetup.meetingPoint}
                  meetingTime={meetup.meetingTime}
                  hidePhoto={showGuidance && guidanceShowsPhoto(face)}
                />

                {/* No location yet: offer the arrow, or say why there is none. Nothing here is
                    needed to meet - the card above and the badge are enough. */}
                {target != null && !rideStarted && !timedOut && !hasLocation ? (
                  ownLocation.access === 'undetermined' ? (
                    <Card style={styles.card}>
                      <Text style={styles.noticeText}>{t('guidance.locationStaysLocal')}</Text>
                      <SecondaryButton
                        label={t('guidance.useLocation')}
                        icon="navigate-outline"
                        onPress={() => ownLocation.request()}
                      />
                    </Card>
                  ) : accessNotice ? (
                    <Card style={styles.card}>
                      <Text style={styles.noticeText}>{accessNotice}</Text>
                      {ownLocation.access !== 'unavailable' ? (
                        <SecondaryButton
                          label={t('findGroup.openSettings')}
                          icon="settings-outline"
                          onPress={() => Linking.openSettings()}
                        />
                      ) : null}
                    </Card>
                  ) : null
                ) : null}

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

                {sharingAllowed ? (
                  <>
                    {sharing.channelStatus === 'rejected' ? (
                      <Text style={styles.notice}>{t('findGroup.channelError')}</Text>
                    ) : null}

                    {sharing.isSharing ? (
                      <SecondaryButton label={t('findGroup.stopButton')} icon="close-circle-outline" onPress={sharing.stop} />
                    ) : (
                      <>
                        <SecondaryButton
                          label={t('findGroup.shareButton')}
                          icon="people-outline"
                          onPress={handleSharePress}
                          loading={isStarting}
                        />
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
  arrival: {
    marginBottom: spacing.x4,
  },
  arrivedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.x3,
    minHeight: 52,
    paddingHorizontal: spacing.x4,
    borderRadius: radii.md,
    borderWidth: borders.regular,
    borderColor: colors.success,
    backgroundColor: colors.successSoft,
  },
  arrivedText: {
    ...baseText.body,
    color: colors.success,
    fontWeight: '700',
    flex: 1,
  },
  undoText: {
    ...baseText.bodySmall,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
  badgeButton: {
    marginBottom: spacing.x4,
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
    marginTop: spacing.x3,
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
