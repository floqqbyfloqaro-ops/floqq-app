import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Avatar from '../components/Avatar';
import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import RouteMap from '../components/RouteMap';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import Skeleton from '../components/Skeleton';
import { PLATFORM_FEE_CENTS } from '../constants';
import { authenticateHold, CARD_SETUP_SUPPORTED, stripeReturnUrl } from '../services/cardSetup';
import {
  declineMatch,
  decodePolyline,
  fetchMatchOffer,
  MatchOffer,
  MatchOfferMember,
  secureSpot,
  subscribeToRide,
} from '../services/matchOffer';
import type { MyPassengerRequest } from '../services/passengerRequests';
import { formatCents, placeRideHold } from '../services/payments';
import { baseText, borders, colors, overlays, radii, spacing } from '../theme/colors';

type Props = {
  request: MyPassengerRequest;
  onBack: () => void;
  onEdit: () => void;
  onOpenProfile: () => void;
  // The passenger left the group ("Not for me"): their ride is searching again.
  onLeft: () => void;
};

const MAP_HEIGHT = 180;
const AVATAR_SIZE = 44;

// Other passengers' rides can't be watched from the app (row level security), so the screen also
// re-reads the offer on a timer to pick up e.g. someone else securing their spot.
const REFRESH_MS = 20_000;

// After the passenger's part of securing is done, wait this long for Stripe's webhook to reach
// the server (the bank's verification finishes there, not in the app).
const RESULT_POLL_ATTEMPTS = 8;
const RESULT_POLL_INTERVAL_MS = 1500;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const dateTime = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// A flight landing this much after its scheduled time counts as delayed.
const DELAYED_FROM_MINUTES = 10;

const clockTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// What the right-hand side of a passenger row says, from flight data when there is any.
function arrivalStatus(member: MatchOfferMember, t: (key: string, options?: Record<string, unknown>) => string) {
  const arrivalMs = new Date(member.arrivalAt).getTime();
  if (arrivalMs <= Date.now()) {
    return { label: t('matchFound.landed', { time: clockTime(member.arrivalAt) }), delayed: false };
  }
  if (member.arrivalFromFlight && member.scheduledArrivalAt) {
    const delayMinutes = Math.round((arrivalMs - new Date(member.scheduledArrivalAt).getTime()) / 60000);
    return delayMinutes >= DELAYED_FROM_MINUTES
      ? { label: t('matchFound.delayed', { minutes: delayMinutes }), delayed: true }
      : { label: t('matchFound.onTime'), delayed: false };
  }
  return { label: t('matchFound.lands', { time: clockTime(member.arrivalAt) }), delayed: false };
}

// Time left to answer the offer, ticking by itself so the rest of the screen (the map) doesn't
// redraw every second.
function OfferCountdown({ expiresAt }: { expiresAt: string }) {
  const { t } = useTranslation();
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const secondsLeft = Math.max(0, Math.round((new Date(expiresAt).getTime() - nowMs) / 1000));
  const time = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  return (
    <View style={styles.countdown} accessible accessibilityRole="timer">
      <Ionicons name="time-outline" size={16} color={colors.warning} />
      <Text style={styles.countdownText}>
        {secondsLeft > 0 ? t('matchFound.respondWithin', { time }) : t('matchFound.timeUp')}
      </Text>
    </View>
  );
}

// The passenger's group: who they ride with, the planned route and the estimated fare. While the
// group is still an offer (an unconfirmed taxi group) it also takes their answer - "Secure my
// spot" or "Not for me" - within the response window. Once the group is confirmed the same
// screen stays up, read-only. MyRideScreen decides when it is shown and leaves it when the group
// is gone.
export default function MatchFoundScreen({ request, onBack, onEdit, onOpenProfile, onLeft }: Props) {
  const { t } = useTranslation();

  const [offer, setOffer] = useState<MatchOffer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [isSecuring, setIsSecuring] = useState(false);
  // A second tap before the first one's state update lands must not start a second attempt.
  const securingRef = useRef(false);
  const [secureError, setSecureError] = useState<string | null>(null);
  const [secureNotice, setSecureNotice] = useState<string | null>(null);
  const [needsCard, setNeedsCard] = useState(false);
  const [cardFailed, setCardFailed] = useState(false);

  // "Not for me" asks for confirmation inline (a multi-button Alert does nothing on the web).
  const [isDeclineOpen, setIsDeclineOpen] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);

  // Set when the group grew or shrank while the passenger was looking at it.
  const [groupChange, setGroupChange] = useState<'joined' | 'left' | null>(null);
  const knownGroup = useRef<{ groupId: string; size: number } | null>(null);

  const load = useCallback(async () => {
    const { offer: loaded, error } = await fetchMatchOffer(request.id);
    setIsLoading(false);
    if (error) {
      console.warn('fetchMatchOffer failed', error);
      setLoadFailed(true);
      return null;
    }
    setLoadFailed(false);
    // A group that just disappeared: keep what's on screen until MyRideScreen moves on.
    if (loaded) {
      const known = knownGroup.current;
      if (known && known.groupId === loaded.groupId && known.size !== loaded.members.length) {
        setGroupChange(loaded.members.length > known.size ? 'joined' : 'left');
      }
      knownGroup.current = { groupId: loaded.groupId, size: loaded.members.length };
      setOffer(loaded);
    }
    return loaded;
  }, [request.id]);

  // "Secure my spot". With payments off (or a ride too far away for a card hold) the server just
  // records it. Otherwise the reservation is placed on the saved card; whether that worked is
  // always read back from the server, never assumed here.
  const handleSecure = async () => {
    if (securingRef.current) return;
    securingRef.current = true;
    setSecureError(null);
    setSecureNotice(null);
    setNeedsCard(false);
    setCardFailed(false);
    setIsSecuring(true);

    try {
      const { result, error } = await secureSpot(request.id);
      if (error || !result?.status) {
        if (result?.error === 'no_offer') {
          await load();
          return;
        }
        console.warn('secureSpot failed', error);
        setSecureError(t('matchFound.secureError'));
        return;
      }

      if (result.status !== 'HOLD_REQUIRED' || !result.ridePaymentId) {
        await load();
        return;
      }

      const hold = await placeRideHold(result.ridePaymentId, stripeReturnUrl());
      if (hold.error) {
        if (hold.result?.error === 'no_payment_method') {
          setNeedsCard(true);
        } else {
          console.warn('placeRideHold failed', hold.error);
          setSecureError(t('matchFound.secureError'));
        }
        return;
      }

      if (hold.result?.status === 'HOLD_PENDING_AUTH' && hold.result.clientSecret && hold.result.publishableKey) {
        if (!CARD_SETUP_SUPPORTED) {
          setSecureNotice(t('payments.webAuth'));
          return;
        }
        setSecureNotice(t('payments.pendingAuth'));
        const auth = await authenticateHold(hold.result.clientSecret, hold.result.publishableKey);
        if (auth.status === 'failed') {
          console.warn('authenticateHold failed', auth.message);
        }
      }

      let failed = hold.result?.status === 'HOLD_FAILED';
      for (let attempt = 0; attempt < RESULT_POLL_ATTEMPTS && !failed; attempt += 1) {
        const latest = await load();
        if (latest?.members.find((m) => m.isMe)?.secured) break;
        failed = latest?.myHoldStatus === 'HOLD_FAILED';
        if (!failed) await wait(RESULT_POLL_INTERVAL_MS);
      }
      setSecureNotice(null);
      if (failed) {
        setCardFailed(true);
        setSecureError(t('payments.failed'));
        await load();
      }
    } finally {
      securingRef.current = false;
      setIsSecuring(false);
    }
  };

  useEffect(() => {
    load();
    const unsubscribe = subscribeToRide('offer', request.id, request.group_id, load);
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [load, request.id, request.group_id]);

  // "You" first; everyone else in drop-off order.
  const members = useMemo(
    () => (offer ? [...offer.members.filter((m) => m.isMe), ...offer.members.filter((m) => !m.isMe)] : []),
    [offer]
  );

  const map = useMemo(() => {
    if (!offer?.polyline) return null;
    const stops = offer.members
      .filter((m) => m.lat != null && m.lng != null)
      .map((m) => ({ latitude: m.lat!, longitude: m.lng!, isMe: m.isMe }));
    if (stops.length !== offer.members.length) return null;
    return {
      route: decodePolyline(offer.polyline),
      pickup: { latitude: offer.airport.lat, longitude: offer.airport.lng },
      stops,
    };
  }, [offer]);

  const handleDecline = async () => {
    setDeclineError(null);
    setIsDeclining(true);
    const { error } = await declineMatch(request.id);
    setIsDeclining(false);

    if (error === 'not_offered') {
      // Confirmed in the meantime: show it as it is now.
      setIsDeclineOpen(false);
      await load();
      return;
    }
    if (error) {
      console.warn('declineMatch failed', error);
      setDeclineError(t('matchFound.declineError'));
      return;
    }
    onLeft();
  };

  const isConfirmed = offer?.groupStatus === 'confirmed';
  const mySpotSecured = members[0]?.isMe === true && members[0].secured;

  // A card hold can only be placed close enough to the ride; before that, securing reserves nothing.
  const holdComesLater = offer != null && new Date(offer.holdOpensAt).getTime() > Date.now();

  return (
    <ScreenBackground
      source={require('../../assets/bg-content.png')}
      naturalWidth={317}
      naturalHeight={1536}
      scrimColor={overlays.scrimHeavy}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Pressable
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('admin.back')}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>

        <View style={styles.titleRow}>
          <Text style={styles.title}>{t(isConfirmed ? 'matchFound.confirmedTitle' : 'match_found_title')}</Text>
          <Ionicons
            name={isConfirmed ? 'checkmark-circle' : 'sparkles'}
            size={24}
            color={isConfirmed ? colors.success : colors.accentGold}
          />
        </View>
        <Text style={styles.subtitle}>{t('match_found_subtitle')}</Text>

        {loadFailed && !offer ? (
          <ErrorNotice message={t('matchFound.loadError')} onRetry={load} retryLabel={t('common.retry')} />
        ) : null}

        {isLoading || !offer ? (
          loadFailed ? null : (
            <View accessible accessibilityLabel={t('admin.loading')} style={styles.loading}>
              <Skeleton height={MAP_HEIGHT} radius={radii.md} />
              <Skeleton height={AVATAR_SIZE} />
              <Skeleton height={AVATAR_SIZE} />
              <Skeleton width="60%" height={28} />
            </View>
          )
        ) : (
          <>
            {/* No match percentage: the matching engine's score is a cost, not a percentage. */}
            <Text style={styles.summary}>{t('matchFound.passengers', { count: offer.members.length })}</Text>

            {groupChange ? (
              <Text style={styles.groupChange} accessibilityLiveRegion="polite">
                {t(groupChange === 'joined' ? 'matchFound.memberJoined' : 'group_member_left')}
              </Text>
            ) : null}

            {!isConfirmed && !mySpotSecured && offer.offerExpiresAt ? (
              <OfferCountdown expiresAt={offer.offerExpiresAt} />
            ) : null}

            <Card style={styles.mapCard}>
              {map ? (
                <RouteMap route={map.route} pickup={map.pickup} stops={map.stops} height={MAP_HEIGHT} />
              ) : (
                <Skeleton height={MAP_HEIGHT} radius={radii.md} />
              )}
            </Card>

            <Card style={styles.listCard}>
              {members.map((member, index) => {
                const status = arrivalStatus(member, t);
                const name = member.isMe ? t('matchFound.you') : member.firstName ?? t('matchFound.traveler');
                const destination = member.destination ?? t('matchFound.destinationHidden');
                return (
                  <View
                    key={member.order}
                    style={[styles.memberRow, index > 0 && styles.memberRowDivider]}
                    accessible
                    accessibilityLabel={`${name}, ${destination}, ${status.label}`}
                  >
                    <Avatar index={member.order - 1} size={AVATAR_SIZE} />
                    <View style={styles.memberText}>
                      <View style={styles.memberNameRow}>
                        <Text style={styles.memberName}>{name}</Text>
                        {member.secured ? <Ionicons name="checkmark-circle" size={16} color={colors.success} /> : null}
                      </View>
                      <Text style={styles.memberDestination} numberOfLines={2}>
                        {destination}
                      </Text>
                    </View>
                    <Text style={[styles.memberStatus, status.delayed && styles.memberStatusDelayed]}>{status.label}</Text>
                  </View>
                );
              })}
            </Card>

            <Card style={styles.fareCard}>
              <View style={styles.fareRow}>
                <View style={styles.fareColumn}>
                  <Text style={styles.fareLabel}>{t('matchFound.totalFareLabel')}</Text>
                  <Text style={styles.fareValue}>
                    {offer.totalFareCents != null ? `€${formatCents(offer.totalFareCents)}` : t('matchFound.fareUnknown')}
                  </Text>
                </View>
                <View style={[styles.fareColumn, styles.fareColumnEnd]}>
                  <Text style={styles.fareLabel}>{t('matchFound.yourShareLabel')}</Text>
                  <Text style={styles.fareValue}>
                    {offer.myShareCents != null ? `€${formatCents(offer.myShareCents)}` : t('matchFound.fareUnknown')}
                  </Text>
                </View>
              </View>
              <Text style={styles.fareNote}>{t('fare_estimate_note')}</Text>
            </Card>

            {isConfirmed ? (
              <Card highlighted style={styles.securedCard}>
                <Text style={styles.securedNote}>{t('matchFound.confirmedNote')}</Text>
              </Card>
            ) : mySpotSecured ? (
              <Card highlighted style={styles.securedCard}>
                <View style={styles.securedTitleRow}>
                  <Ionicons name="checkmark-circle" size={22} color={colors.success} />
                  <Text style={styles.securedTitle} accessibilityLiveRegion="polite">
                    {t('matchFound.spotSecured')}
                  </Text>
                </View>
                {offer.myHoldStatus === 'HOLD_PLACED' && offer.holdCents != null ? (
                  <Text style={styles.securedNote}>{t('hold_placed_message', { amount: formatCents(offer.holdCents) })}</Text>
                ) : offer.paymentsEnabled && offer.holdCents != null && holdComesLater ? (
                  <Text style={styles.securedNote}>
                    {t('payments.opensOn', { amount: formatCents(offer.holdCents), date: dateTime(offer.holdOpensAt) })}
                  </Text>
                ) : null}
                {members.slice(1).map((member) => (
                  <Text key={member.order} style={styles.securedNote}>
                    {t(member.secured ? 'matchFound.otherSecured' : 'matchFound.waitingFor', {
                      name: member.firstName ?? t('matchFound.traveler'),
                    })}
                  </Text>
                ))}
                {offer.offerExpiresAt && members.slice(1).some((member) => !member.secured) ? (
                  <Text style={styles.securedNote}>
                    {t('matchFound.othersDeadline', { time: clockTime(offer.offerExpiresAt) })}
                  </Text>
                ) : null}
              </Card>
            ) : (
              <>
                {/* What securing does to the card, shown before the passenger taps. */}
                {offer.paymentsEnabled && offer.holdCents != null && offer.myShareCents != null ? (
                  <Text style={styles.reserveNote}>
                    {holdComesLater
                      ? t('payments.opensOn', { amount: formatCents(offer.holdCents), date: dateTime(offer.holdOpensAt) })
                      : t('payments.reserveExplainer', {
                          amount: formatCents(offer.holdCents),
                          share: formatCents(offer.myShareCents),
                          fee: formatCents(offer.feeCents),
                        })}
                  </Text>
                ) : null}

                {secureError ? <ErrorNotice message={secureError} /> : null}
                {secureNotice ? (
                  <Text style={styles.reserveNote} accessibilityLiveRegion="polite">
                    {secureNotice}
                  </Text>
                ) : null}
                {needsCard ? <Text style={styles.reserveNote}>{t('payments.noCard')}</Text> : null}

                <View style={styles.secureButtons}>
                  {needsCard ? (
                    <SecondaryButton label={t('payments.addCardButton')} onPress={onOpenProfile} />
                  ) : (
                    <PrimaryButton
                      label={offer.myHoldStatus === 'HOLD_PENDING_AUTH' ? t('payments.continueAuth') : t('secure_my_spot')}
                      onPress={handleSecure}
                      loading={isSecuring}
                    />
                  )}
                  {cardFailed ? (
                    <SecondaryButton label={t('profile.replaceCard')} onPress={onOpenProfile} disabled={isSecuring} />
                  ) : null}
                </View>
                <Text style={styles.feeNote}>{t('secure_spot_fee_note', { fee: formatCents(PLATFORM_FEE_CENTS) })}</Text>

                {isDeclineOpen ? (
                  <Card style={styles.declineCard}>
                    <Text style={styles.declineText} accessibilityLiveRegion="polite">
                      {t('matchFound.declineConfirm')}
                    </Text>
                    {declineError ? <ErrorNotice message={declineError} /> : null}
                    <SecondaryButton label={t('decline_match')} onPress={handleDecline} loading={isDeclining} />
                    <SecondaryButton
                      label={t('matchFound.declineKeep')}
                      onPress={() => setIsDeclineOpen(false)}
                      disabled={isDeclining}
                    />
                  </Card>
                ) : (
                  <Pressable
                    onPress={() => setIsDeclineOpen(true)}
                    disabled={isSecuring}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    style={styles.textButton}
                  >
                    <Text style={styles.textButtonLabel}>{t('decline_match')}</Text>
                  </Pressable>
                )}
              </>
            )}

            {isConfirmed ? null : (
              <Pressable
                onPress={onEdit}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                style={styles.textButton}
              >
                <Text style={styles.textButtonLabel}>{t('matchFound.editRide')}</Text>
              </Pressable>
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x2,
    marginBottom: spacing.x2,
  },
  title: {
    ...baseText.h2,
    textAlign: 'center',
  },
  subtitle: {
    ...baseText.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.x2,
  },
  summary: {
    ...baseText.body,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.x6,
  },
  groupChange: {
    ...baseText.bodySmall,
    color: colors.info,
    textAlign: 'center',
    marginBottom: spacing.x4,
  },
  countdown: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.x2,
    paddingVertical: spacing.x2,
    paddingHorizontal: spacing.x4,
    borderRadius: radii.pill,
    backgroundColor: colors.warningSoft,
    marginBottom: spacing.x4,
  },
  countdownText: {
    ...baseText.bodySmall,
    color: colors.warning,
    fontWeight: '700',
  },
  declineCard: {
    marginTop: spacing.x6,
    gap: spacing.x2,
  },
  declineText: {
    ...baseText.body,
    marginBottom: spacing.x2,
  },
  loading: {
    gap: spacing.x4,
    marginTop: spacing.x6,
  },
  mapCard: {
    padding: spacing.x2,
    marginBottom: spacing.x4,
  },
  listCard: {
    marginBottom: spacing.x4,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    paddingVertical: spacing.x3,
  },
  memberRowDivider: {
    borderTopWidth: borders.regular,
    borderTopColor: overlays.overlayWhite08,
  },
  memberText: {
    flex: 1,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x1,
  },
  memberName: {
    ...baseText.body,
    fontWeight: '600',
  },
  memberDestination: {
    ...baseText.caption,
  },
  memberStatus: {
    ...baseText.caption,
    color: colors.info,
  },
  memberStatusDelayed: {
    color: colors.warning,
    fontWeight: '700',
  },
  fareCard: {
    marginBottom: spacing.x6,
  },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.x3,
  },
  fareColumn: {
    gap: spacing.x1,
  },
  fareColumnEnd: {
    alignItems: 'flex-end',
  },
  fareLabel: {
    ...baseText.label,
  },
  fareValue: {
    ...baseText.h2,
  },
  fareNote: {
    ...baseText.caption,
  },
  feeNote: {
    ...baseText.bodySmall,
    textAlign: 'center',
    marginTop: spacing.x3,
  },
  reserveNote: {
    ...baseText.bodySmall,
    marginBottom: spacing.x3,
  },
  secureButtons: {
    gap: spacing.x2,
  },
  securedCard: {
    gap: spacing.x2,
  },
  securedTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x2,
  },
  securedTitle: {
    ...baseText.h3,
    color: colors.success,
  },
  securedNote: {
    ...baseText.bodySmall,
  },
  textButton: {
    alignSelf: 'center',
    marginTop: spacing.x6,
  },
  textButtonLabel: {
    ...baseText.bodySmall,
    textDecorationLine: 'underline',
  },
});
