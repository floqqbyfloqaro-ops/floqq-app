import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import ErrorNotice from '../components/ErrorNotice';
import PlaceAutocompleteInput from '../components/PlaceAutocompleteInput';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import SelectField from '../components/SelectField';
import Skeleton from '../components/Skeleton';
import { TERMINAL_PREFILL_WINDOW_HOURS } from '../constants';
import { airlineCodeOf, airlineTerminal, AirlineTerminalRow } from '../services/airlineTerminalRules';
import { fetchAirlineTerminals } from '../services/airlineTerminals';
import { fetchFlightLookup } from '../services/flightStatus';
import { geocodeAddress } from '../services/geocoding';
import { PlaceDetails } from '../services/placesAutocomplete';
import {
  ageRuleErrorOf,
  createPassengerRequest,
  fetchPassengerRequestById,
  isActiveRideExistsError,
  isEmailNotVerifiedError,
  updatePassengerRequest,
} from '../services/passengerRequests';
import { detectTerminalFromLocation } from '../services/terminalGeofence';
import { ARRIVAL_TERMINALS, ArrivalTerminal } from '../services/terminalRules';
import { baseText, borders, colors, components, elevation, overlays, radii, spacing } from '../theme/colors';
import { fromBarcelonaWallClock, toBarcelonaWallClock } from '../utils/formatDateTime';

type Props = {
  requestId?: string;
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

export default function NewRequestScreen({ requestId, onSubmitted, onCancel }: Props) {
  const { t } = useTranslation();
  const isEditMode = Boolean(requestId);

  const [isLoadingRequest, setIsLoadingRequest] = useState(isEditMode);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [flightNumber, setFlightNumber] = useState('');
  // Both are Barcelona wall-clock dates (see formatDateTime.ts): what the pickers show is the
  // time at the airport, whatever zone the phone is in.
  const [arrivalDate, setArrivalDate] = useState(() => toBarcelonaWallClock(new Date()));
  const [arrivalTime, setArrivalTime] = useState(() => toBarcelonaWallClock(new Date()));
  // The ride's terminal: from the flight data when it names one (not editable), otherwise from
  // the flight's airline (shown read-only, with a "Not correct?" link), otherwise the passenger's
  // own choice.
  const [flightTerminal, setFlightTerminal] = useState<ArrivalTerminal | null>(null);
  const [chosenTerminal, setChosenTerminal] = useState<ArrivalTerminal | null>(null);
  // Which airline lands at which terminal, and the airline the flight lookup says operates this
  // flight (on a codeshare not the one in the flight number).
  const [airlineRows, setAirlineRows] = useState<AirlineTerminalRow[]>([]);
  const [operatorIata, setOperatorIata] = useState<string | null>(null);
  // The passenger said the airline's terminal is not theirs: they choose instead.
  const [isAirlineTerminalRejected, setIsAirlineTerminalRejected] = useState(false);
  // Where the flight comes from, from the lookup: saved with the ride, for its ready time.
  const [flightOrigin, setFlightOrigin] = useState<{ iata: string | null; icao: string | null } | null>(null);
  // Without a flight number: "Do you still need to collect checked luggage?" Null until answered -
  // the answer shown then follows whether they travel with large luggage.
  const [luggageToCollectAnswer, setLuggageToCollectAnswer] = useState<boolean | null>(null);
  // The choice was prefilled from where the phone is, and the passenger hasn't changed it.
  const [isTerminalFromLocation, setIsTerminalFromLocation] = useState(false);
  const chosenTerminalRef = useRef(chosenTerminal);
  chosenTerminalRef.current = chosenTerminal;
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
  // True only when this session's flight lookup filled the time in - unlike hasFlightEstimate,
  // which is also true for an edit that loaded with the time pinned. Only feeds the admin-facing
  // arrival_time_source; no visible effect here.
  const [isArrivalFromLookup, setIsArrivalFromLookup] = useState(false);

  const loadExistingRequest = useCallback(async () => {
    if (!requestId) return;

    setLoadError(null);
    setIsLoadingRequest(true);
    const { data, error } = await fetchPassengerRequestById(requestId);
    setIsLoadingRequest(false);

    if (error || !data) {
      console.warn('fetchPassengerRequestById failed', error);
      setLoadError(t('newRequest.loadError'));
      return;
    }

    setFlightNumber(data.flight_number);
    const arrival = toBarcelonaWallClock(new Date(data.arrival_at));
    setArrivalDate(arrival);
    setArrivalTime(arrival);
    if (data.arrival_terminal_source === 'flight' && data.flight_number.trim()) {
      setFlightTerminal(data.arrival_terminal);
    } else {
      // Also for a terminal from the airline table: it is what the form falls back to.
      setChosenTerminal(data.arrival_terminal);
      // Their own choice stands, whatever the airline table says about the flight.
      setIsAirlineTerminalRejected(data.arrival_terminal_source === 'passenger');
    }
    setFlightOrigin(data.flight_origin_icao ? { iata: data.flight_origin_iata, icao: data.flight_origin_icao } : null);
    setLuggageToCollectAnswer(data.luggage_to_collect);
    // Same rule as a fresh flight lookup: a flight number present on the stored ride means the
    // arrival time came from (or should stay pinned to) that flight, so it loads read-only.
    setHasFlightEstimate(Boolean(data.flight_number.trim()));
    setDestinationAddress(data.destination_address);
    if (data.destination_lat != null && data.destination_lng != null) {
      setSelectedPlace({
        formattedAddress: data.destination_address,
        lat: data.destination_lat,
        lng: data.destination_lng,
      });
    }
    setLargeLuggageCount(data.large_luggage_count);
    setHandLuggageCount(data.hand_luggage_count);
    setMaxWaitMinutes(String(data.max_wait_minutes));
  }, [requestId, t]);

  useEffect(() => {
    loadExistingRequest();
  }, [loadExistingRequest]);

  // Without the table the form still works: the passenger chooses the terminal.
  useEffect(() => {
    let cancelled = false;
    fetchAirlineTerminals().then(({ data, error }) => {
      if (error) console.warn('fetchAirlineTerminals failed', error);
      if (!cancelled && data) setAirlineRows(data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Shown preselected from their large luggage until they answer it themselves.
  const luggageToCollect = luggageToCollectAnswer ?? largeLuggageCount > 0;

  // The terminal of the flight's airline, known the moment the flight number is typed.
  const airlineRow = airlineTerminal(airlineRows, [operatorIata, airlineCodeOf(flightNumber)]);
  const airlineTerminalShown = !flightTerminal && airlineRow && !isAirlineTerminalRejected ? airlineRow.terminal : null;

  // The form's date and time as one Barcelona wall-clock date.
  const arrivalWallClock = () => {
    const wallClock = new Date(arrivalDate);
    wallClock.setHours(arrivalTime.getHours(), arrivalTime.getMinutes(), 0, 0);
    return wallClock;
  };

  // A new ride for a passenger who is standing in a terminal right now: prefill it (still theirs
  // to change). Never asks for the location permission - see terminalGeofence.ts.
  useEffect(() => {
    if (isEditMode) return;
    let cancelled = false;
    detectTerminalFromLocation().then((terminal) => {
      // The passenger may have chosen one themselves while the position was being read.
      if (cancelled || !terminal || chosenTerminalRef.current) return;
      setChosenTerminal(terminal);
      setIsTerminalFromLocation(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isEditMode]);

  // Being in a terminal now says nothing about a ride that lands another day: the prefill is
  // dropped again once the arrival moves out of the window around now.
  const arrivalWallMs = arrivalWallClock().getTime();
  useEffect(() => {
    if (!isTerminalFromLocation) return;
    const hoursFromNow = Math.abs(arrivalWallMs - toBarcelonaWallClock(new Date()).getTime()) / 3_600_000;
    if (hoursFromNow > TERMINAL_PREFILL_WINDOW_HOURS) {
      setChosenTerminal(null);
      setIsTerminalFromLocation(false);
    }
  }, [arrivalWallMs, isTerminalFromLocation]);

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

    const lookup = await fetchFlightLookup(flightNumber, fromBarcelonaWallClock(arrivalWallClock()));
    setIsLookingUpFlight(false);

    setOperatorIata(lookup?.operatorIata ?? null);
    setFlightOrigin(lookup?.originIcao ? { iata: lookup.originIata, icao: lookup.originIcao } : null);
    // Null when the flight data names no terminal yet: the airline's terminal (or the passenger's
    // choice) stands until the flight's own terminal is known.
    setFlightTerminal(lookup?.flightTerminal ?? null);

    if (!lookup?.estimatedLandingAt) {
      setHasFlightEstimate(false);
      setIsArrivalFromLookup(false);
      // A flight further ahead than flight data reaches is known, but not yet for that day: the
      // date and time stay as the passenger set them.
      setFlightLookupNote(t(lookup?.flightKnown ? 'newRequest.flightLookupNoTimeYet' : 'newRequest.flightLookupNotFound'));
      return;
    }

    const landing = toBarcelonaWallClock(lookup.estimatedLandingAt);
    setArrivalDate(landing);
    setArrivalTime(landing);
    setHasFlightEstimate(true);
    setIsArrivalFromLookup(true);
    setFlightLookupNote(
      t('newRequest.flightLookupFound', {
        time: landing.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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

    // The flight number is optional (a passenger already at the airport, or who doesn't know it).
    if (!destinationAddress.trim()) {
      setErrorMessage(t('newRequest.missingFieldsError'));
      return;
    }
    const arrivalTerminal = flightTerminal ?? airlineTerminalShown ?? chosenTerminal;
    if (!arrivalTerminal) {
      setErrorMessage(t('newRequest.terminalRequiredError'));
      return;
    }
    if (Number.isNaN(maxWait) || maxWait < 0) {
      setErrorMessage(t('newRequest.invalidNumberError'));
      return;
    }

    const arrivalAt = fromBarcelonaWallClock(arrivalWallClock());

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

    const hasFlightNumber = flightNumber.trim() !== '';
    const payload = {
      flightNumber: flightNumber.trim(),
      flightOriginIata: hasFlightNumber ? (flightOrigin?.iata ?? null) : null,
      flightOriginIcao: hasFlightNumber ? (flightOrigin?.icao ?? null) : null,
      luggageToCollect: hasFlightNumber ? null : luggageToCollect,
      arrivalTerminal,
      arrivalTerminalSource: flightTerminal
        ? ('flight' as const)
        : airlineTerminalShown
          ? ('airline' as const)
          : ('passenger' as const),
      arrivalAt,
      destinationAddress: destinationAddress.trim(),
      destinationLat: resolvedDestination.lat,
      destinationLng: resolvedDestination.lng,
      largeLuggageCount,
      handLuggageCount,
      maxWaitMinutes: maxWait,
      // Pinned-but-not-re-looked-up (edit mode) sends undefined so the stored source is kept.
      arrivalTimeSource: isArrivalFromLookup
        ? ('flight' as const)
        : hasFlightEstimate
          ? undefined
          : ('manual' as const),
    };

    if (isEditMode && requestId) {
      const { error, blockedReason } = await updatePassengerRequest(requestId, payload);
      setIsSubmitting(false);

      if (blockedReason === 'group_confirmed') {
        setErrorMessage(t('edit_locked_group_message'));
        return;
      }
      if (blockedReason === 'date_of_birth_required' || blockedReason === 'under_age') {
        setErrorMessage(t(blockedReason === 'under_age' ? 'dateOfBirth.underAge' : 'dateOfBirth.requiredForRide'));
        return;
      }
      if (error) {
        console.warn('updatePassengerRequest failed', error);
        setErrorMessage(t('newRequest.updateError'));
        return;
      }
    } else {
      const { error } = await createPassengerRequest(payload);
      setIsSubmitting(false);

      if (error) {
        console.warn('createPassengerRequest failed', error);
        // The insert triggers caught what the app's own checks missed: the one-active-ride rule
        // (e.g. a ride created from another device in the meantime), a verified email, the age rule.
        const ageRule = ageRuleErrorOf(error);
        const messageKey =
          ageRule === 'under_age'
            ? 'dateOfBirth.underAge'
            : ageRule === 'date_of_birth_required'
              ? 'dateOfBirth.requiredForRide'
              : isActiveRideExistsError(error)
                ? 'active_ride_exists'
                : isEmailNotVerifiedError(error)
                  ? 'auth.emailNotVerifiedError'
                  : 'newRequest.submitError';
        setErrorMessage(t(messageKey));
        return;
      }
    }

    Alert.alert(t(isEditMode ? 'newRequest.updateSuccessTitle' : 'newRequest.successTitle'));
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
      <Text style={styles.title}>{t(isEditMode ? 'edit_ride_title' : 'newRequest.title')}</Text>

      {loadError ? (
        <ErrorNotice message={loadError} onRetry={loadExistingRequest} retryLabel={t('common.retry')} />
      ) : isLoadingRequest ? (
        <View accessible accessibilityLabel={t('admin.loading')}>
          <Skeleton width="50%" height={16} style={styles.skeletonGap} />
          <Skeleton width="100%" height={52} radius={radii.lg} style={styles.skeletonGap} />
          <Skeleton width="50%" height={16} style={styles.skeletonGap} />
          <Skeleton width="100%" height={52} radius={radii.lg} style={styles.skeletonGap} />
          <Skeleton width="50%" height={16} style={styles.skeletonGap} />
          <Skeleton width="100%" height={52} radius={radii.lg} style={styles.skeletonGap} />
          <Skeleton width="50%" height={16} style={styles.skeletonGap} />
          <Skeleton width="100%" height={90} radius={radii.lg} style={styles.skeletonGap} />
          <Skeleton width="100%" height={52} radius={radii.lg} />
        </View>
      ) : (
      <>
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
          setIsArrivalFromLookup(false);
          setFlightTerminal(null);
          setOperatorIata(null);
          setFlightOrigin(null);
          setIsAirlineTerminalRejected(false);
        }}
        onBlur={handleFlightNumberBlur}
        autoCapitalize="characters"
        helperText={t('newRequest.flightNumberHelper')}
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
            onPress={() => {
              const now = toBarcelonaWallClock(new Date());
              setArrivalDate(now);
              setArrivalTime(now);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('newRequest.nowButtonLabel')}
          >
            <Text style={styles.nowButtonLabel}>{t('newRequest.nowButtonLabel')}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.flightLookupNote}>
        {hasFlightEstimate
          ? t('newRequest.arrivalTimeAutoNote', { flightNumber: flightNumber.trim() })
          : t('newRequest.barcelonaTimeNote')}
      </Text>
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

      <Text style={styles.label}>{t('newRequest.terminalLabel')}</Text>
      {flightTerminal ? (
        <>
          <View style={[styles.pickerField, styles.pickerFieldDisabled]}>
            <Ionicons name="business-outline" size={20} color={colors.textDisabled} />
            <Text style={[styles.pickerValue, styles.pickerValueDisabled]}>
              {t(`newRequest.terminal.${flightTerminal}`)}
            </Text>
          </View>
          <Text style={styles.flightLookupNote}>
            {t('newRequest.terminalFromFlightNote', { flightNumber: flightNumber.trim() })}
          </Text>
        </>
      ) : airlineTerminalShown ? (
        <>
          <View style={[styles.pickerField, styles.pickerFieldDisabled]}>
            <Ionicons name="business-outline" size={20} color={colors.textDisabled} />
            <Text style={[styles.pickerValue, styles.pickerValueDisabled]}>
              {t(`newRequest.arrivingAt.${airlineTerminalShown}`)}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              // With two terminals, "not this one" is most likely the other: preselected, and
              // theirs to change.
              setIsAirlineTerminalRejected(true);
              setChosenTerminal(airlineTerminalShown === 'T1' ? 'T2' : 'T1');
              setIsTerminalFromLocation(false);
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={t('newRequest.terminalNotCorrect')}
          >
            <Text style={styles.notCorrectText}>{t('newRequest.terminalNotCorrect')}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={styles.terminalRow} accessibilityRole="radiogroup" accessibilityLabel={t('newRequest.terminalLabel')}>
            {ARRIVAL_TERMINALS.map((terminal) => {
              const isSelected = chosenTerminal === terminal;
              return (
                <Pressable
                  key={terminal}
                  style={[styles.terminalOption, isSelected && styles.terminalOptionSelected]}
                  onPress={() => {
                    setChosenTerminal(terminal);
                    setIsTerminalFromLocation(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={t(`newRequest.terminal.${terminal}`)}
                >
                  <Text style={[styles.terminalOptionLabel, isSelected && styles.terminalOptionLabelSelected]}>
                    {t(`newRequest.terminal.${terminal}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.flightLookupNote}>
            {t(isTerminalFromLocation ? 'newRequest.terminalFromLocationNote' : 'newRequest.terminalHelper')}
          </Text>
        </>
      )}

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

      {/* Only without a flight number: with one, the flight and the large luggage say how long
          the passenger needs before they can leave. */}
      {flightNumber.trim() === '' ? (
        <>
          <Text style={styles.label}>{t('newRequest.luggageToCollectLabel')}</Text>
          <View
            style={styles.terminalRow}
            accessibilityRole="radiogroup"
            accessibilityLabel={t('newRequest.luggageToCollectLabel')}
          >
            {[true, false].map((answer) => {
              const isSelected = luggageToCollect === answer;
              const label = t(answer ? 'newRequest.luggageToCollectYes' : 'newRequest.luggageToCollectNo');
              return (
                <Pressable
                  key={String(answer)}
                  style={[styles.terminalOption, isSelected && styles.terminalOptionSelected]}
                  onPress={() => setLuggageToCollectAnswer(answer)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={label}
                >
                  <Text style={[styles.terminalOptionLabel, isSelected && styles.terminalOptionLabelSelected]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

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

      <PrimaryButton
        label={t(isEditMode ? 'save_changes' : 'newRequest.submit')}
        onPress={handleSubmit}
        loading={isSubmitting}
      />
      </>
      )}

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
  skeletonGap: {
    marginBottom: spacing.x4,
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
  terminalRow: {
    flexDirection: 'row',
    gap: spacing.x3,
    marginBottom: spacing.x4,
  },
  terminalOption: {
    flex: 1,
    minHeight: 52,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.resting,
  },
  terminalOptionSelected: {
    borderColor: colors.accentPrimary,
    backgroundColor: colors.accentPrimarySoft,
  },
  terminalOptionLabel: {
    ...baseText.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  terminalOptionLabelSelected: {
    color: colors.textPrimary,
  },
  notCorrectText: {
    ...baseText.caption,
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
    marginTop: -spacing.x2,
    marginBottom: spacing.x4,
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
