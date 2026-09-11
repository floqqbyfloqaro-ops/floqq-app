import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import PrimaryButton from '../components/PrimaryButton';
import { createPassengerRequest } from '../services/passengerRequests';
import { colors } from '../theme/colors';

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

  const handleDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (event.type === 'set' && selectedDate) {
      setArrivalDate(selectedDate);
    }
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
    const { error } = await createPassengerRequest({
      flightNumber: flightNumber.trim(),
      arrivalAt,
      destinationAddress: destinationAddress.trim(),
      bagsCount: bags,
      maxWaitMinutes: maxWait,
    });
    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    Alert.alert(t('newRequest.successTitle'));
    onSubmitted();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{t('newRequest.title')}</Text>

      <Text style={styles.label}>{t('newRequest.flightNumberLabel')}</Text>
      <AuthTextInput
        placeholder={t('newRequest.flightNumberPlaceholder')}
        value={flightNumber}
        onChangeText={setFlightNumber}
        autoCapitalize="characters"
      />

      <Text style={styles.label}>{t('newRequest.arrivalDateLabel')}</Text>
      <Pressable style={styles.pickerField} onPress={() => setShowDatePicker(true)}>
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
            <Pressable onPress={() => setShowDatePicker(false)}>
              <Text style={styles.doneText}>{t('newRequest.done')}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      <Text style={styles.label}>{t('newRequest.arrivalTimeLabel')}</Text>
      <Pressable style={styles.pickerField} onPress={() => setShowTimePicker(true)}>
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
            <Pressable onPress={() => setShowTimePicker(false)}>
              <Text style={styles.doneText}>{t('newRequest.done')}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      <Text style={styles.label}>{t('newRequest.destinationLabel')}</Text>
      <AuthTextInput
        placeholder={t('newRequest.destinationPlaceholder')}
        value={destinationAddress}
        onChangeText={setDestinationAddress}
      />

      <Text style={styles.label}>{t('newRequest.bagsLabel')}</Text>
      <AuthTextInput placeholder="1" value={bagsCount} onChangeText={setBagsCount} keyboardType="number-pad" />

      <Text style={styles.label}>{t('newRequest.maxWaitLabel')}</Text>
      <AuthTextInput
        placeholder="15"
        value={maxWaitMinutes}
        onChangeText={setMaxWaitMinutes}
        keyboardType="number-pad"
      />

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <PrimaryButton label={t('newRequest.submit')} onPress={handleSubmit} loading={isSubmitting} />

      <Pressable onPress={onCancel}>
        <Text style={styles.cancelText}>{t('newRequest.cancel')}</Text>
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
    padding: 24,
    paddingBottom: 48,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 24,
  },
  label: {
    color: colors.textSecondary,
    marginBottom: 8,
    fontSize: 13,
  },
  pickerField: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  pickerValue: {
    color: colors.text,
    fontSize: 16,
  },
  doneText: {
    color: colors.primary,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 16,
  },
  error: {
    color: colors.error,
    marginBottom: 16,
    textAlign: 'center',
  },
  cancelText: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 16,
  },
});
