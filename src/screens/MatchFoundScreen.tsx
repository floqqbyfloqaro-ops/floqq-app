import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import Avatar from '../components/Avatar';
import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import RouteMap from '../components/RouteMap';
import ScreenBackground from '../components/ScreenBackground';
import Skeleton from '../components/Skeleton';
import { PLATFORM_FEE_CENTS } from '../constants';
import { decodePolyline, fetchMatchOffer, MatchOffer, MatchOfferMember, subscribeToRide } from '../services/matchOffer';
import type { MyPassengerRequest } from '../services/passengerRequests';
import { formatCents } from '../services/payments';
import { baseText, borders, colors, overlays, radii, spacing } from '../theme/colors';

type Props = {
  request: MyPassengerRequest;
  onBack: () => void;
  onEdit: () => void;
};

const MAP_HEIGHT = 180;
const AVATAR_SIZE = 44;

// Other passengers' rides can't be watched from the app (row level security), so the screen also
// re-reads the offer on a timer to pick up e.g. someone else securing their spot.
const REFRESH_MS = 20_000;

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

// Shown while the passenger's group is still an offer (an unconfirmed taxi group): who they'd
// ride with, the planned route, the estimated fare, and their answer. MyRideScreen decides when
// this screen is up and moves on when the group is confirmed or gone.
export default function MatchFoundScreen({ request, onBack, onEdit }: Props) {
  const { t } = useTranslation();

  const [offer, setOffer] = useState<MatchOffer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    const { offer: loaded, error } = await fetchMatchOffer(request.id);
    setIsLoading(false);
    if (error) {
      console.warn('fetchMatchOffer failed', error);
      setLoadFailed(true);
      return;
    }
    setLoadFailed(false);
    // A group that just disappeared: keep what's on screen until MyRideScreen moves on.
    if (loaded) setOffer(loaded);
  }, [request.id]);

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
          <Text style={styles.title}>{t('match_found_title')}</Text>
          <Ionicons name="sparkles" size={24} color={colors.accentGold} />
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
                      <Text style={styles.memberName}>{name}</Text>
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

            {/* Answering the offer ("Secure my spot" / "Not for me") arrives in the next build steps. */}
            <PrimaryButton label={t('secure_my_spot')} onPress={() => undefined} disabled />
            <Text style={styles.feeNote}>{t('secure_spot_fee_note', { fee: formatCents(PLATFORM_FEE_CENTS) })}</Text>

            <Pressable
              onPress={onEdit}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              style={styles.textButton}
            >
              <Text style={styles.textButtonLabel}>{t('matchFound.editRide')}</Text>
            </Pressable>
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
  textButton: {
    alignSelf: 'center',
    marginTop: spacing.x6,
  },
  textButtonLabel: {
    ...baseText.bodySmall,
    textDecorationLine: 'underline',
  },
});
