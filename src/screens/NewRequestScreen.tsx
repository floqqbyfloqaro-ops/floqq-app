import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import { fetchEstimatedLandingTime } from '../services/flightStatus';
import { geocodeAddress } from '../services/geocoding';
import { createPassengerRequest } from '../services/passengerRequests';
import { baseText, colors, components, overlays, spacing } from '../theme/colors';

type Props = {
  onSubmitted: () => void;
  onCancel: () => void;
};

export default function NewRequestScreen({ onSubmitted, onCancel }: Props) {
  const { t } = useTranslation();

  const [flightNumber, setFlightNumber] = useState('');
  const [arrivalDate, setArrivalDate] = useState(new Date());
  const [arrivalTime, setArrivalTime] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [destinationAddress, setDestinationAddress] = useState('');
  const [bagsCount, setBagsCount] = useState('1');
  const [maxWaitMinutes, setMaxWaitMinutes] = useState('15');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLookingUpFlight, setIsLookingUpFlight] = useState(false);
  const [flightLookupNote, setFlightLookupNote] = useState<string | null>(null);

  const handleDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (event.type === 'set' && selectedDate) {
      setArrivalDate(selectedDate);
    }
  };

  const handleFlightNumberBlur = async () => {
    if (!flightNumber.trim()) {
      return;
    }

    setIsLookingUpFlight(true);
    setFlightLookupNote(null);

    const estimate = await fetchEstimatedLandingTime(flightNumber);
    setIsLookingUpFlight(false);

    if (!estimate) {
      setFlightLookupNote(t('newRequest.flightLookupNotFound'));
      return;
    }

    setArrivalDate(estimate.estimatedLandingAt);
    setArrivalTime(estimate.estimatedLandingAt);
    setFlightLookupNote(
      t('newRequest.flightLookupFound', {
        time: estimate.estimatedLandingAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      })
    );
  };

  const handleTimeChange = (event: DateTimePickerEvent, selectedTime?: Date) => {
    if (Platform.OS === 'android') {
      setShowTimePicker(false);
    }
    if (event.type === 'set' && selectedTime) {
      setArrivalTime(selectedTime);
    }
  };

  const handleSubmit = async () => {
    setErrorMessage(null);

    const bags = Number.parseInt(bagsCount, 10);
    const maxWait = Number.parseInt(maxWaitMinutes, 10);

    if (!flightNumber.trim() || !destinationAddress.trim()) {
      setErrorMessage(t('newRequest.missingFieldsError'));
      return;
    }
    if (Number.isNaN(bags) || bags < 0 || Number.isNaN(maxWait) || maxWait < 0) {
      setErrorMessage(t('newRequest.invalidNumberError'));
      return;
    }

    const arrivalAt = new Date(arrivalDate);
    arrivalAt.setHours(arrivalTime.getHours(), arrivalTime.getMinutes(), 0, 0);

    setIsSubmitting(true);

    const geocoded = await geocodeAddress(destinationAddress.trim());
    if (!geocoded) {
      setIsSubmitting(false);
      setErrorMessage(t('newRequest.geocodeError'));
      return;
    }

    const { error } = await createPassengerRequest({
      flightNumber: flightNumber.trim(),
      arrivalAt,
      destinationAddress: destinationAddress.trim(),
      destinationLat: geocoded.lat,
      destinationLng: geocoded.lng,
      bagsCount: bags,
      maxWaitMinutes: maxWait,
    });
    setIsSubmitting(false);

    if (error) {
      console.warn('createPassengerRequest failed', error);
      setErrorMessage(t('newRequest.submitError'));
      return;
    }

    Alert.alert(t('newRequest.successTitle'));
    onSubmitted();
  };

  return (
    <ScreenBackground
      source={require('../../assets/bg-content.png')}
      naturalWidth={317}
      naturalHeight={1536}
      scrimColor={overlays.scrimMedium}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('newRequest.title')}</Text>

      <Text style={styles.label}>{t('newRequest.flightNumberLabel')}</Text>
      <AuthTextInput
        placeholder={t('newRequest.flightNumberPlaceholder')}
        accessibilityLabel={t('newRequest.flightNumberLabel')}
        value={flightNumber}
        onChangeText={(text) => {
          setFlightNumber(text);
          setFlightLookupNote(null);
        }}
        onBlur={handleFlightNumberBlur}
        autoCapitalize="characters"
      />
      {isLookingUpFlight ? (
        <Text style={styles.flightLookupNote}>{t('newRequest.flightLookupChecking')}</Text>
      ) : flightLookupNote ? (
        <Text style={styles.flightLookupNote}>{flightLookupNote}</Text>
      ) : null}

      <Text style={styles.label}>{t('newRequest.arrivalDateLabel')}</Text>
      <Pressable
        style={styles.pickerField}
        onPress={() => setShowDatePicker(true)}
        accessibilityRole="button"
        accessibilityLabel={`${t('newRequest.arrivalDateLabel')}: ${arrivalDate.toLocaleDateString()}`}
      >
        <Text style={styles.pickerValue}>{arrivalDate.toLocaleDateString()}</Text>
      </Pressable>
      {showDatePicker ? (
        <>
          <DateTimePicker
            value={arrivalDate}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={handleDateChange}
          />
          {Platform.OS === 'ios' ? (
            <Pressable
              onPress={() => setShowDatePicker(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('newRequest.done')}
            >
              <Text style={styles.doneText}>{t('newRequest.done')}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      <Text style={styles.label}>{t('newRequest.arrivalTimeLabel')}</Text>
      <Pressable
        style={styles.pickerField}
        onPress={() => setShowTimePicker(true)}
        accessibilityRole="button"
        accessibilityLabel={`${t('newRequest.arrivalTimeLabel')}: ${arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
      >
        <Text style={styles.pickerValue}>
          {arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </Pressable>
      {showTimePicker ? (
        <>
          <DateTimePicker
            value={arrivalTime}
            mode="time"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            onChange={handleTimeChange}
          />
          {Platform.OS === 'ios' ? (
            <Pressable
              onPress={() => setShowTimePicker(false)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel={t('newRequest.done')}
            >
              <Text style={styles.doneText}>{t('newRequest.done')}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      <Text style={styles.label}>{t('newRequest.destinationLabel')}</Text>
      <AuthTextInput
        placeholder={t('newRequest.destinationPlaceholder')}
        accessibilityLabel={t('newRequest.destinationLabel')}
        value={destinationAddress}
        onChangeText={setDestinationAddress}
      />

      <Text style={styles.label}>{t('newRequest.bagsLabel')}</Text>
      <AuthTextInput
        placeholder="1"
        accessibilityLabel={t('newRequest.bagsLabel')}
        value={bagsCount}
        onChangeText={setBagsCount}
        keyboardType="number-pad"
      />

      <Text style={styles.label}>{t('newRequest.maxWaitLabel')}</Text>
      <AuthTextInput
        placeholder="15"
        accessibilityLabel={t('newRequest.maxWaitLabel')}
        value={maxWaitMinutes}
        onChangeText={setMaxWaitMinutes}
        keyboardType="number-pad"
      />

      {errorMessage ? <ErrorNotice message={errorMessage} onRetry={handleSubmit} retryLabel={t('common.retry')} /> : null}

      <PrimaryButton label={t('newRequest.submit')} onPress={handleSubmit} loading={isSubmitting} />

      <Pressable
        onPress={onCancel}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel={t('newRequest.cancel')}
      >
        <Text style={styles.cancelText}>{t('newRequest.cancel')}</Text>
      </Pressable>
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: spacing.x6,
    paddingBottom: spacing.x12,
  },
  title: {
    ...baseText.h2,
    marginBottom: spacing.x6,
  },
  label: {
    ...baseText.label,
    marginBottom: spacing.x2,
  },
  flightLookupNote: {
    ...baseText.caption,
    color: colors.info,
    marginTop: -spacing.x2,
    marginBottom: spacing.x4,
  },
  pickerField: {
    ...components.input.base,
    justifyContent: 'center',
    marginBottom: spacing.x4,
  },
  pickerValue: {
    ...baseText.body,
  },
  doneText: {
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
    textAlign: 'center',
    marginBottom: spacing.x4,
  },
  cancelText: {
    ...baseText.bodySmall,
    textAlign: 'center',
    marginTop: spacing.x4,
  },
});
