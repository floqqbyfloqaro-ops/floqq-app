import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import CancelConfirmedRide from '../components/CancelConfirmedRide';
import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import FindMyGroupButton from '../components/FindMyGroupButton';
import PayerCard from '../components/PayerCard';
import PrimaryButton from '../components/PrimaryButton';
import RideHoldCard from '../components/RideHoldCard';
import ScreenBackground from '../components/ScreenBackground';
import Skeleton from '../components/Skeleton';
import StatusPill from '../components/StatusPill';
import { PAYMENTS_ENABLED, SERVICE_FEE_EUR } from '../constants';
import { FindGroupOpenSource } from '../services/findGroup';
import { subscribeToRide } from '../services/matchOffer';
import { MeetingPointSummary, meetingPointText, wordingLanguageFor } from '../services/meetingPointRules';
import { fetchMeetingPointSummary, shippedText } from '../services/meetingPoints';
import { rideInProgress } from '../services/onTheWayRules';
import { fetchMyTrips, MyTrip } from '../services/rideCompletion';
import { createServiceFeeCheckout } from '../services/payments';
import { fetchMyGroupStatus, fetchMyLatestRequest, MyPassengerRequest, MyTaxiGroup } from '../services/passengerRequests';
import { baseText, colors, overlays, radii, spacing } from '../theme/colors';
import FindingMatchScreen from './FindingMatchScreen';
import GroupDetailsScreen from './GroupDetailsScreen';
import MatchFoundScreen from './MatchFoundScreen';
import OnTheWayScreen from './OnTheWayScreen';
import RideCompletedScreen from './RideCompletedScreen';

type Props = {
  onBack: () => void;
  onCreateRequest: (requestId?: string) => void;
  onOpenProfile: () => void;
  // Set (with a new nonce each time) to go straight to "Find your group": a tapped "You've
  // landed" notification, or the app being opened after landing.
  openFindGroup?: { nonce: number; source: FindGroupOpenSource } | null;
  // Called once that was acted on, so coming back to this screen later doesn't repeat it.
  onFindGroupOpened?: () => void;
};

type SubScreen = 'findingMatch' | 'matchFound' | 'findGroup' | 'onTheWay' | 'completed' | null;

// How often the ride is re-read while the passenger is waiting for (or looking at) a match, on top
// of the live updates - a safety net for a missed one.
const LIVE_RECHECK_MS = 15_000;

export default function MyRideScreen({ onBack, onCreateRequest, onOpenProfile, openFindGroup, onFindGroupOpened }: Props) {
  const { t, i18n } = useTranslation();

  const [request, setRequest] = useState<MyPassengerRequest | null>(null);
  const [group, setGroup] = useState<MyTaxiGroup | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [subScreen, setSubScreen] = useState<SubScreen>(null);
  const [meetingPoint, setMeetingPoint] = useState<MeetingPointSummary | null>(null);
  // "Find your group": how it was opened (for the audit trail) and where its back button leads.
  const [findGroupSource, setFindGroupSource] = useState<FindGroupOpenSource>('button');
  const [findGroupReturn, setFindGroupReturn] = useState<SubScreen>(null);
  // The passenger asked for the ride's normal card while it is on its way (the payer's receipt is
  // there): don't send them back to "On the way" during this visit.
  const [showRideDetails, setShowRideDetails] = useState(false);
  // "Ride completed" for which ride: the one just completed, or a past trip opened from the list.
  const [completedRequestId, setCompletedRequestId] = useState<string | null>(null);
  const [trips, setTrips] = useState<MyTrip[]>([]);
  const autoCompletedShown = useRef(false);

  const showCompleted = (id: string) => {
    setCompletedRequestId(id);
    setSubScreen('completed');
  };

  const showFindGroup = (source: FindGroupOpenSource, returnTo: SubScreen) => {
    setFindGroupSource(source);
    setFindGroupReturn(returnTo);
    setSubScreen('findGroup');
  };

  // Opened from outside this screen: back then leads to the confirmed group.
  const openNonce = openFindGroup?.nonce;
  const openSource = openFindGroup?.source;
  useEffect(() => {
    if (openNonce == null || !openSource) return;
    setFindGroupSource(openSource);
    setFindGroupReturn('matchFound');
    setSubScreen('findGroup');
    onFindGroupOpened?.();
  }, [openNonce, openSource, onFindGroupOpened]);

  const loadData = useCallback(async () => {
    setErrorMessage(null);
    const { data: myRequest, error: requestError } = await fetchMyLatestRequest();
    if (requestError) {
      console.warn('fetchMyLatestRequest failed', requestError);
      setIsLoading(false);
      setIsRefreshing(false);
      setErrorMessage(t('myRide.loadError'));
      return;
    }

    setRequest(myRequest);

    // Past trips: the list is a convenience - the screen works without it.
    fetchMyTrips().then(({ data, error }) => {
      if (error) console.warn('fetchMyTrips failed', error);
      setTrips(data ?? []);
    });

    if (myRequest?.group_id) {
      const { data: myGroup, error: groupError } = await fetchMyGroupStatus(myRequest.group_id);
      if (groupError) {
        console.warn('fetchMyGroupStatus failed', groupError);
        setIsLoading(false);
        setIsRefreshing(false);
        setErrorMessage(t('myRide.loadError'));
        return;
      }
      setGroup(myGroup);
    } else {
      setGroup(null);
    }

    setIsLoading(false);
    setIsRefreshing(false);
  }, [t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadData();
  };

  // Where the confirmed group meets, for the "Meet at" line (the full card is on the meetup screen).
  const meetingPointId = group?.status === 'confirmed' ? group.meeting_point_id : null;
  useEffect(() => {
    if (!meetingPointId) {
      setMeetingPoint(null);
      return;
    }
    let cancelled = false;
    fetchMeetingPointSummary(meetingPointId).then(({ data, error }) => {
      if (cancelled) return;
      if (error) console.warn('fetchMeetingPointSummary failed', error);
      setMeetingPoint(data ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [meetingPointId]);

  // Stripe Checkout opens in the system browser, so the most reliable moment to pick up the
  // webhook's result is when the passenger switches back into the app - not a deep link, which
  // may fire before the webhook has finished updating the row.
  const wasBackgrounded = useRef(false);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && wasBackgrounded.current) {
        loadData();
      }
      wasBackgrounded.current = nextState !== 'active';
    });
    return () => subscription.remove();
  }, [loadData]);

  // While the passenger is waiting for a match or looking at one, follow their ride live
  // (Supabase Realtime on their own ride and group)...
  const requestId = request?.id;
  const groupId = request?.group_id ?? null;
  // ...and while it's on its way, so "On the way" ends as soon as the taxi receipt is in.
  const isWatchingMatch = subScreen === 'findingMatch' || subScreen === 'matchFound' || subScreen === 'onTheWay';
  useEffect(() => {
    if (!requestId || !isWatchingMatch) return;
    const unsubscribe = subscribeToRide('myride', requestId, groupId, loadData);
    const timer = setInterval(loadData, LIVE_RECHECK_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [requestId, groupId, isWatchingMatch, loadData]);

  // ...and move to the screen that fits where the ride is now: a group was proposed ("Match
  // found" - which also shows the group once it's confirmed), or it fell apart again. `group` can
  // briefly still be the previous group while the new one loads, so it only counts once it's the
  // ride's current one.
  const groupStatus = group && group.id === groupId ? group.status : null;
  const isActiveRide = request?.status === 'pending' || request?.status === 'matched';
  // While the group's ride is in progress, My Ride opens on "On the way" - and leaves it once it
  // isn't any more: the taxi receipt came in, or the time is up. (Only once the loaded group says
  // the ride started: right after "We're in the taxi" it may still be the copy from before.)
  const currentGroup = group && group.id === groupId ? group : null;
  const isOnTheWay = rideInProgress(
    {
      groupStatus,
      rideStartedAt: currentGroup?.ride_started_at ?? null,
      receiptReceivedAt: currentGroup?.receipt_received_at ?? null,
      completedAt: request?.completed_at ?? null,
    },
    Date.now()
  );
  const rideHasStarted = currentGroup?.ride_started_at != null;
  useEffect(() => {
    if (isOnTheWay && !showRideDetails && subScreen === null) setSubScreen('onTheWay');
    else if (subScreen === 'onTheWay' && rideHasStarted && !isOnTheWay) setSubScreen(null);
  }, [isOnTheWay, rideHasStarted, showRideDetails, subScreen]);

  // Completed without the passenger's own "I've arrived" (the receipt, or automatically): show
  // "Ride completed" once - the server remembers it was seen.
  const unseenCompletedId = request?.completed_at && !request.completion_seen_at ? request.id : null;
  useEffect(() => {
    if (!unseenCompletedId || autoCompletedShown.current) return;
    if (subScreen !== null && subScreen !== 'onTheWay') return;
    autoCompletedShown.current = true;
    showCompleted(unseenCompletedId);
  }, [unseenCompletedId, subScreen]);

  useEffect(() => {
    if (subScreen === 'findingMatch' && (groupStatus === 'unconfirmed' || groupStatus === 'confirmed')) {
      setSubScreen('matchFound');
    } else if (subScreen === 'matchFound' && (!groupId || groupStatus === 'dissolved')) {
      setSubScreen(isActiveRide ? 'findingMatch' : null);
    }
  }, [subScreen, groupId, groupStatus, isActiveRide]);

  const handlePay = async () => {
    if (!request) return;
    setCheckoutError(null);
    setIsPaying(true);
    const { url, error } = await createServiceFeeCheckout(request.id);
    setIsPaying(false);

    if (error || !url) {
      console.warn('createServiceFeeCheckout failed', error);
      setCheckoutError(t('myRide.checkoutError'));
      return;
    }

    await Linking.openURL(url);
  };

  const handleCardPress = () => {
    if (!request || request.status === 'cancelled' || request.status === 'expired') return;
    // "Match found" shows the group both while it's an offer and once it's confirmed.
    setSubScreen(group ? 'matchFound' : 'findingMatch');
  };

  if (subScreen === 'findingMatch' && request) {
    return (
      <FindingMatchScreen
        request={request}
        onBack={() => setSubScreen(null)}
        onEdit={() => onCreateRequest(request.id)}
        onCancelled={() => {
          setSubScreen(null);
          loadData();
        }}
      />
    );
  }

  if (subScreen === 'matchFound' && request) {
    return (
      <MatchFoundScreen
        request={request}
        onBack={() => setSubScreen(null)}
        onEdit={() => onCreateRequest(request.id)}
        onOpenProfile={onOpenProfile}
        onFindGroup={() => showFindGroup('button', 'matchFound')}
        onLeft={() => {
          setSubScreen('findingMatch');
          loadData();
        }}
      />
    );
  }

  if (subScreen === 'onTheWay' && request) {
    return (
      <OnTheWayScreen
        requestId={request.id}
        onBack={onBack}
        onShowDetails={() => {
          setShowRideDetails(true);
          setSubScreen(null);
        }}
        onArrived={() => {
          autoCompletedShown.current = true;
          showCompleted(request.id);
          loadData();
        }}
      />
    );
  }

  if (subScreen === 'completed' && completedRequestId) {
    return <RideCompletedScreen requestId={completedRequestId} onDone={onBack} />;
  }

  if (subScreen === 'findGroup' && request) {
    return (
      <GroupDetailsScreen
        request={request}
        openedFrom={findGroupSource}
        onRideStarted={() => {
          setShowRideDetails(false);
          setSubScreen('onTheWay');
          loadData();
        }}
        onBack={() => {
          setSubScreen(findGroupReturn);
          loadData();
        }}
      />
    );
  }

  return (
    <ScreenBackground
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={overlays.scrimMedium}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accentPrimaryStrong} />
        }
      >
        <Pressable
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('admin.back')}
        >
          <Text style={styles.backText}>{t('admin.back')}</Text>
        </Pressable>
        <Text style={styles.title}>{t('myRide.title')}</Text>

        {errorMessage ? <ErrorNotice message={errorMessage} onRetry={loadData} retryLabel={t('common.retry')} /> : null}

        {isLoading ? (
          <Card accessible accessibilityLabel={t('admin.loading')}>
            <Skeleton width={120} height={22} style={styles.skeletonGap} />
            <Skeleton width={140} height={28} radius={radii.pill} style={styles.skeletonGap} />
            <Skeleton width="90%" height={14} style={styles.skeletonGap} />
            <Skeleton width="70%" height={14} />
          </Card>
        ) : !request ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{t('myRide.empty')}</Text>
            <PrimaryButton label={t('myRide.emptyAction')} onPress={() => onCreateRequest()} />
          </View>
        ) : request.completed_at && group?.payer_request_id !== request.id ? (
          // A completed ride is in "My trips" below; what's left here is booking the next one. (The
          // payer keeps the ride's card: a rejected receipt has to be sent again from there.)
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{t('myTrips.lastCompleted')}</Text>
            <PrimaryButton label={t('myRide.emptyAction')} onPress={() => onCreateRequest()} />
          </View>
        ) : request.status === 'cancelled' || request.status === 'expired' ? (
          <View style={styles.emptyState}>
            <Card style={styles.cancelledCard} accessibilityLabel={t('myRide.title')}>
              <Text style={styles.flightNumber}>{request.flight_number || t('myRide.noFlightNumber')}</Text>
              {/* Expired reuses the neutral Cancelled pill style; only the label tells them apart. */}
              <StatusPill
                status="Cancelled"
                label={t(request.status === 'expired' ? 'myRide.ride_expired_no_match' : 'myRide.statusCancelled')}
              />
            </Card>
            <PrimaryButton label={t('myRide.emptyAction')} onPress={() => onCreateRequest()} />
          </View>
        ) : (
          <Card onPress={handleCardPress} accessibilityLabel={t('myRide.title')}>
            <Text style={styles.flightNumber}>{request.flight_number || t('myRide.noFlightNumber')}</Text>

            <Text style={styles.fieldLabel}>{t('myRide.destinationLabel')}</Text>
            <Text style={styles.destinationText}>{request.destination_address}</Text>

            <Text style={styles.fieldLabel}>{t('myRide.arrivalLabel')}</Text>
            <Text style={styles.arrivalText}>
              {new Date(request.arrival_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </Text>

            {!group ? (
              <StatusPill status="Searching" label={t('myRide.statusPending')} />
            ) : group.status === 'unconfirmed' ? (
              <StatusPill status="Searching" label={t('myRide.statusUnconfirmed')} />
            ) : PAYMENTS_ENABLED ? (
              // Payments prototype: the FLOQQ fee is part of the seat reservation (card hold), so the
              // separate service-fee Checkout below is replaced while PAYMENTS_ENABLED is on.
              <>
                <StatusPill status="Group Confirmed" label={t('myRide.statusConfirmed')} />
                <RideHoldCard
                  requestId={request.id}
                  groupId={group.id}
                  isPayer={group.payer_request_id === request.id}
                  onOpenProfile={onOpenProfile}
                />
                <PayerCard requestId={request.id} group={group} arrivalAt={request.arrival_at} />
              </>
            ) : request.service_fee_status === 'paid' ? (
              <StatusPill status="Group Confirmed" label={t('myRide.statusPaid')} />
            ) : (
              <>
                <StatusPill status="Group Confirmed" label={t('myRide.statusConfirmed')} />
                <Text style={styles.feeNote}>{t('myRide.feeNote', { amount: SERVICE_FEE_EUR.toFixed(2) })}</Text>
                {request.service_fee_status === 'pending' ? (
                  <Text style={styles.pendingNote}>{t('myRide.pendingNote')}</Text>
                ) : null}
                {checkoutError ? (
                  <ErrorNotice message={checkoutError} onRetry={handlePay} retryLabel={t('common.retry')} />
                ) : null}
                <PrimaryButton
                  label={t('myRide.payButton', { amount: SERVICE_FEE_EUR.toFixed(2) })}
                  onPress={handlePay}
                  loading={isPaying}
                />
              </>
            )}
            {group?.status === 'confirmed' && meetingPoint ? (
              <Text style={styles.meetAt}>
                {t('myRide.meetAt', {
                  name: meetingPointText(meetingPoint, 'name', wordingLanguageFor(i18n.language), shippedText),
                  terminal: meetingPoint.terminal,
                })}
              </Text>
            ) : null}
            {group?.status === 'confirmed' ? (
              <View style={styles.findGroupButton}>
                <FindMyGroupButton request={request} onPress={() => showFindGroup('button', null)} />
              </View>
            ) : null}
            {group?.status === 'confirmed' ? (
              <CancelConfirmedRide
                requestId={request.id}
                groupId={group.id}
                serviceFeeStatus={request.service_fee_status}
                onCancelled={loadData}
              />
            ) : null}
          </Card>
        )}
        {!isLoading && trips.length > 0 ? (
          <View style={styles.trips}>
            <Text style={styles.tripsTitle}>{t('myTrips.title')}</Text>
            {trips.map((trip) => (
              <Card
                key={trip.id}
                style={styles.tripCard}
                onPress={() => showCompleted(trip.id)}
                accessibilityLabel={`${trip.destination_address}, ${new Date(trip.completed_at).toLocaleDateString([], { dateStyle: 'medium' })}`}
              >
                <Text style={styles.tripDate}>
                  {new Date(trip.arrival_at).toLocaleDateString([], { dateStyle: 'medium' })}
                </Text>
                <Text style={styles.tripDestination} numberOfLines={2}>
                  {trip.destination_address}
                </Text>
                <Text style={styles.tripLink}>{t('myTrips.viewSummary')}</Text>
              </Card>
            ))}
          </View>
        ) : null}
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
  backText: {
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
    marginBottom: spacing.x3,
  },
  title: {
    ...baseText.h2,
    marginBottom: spacing.x6,
  },
  skeletonGap: {
    marginBottom: spacing.x3,
  },
  trips: {
    marginTop: spacing.x8,
  },
  tripsTitle: {
    ...baseText.h3,
    marginBottom: spacing.x3,
  },
  tripCard: {
    marginBottom: spacing.x3,
  },
  tripDate: {
    ...baseText.label,
    marginBottom: spacing.x1,
  },
  tripDestination: {
    ...baseText.body,
    marginBottom: spacing.x2,
  },
  tripLink: {
    ...baseText.bodySmall,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
  emptyState: {
    alignItems: 'stretch',
    marginTop: spacing.x6,
  },
  emptyText: {
    ...baseText.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.x6,
  },
  flightNumber: {
    ...baseText.h3,
    marginBottom: spacing.x3,
  },
  fieldLabel: {
    ...baseText.label,
    marginBottom: spacing.x1,
  },
  destinationText: {
    ...baseText.body,
    marginBottom: spacing.x3,
  },
  arrivalText: {
    ...baseText.body,
    marginBottom: spacing.x3,
  },
  cancelledCard: {
    marginBottom: spacing.x6,
  },
  feeNote: {
    ...baseText.bodySmall,
    marginTop: spacing.x3,
    marginBottom: spacing.x3,
  },
  pendingNote: {
    ...baseText.caption,
    marginBottom: spacing.x3,
  },
  findGroupButton: {
    marginTop: spacing.x4,
    marginBottom: spacing.x3,
  },
  meetAt: {
    ...baseText.body,
    fontWeight: '600',
    marginTop: spacing.x3,
  },
});
