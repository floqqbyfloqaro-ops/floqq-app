import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { AIRPORT } from '../constants';
import type { MapPoint } from '../services/matchOffer';
import { baseText, colors, overlays, radii, spacing } from '../theme/colors';

export type PinMapProps = {
  // Where the pin is; null while the point has no location yet.
  value: MapPoint | null;
  // The admin placed the pin by hand: a long-press on the map, or dragging the pin.
  onChange: (point: MapPoint) => void;
  height?: number;
};

// Close enough to tell one shop front from the next.
const PIN_DELTA = 0.0015;
const AIRPORT_DELTA = 0.03;

// A map to place one pin on: long-press to drop it, drag to adjust. Satellite view helps inside a
// terminal, where the street map shows little.
export default function PinMap({ value, onChange, height = 280 }: PinMapProps) {
  const { t } = useTranslation();
  const mapRef = useRef<MapView>(null);
  const [satellite, setSatellite] = useState(false);

  const latitude = value?.latitude;
  const longitude = value?.longitude;
  useEffect(() => {
    if (latitude == null || longitude == null) return;
    mapRef.current?.animateToRegion({ latitude, longitude, latitudeDelta: PIN_DELTA, longitudeDelta: PIN_DELTA });
  }, [latitude, longitude]);

  return (
    <View style={[styles.frame, { height }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: value?.latitude ?? AIRPORT.lat,
          longitude: value?.longitude ?? AIRPORT.lng,
          latitudeDelta: value ? PIN_DELTA : AIRPORT_DELTA,
          longitudeDelta: value ? PIN_DELTA : AIRPORT_DELTA,
        }}
        mapType={satellite ? 'hybrid' : 'standard'}
        userInterfaceStyle="dark"
        showsIndoors
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        onLongPress={(event) => onChange(event.nativeEvent.coordinate)}
      >
        {value ? (
          <Marker
            coordinate={value}
            draggable
            pinColor={colors.accentPrimary}
            onDragEnd={(event) => onChange(event.nativeEvent.coordinate)}
          />
        ) : null}
      </MapView>
      <Pressable
        style={styles.toggle}
        onPress={() => setSatellite((current) => !current)}
        accessibilityRole="button"
        accessibilityLabel={t(satellite ? 'adminMeetingPoints.mapStandard' : 'adminMeetingPoints.mapSatellite')}
      >
        <Text style={styles.toggleLabel}>
          {t(satellite ? 'adminMeetingPoints.mapStandard' : 'adminMeetingPoints.mapSatellite')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceCardSolid,
  },
  toggle: {
    position: 'absolute',
    top: spacing.x2,
    right: spacing.x2,
    paddingHorizontal: spacing.x3,
    paddingVertical: spacing.x2,
    borderRadius: radii.pill,
    backgroundColor: overlays.scrimHeavy,
  },
  toggleLabel: {
    ...baseText.label,
    color: colors.textPrimary,
  },
});
