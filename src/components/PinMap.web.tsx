import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { baseText, spacing } from '../theme/colors';
import AuthTextInput from './AuthTextInput';
import type { PinMapProps } from './PinMap';
import SecondaryButton from './SecondaryButton';

// react-native-maps has no web version: on the web the coordinates are typed in instead.
export default function PinMap({ value, onChange }: PinMapProps) {
  const { t } = useTranslation();
  const [latitude, setLatitude] = useState(value ? String(value.latitude) : '');
  const [longitude, setLongitude] = useState(value ? String(value.longitude) : '');

  const lat = Number(latitude.replace(',', '.'));
  const lng = Number(longitude.replace(',', '.'));
  const isValid =
    latitude.trim() !== '' && longitude.trim() !== '' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  return (
    <View>
      <Text style={styles.note}>{t('adminMeetingPoints.webMapNote')}</Text>
      <AuthTextInput
        placeholder={t('adminMeetingPoints.latitudeLabel')}
        value={latitude}
        onChangeText={setLatitude}
        keyboardType="numeric"
      />
      <AuthTextInput
        placeholder={t('adminMeetingPoints.longitudeLabel')}
        value={longitude}
        onChangeText={setLongitude}
        keyboardType="numeric"
      />
      <SecondaryButton
        label={t('adminMeetingPoints.setPin')}
        onPress={() => onChange({ latitude: lat, longitude: lng })}
        disabled={!isValid}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  note: {
    ...baseText.bodySmall,
    marginBottom: spacing.x3,
  },
});
