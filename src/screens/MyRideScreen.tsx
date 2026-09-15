import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import { SERVICE_FEE_EUR } from '../constants';
import { createServiceFeeCheckout } from '../services/payments';
import { fetchMyGroupStatus, fetchMyLatestRequest, MyPassengerRequest, MyTaxiGroup } from '../services/passengerRequests';
import { colors } from '../theme/colors';

type Props = {
  onBack: () => void;
};

export default function MyRideScreen({ onBack }: Props) {
  const { t } = useTranslation();

  const [request, setRequest] = useState<MyPassengerRequest | null>(null);
  const [group, setGroup] = useState<MyTaxiGroup | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPaying, setIsPaying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setErrorMessage(null);
    const { data: myRequest, error: requestError } = await fetchMyLatestRequest();
    if (requestError) {
      setIsLoading(false);
      setErrorMessage(requestError.message);
      return;
    }

    setRequest(myRequest);

    if (myRequest?.group_id) {
      const { data: myGroup, error: groupError } = await fetchMyGroupStatus(myRequest.group_id);
      if (groupError) {
        setIsLoading(false);
        setErrorMessage(groupError.message);
        return;
      }
      setGroup(myGroup);
    } else {
      setGroup(null);
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
    setErrorMessage(null);
    setIsPaying(true);
    const { url, error } = await createServiceFeeCheckout(request.id);
    setIsPaying(false);

    if (error || !url) {
      setErrorMessage(error?.message ?? t('myRide.checkoutError'));
      return;
    }

    await Linking.openURL(url);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack}>
        <Text style={styles.backText}>{t('admin.back')}</Text>
      </Pressable>
      <Text style={styles.title}>{t('myRide.title')}</Text>

      {isLoading ? (
        <Text style={styles.emptyText}>{t('admin.loading')}</Text>
      ) : !request ? (
        <Text style={styles.emptyText}>{t('myRide.empty')}</Text>
      ) : (
        <View style={styles.card}>
          <Text style={styles.flightNumber}>{request.flight_number}</Text>

          {!group ? (
            <Text style={styles.statusText}>{t('myRide.statusPending')}</Text>
          ) : group.status === 'unconfirmed' ? (
            <Text style={styles.statusText}>{t('myRide.statusUnconfirmed')}</Text>
          ) : request.service_fee_status === 'paid' ? (
            <Text style={styles.statusPaid}>{t('myRide.statusPaid')}</Text>
          ) : (
            <>
              <Text style={styles.statusText}>{t('myRide.statusConfirmed')}</Text>
              <Text style={styles.feeNote}>{t('myRide.feeNote', { amount: SERVICE_FEE_EUR.toFixed(2) })}</Text>
              {request.service_fee_status === 'pending' ? (
                <Text style={styles.pendingNote}>{t('myRide.pendingNote')}</Text>
              ) : null}
              <PrimaryButton
                label={t('myRide.payButton', { amount: SERVICE_FEE_EUR.toFixed(2) })}
                onPress={handlePay}
                loading={isPaying}
              />
            </>
          )}
        </View>
      )}

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <Pressable onPress={loadData}>
        <Text style={styles.refreshText}>{t('myRide.refresh')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingTop: 48,
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  backText: {
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 20,
  },
  emptyText: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  flightNumber: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
  },
  statusText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  statusPaid: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 4,
  },
  feeNote: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: 12,
  },
  pendingNote: {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: 12,
  },
  error: {
    color: colors.error,
    marginBottom: 16,
    textAlign: 'center',
  },
  refreshText: {
    color: colors.textSecondary,
    textDecorationLine: 'underline',
    textAlign: 'center',
  },
});
