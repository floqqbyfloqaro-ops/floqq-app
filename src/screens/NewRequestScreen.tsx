import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import ErrorNotice from '../components/ErrorNotice';
import PlaceAutocompleteInput from '../components/PlaceAutocompleteInput';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import SelectField from '../components/SelectField';
import { fetchEstimatedLandingTime } from '../services/flightStatus';
import { geocodeAddress } from '../services/geocoding';
import { PlaceDetails } from '../services/placesAutocomplete';
import { createPassengerRequest } from '../services/passengerRequests';
import { baseText, borders, colors, components, elevation, overlays, radii, spacing } from '../theme/colors';

type Props = {
  onSubmitted: () => void;
  onCancel: () => void;
};

const LARGE_LUGGAGE_OPTIONS = [
  { label: '0', value: 0 },
  { label: '1', value: 1 },
];

const HAND_LUGGAGE_OPTIONS = [
  { label: '0', value: 0 },
  { label: '1', value: 1 },
  { label: '2', value: 2 },
];

export default function NewRequestScreen({ onSubmitted, onCancel }: Props) {
  const { t } = useTranslation();

  const [flightNumber, setFlightNumber] = useState('');
  const [arrivalDate, setArrivalDate] = useState(new Date());
  const [arrivalTime, setArrivalTime] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [destinationAddress, setDestinationAddress] = useState('');
  const [selectedPlace, setSelectedPlace] = useState<PlaceDetails | null>(null);
  const [largeLuggageCount, setLargeLuggageCount] = useState(0);
  const [handLuggageCount, setHandLuggageCount] = useState(1);
  const [maxWaitMinutes, setMaxWaitMinutes] = useState('15');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLookingUpFlight, setIsLookingUpFlight] = useState(false);
  const [flightLookupNote, setFlightLookupNote] = useState<string | null>(null);
  const [hasFlightEstimate, setHasFlightEstimate] = useState(false);

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
      setHasFlightEstimate(false);
      setFlightLookupNote(t('newRequest.flightLookupNotFound'));
      return;
    }

    setArrivalDate(estimate.estimatedLandingAt);
    setArrivalTime(estimate.estimatedLandingAt);
    setHasFlightEstimate(true);
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

    const maxWait = Number.parseInt(maxWaitMinutes, 10);

    if (!flightNumber.trim() || !destinationAddress.trim()) {
      setErrorMessage(t('newRequest.missingFieldsError'));
      return;
    }
    if (Number.isNaN(maxWait) || maxWait < 0) {
      setErrorMessage(t('newRequest.invalidNumberError'));
      return;
    }

    const arrivalAt = new Date(arrivalDate);
    arrivalAt.setHours(arrivalTime.getHours(), arrivalTime.getMinutes(), 0, 0);

    setIsSubmitting(true);

    // Prefer the coordinates from the selected Places suggestion (more accurate than a fresh
    // geocode of the typed text). Fall back to geocoding if the user typed without picking one.
    const resolvedDestination =
      selectedPlace && selectedPlace.formattedAddress === destinationAddress.trim()
        ? selectedPlace
        : await geocodeAddress(destinationAddress.trim());

    if (!resolvedDestination) {
      setIsSubmitting(false);
      setErrorMessage(t('newRequest.geocodeError'));
      return;
    }

    const { error } = await createPassengerRequest({
      flightNumber: flightNumber.trim(),
      arrivalAt,
      destinationAddress: destinationAddress.trim(),
      destinationLat: resolvedDestination.lat,
      destinationLng: resolvedDestination.lng,
      largeLuggageCount,
      handLuggageCount,
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
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={overlays.scrimHeavy}
    >
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
      <Text style={styles.title}>{t('newRequest.title')}</Text>

      <Text style={styles.label}>{t('newRequest.arrivalDateLabel')}</Text>
      <Pressable
        style={styles.pickerField}
        onPress={() => setShowDatePicker(true)}
        accessibilityRole="button"
        accessibilityLabel={`${t('newRequest.arrivalDateLabel')}: ${arrivalDate.toLocaleDateString()}`}
      >
        <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
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

      <Text style={styles.label}>{t('newRequest.flightNumberLabel')}</Text>
      <AuthTextInput
        variant="card"
        leadingIcon="airplane-outline"
        placeholder={t('newRequest.flightNumberPlaceholder')}
        accessibilityLabel={t('newRequest.flightNumberLabel')}
        value={flightNumber}
        onChangeText={(text) => {
          setFlightNumber(text);
          setFlightLookupNote(null);
          setHasFlightEstimate(false);
        }}
        onBlur={handleFlightNumberBlur}
        autoCapitalize="characters"
      />
      {isLookingUpFlight ? (
        <Text style={styles.flightLookupNote}>{t('newRequest.flightLookupChecking')}</Text>
      ) : flightLookupNote ? (
        <Text style={styles.flightLookupNote}>{flightLookupNote}</Text>
      ) : null}

      <Text style={styles.label}>{t('newRequest.arrivalTimeLabel')}</Text>
      <View style={styles.arrivalTimeRow}>
        <Pressable
          style={[styles.pickerField, styles.pickerFieldFlex, hasFlightEstimate && styles.pickerFieldDisabled]}
          onPress={hasFlightEstimate ? undefined : () => setShowTimePicker(true)}
          accessibilityRole="button"
          accessibilityState={{ disabled: hasFlightEstimate }}
          accessibilityLabel={`${t('newRequest.arrivalTimeLabel')}: ${arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
        >
          <Ionicons name="time-outline" size={20} color={hasFlightEstimate ? colors.textDisabled : colors.textSecondary} />
          <Text style={[styles.pickerValue, hasFlightEstimate && styles.pickerValueDisabled]}>
            {arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </Pressable>
        {!hasFlightEstimate ? (
          <Pressable
            style={styles.nowButton}
            onPress={() => setArrivalTime(new Date())}
            accessibilityRole="button"
            accessibilityLabel={t('newRequest.nowButtonLabel')}
          >
            <Text style={styles.nowButtonLabel}>{t('newRequest.nowButtonLabel')}</Text>
          </Pressable>
        ) : null}
      </View>
      {hasFlightEstimate ? (
        <Text style={styles.flightLookupNote}>
          {t('newRequest.arrivalTimeAutoNote', { flightNumber: flightNumber.trim() })}
        </Text>
      ) : null}
      {!hasFlightEstimate && showTimePicker ? (
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
      <PlaceAutocompleteInput
        leadingIcon="location-outline"
        placeholder={t('newRequest.destinationPlaceholder')}
        accessibilityLabel={t('newRequest.destinationLabel')}
        value={destinationAddress}
        multiline
        textAlignVertical="top"
        onChangeText={(text) => {
          setDestinationAddress(text);
          setSelectedPlace(null);
        }}
        onSelectPlace={setSelectedPlace}
      />

      <Text style={styles.label}>{t('newRequest.largeLuggageLabel')}</Text>
      <SelectField
        accessibilityLabel={t('newRequest.largeLuggageLabel')}
        leadingIcon="briefcase-outline"
        value={largeLuggageCount}
        options={LARGE_LUGGAGE_OPTIONS}
        onChange={setLargeLuggageCount}
      />

      <Text style={styles.label}>{t('newRequest.handLuggageLabel')}</Text>
      <SelectField
        accessibilityLabel={t('newRequest.handLuggageLabel')}
        leadingIcon="bag-handle-outline"
        value={handLuggageCount}
        options={HAND_LUGGAGE_OPTIONS}
        onChange={setHandLuggageCount}
      />

      <Text style={styles.label}>{t('newRequest.maxWaitLabel')}</Text>
      <AuthTextInput
        variant="card"
        leadingIcon="hourglass-outline"
        placeholder="15"
        accessibilityLabel={t('newRequest.maxWaitLabel')}
        value={maxWaitMinutes}
        onChangeText={setMaxWaitMinutes}
        keyboardType="number-pad"
        helperText={t('newRequest.maxWaitHelper')}
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
      </KeyboardAvoidingView>
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
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.x4,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCard,
    gap: spacing.x3,
    marginBottom: spacing.x4,
    ...elevation.resting,
  },
  pickerValue: {
    ...baseText.body,
  },
  pickerFieldDisabled: {
    ...components.secondaryButton.disabled,
  },
  pickerValueDisabled: {
    color: colors.textDisabled,
  },
  arrivalTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    marginBottom: spacing.x4,
  },
  pickerFieldFlex: {
    flex: 1,
    marginBottom: 0,
  },
  nowButton: {
    minHeight: 52,
    paddingHorizontal: spacing.x4,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.accentPrimary,
    backgroundColor: colors.accentPrimarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nowButtonLabel: {
    ...baseText.bodySmall,
    color: colors.accentPrimary,
    fontWeight: '700',
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
