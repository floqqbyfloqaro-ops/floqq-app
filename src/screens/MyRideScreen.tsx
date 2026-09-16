import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import Skeleton from '../components/Skeleton';
import StatusPill from '../components/StatusPill';
import { SERVICE_FEE_EUR } from '../constants';
import { createServiceFeeCheckout } from '../services/payments';
import { fetchMyGroupStatus, fetchMyLatestRequest, MyPassengerRequest, MyTaxiGroup } from '../services/passengerRequests';
import { baseText, colors, overlays, radii, spacing } from '../theme/colors';

type Props = {
  onBack: () => void;
  onCreateRequest: () => void;
};

export default function MyRideScreen({ onBack, onCreateRequest }: Props) {
  const { t } = useTranslation();

  const [request, setRequest] = useState<MyPassengerRequest | null>(null);
  const [group, setGroup] = useState<MyTaxiGroup | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

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

  const isEmpty = !isLoading && !request;

  return (
    <ScreenBackground
      source={isEmpty ? require('../../assets/bg-empty-state.png') : require('../../assets/bg-content.png')}
      naturalWidth={isEmpty ? 330 : 317}
      naturalHeight={1536}
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
            <PrimaryButton label={t('myRide.emptyAction')} onPress={onCreateRequest} />
          </View>
        ) : (
          <Card>
            <Text style={styles.flightNumber}>{request.flight_number}</Text>

            {!group ? (
              <StatusPill status="Searching" label={t('myRide.statusPending')} />
            ) : group.status === 'unconfirmed' ? (
              <StatusPill status="Searching" label={t('myRide.statusUnconfirmed')} />
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
          </Card>
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
  feeNote: {
    ...baseText.bodySmall,
    marginTop: spacing.x3,
    marginBottom: spacing.x3,
  },
  pendingNote: {
    ...baseText.caption,
    marginBottom: spacing.x3,
  },
});
