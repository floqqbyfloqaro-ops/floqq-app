import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';

import type { MapPoint } from '../services/matchOffer';
import { borders, colors, radii, spacing } from '../theme/colors';

export type RouteStop = MapPoint & {
  // The current passenger's own drop-off, drawn in the accent colour.
  isMe: boolean;
};

export type RouteMapProps = {
  // The drawn route: pickup first, last drop-off last.
  route: MapPoint[];
  pickup: MapPoint;
  stops: RouteStop[];
  height?: number;
};

// Google Maps (Android) takes a style sheet; Apple Maps (iPhone, in Expo Go) follows
// userInterfaceStyle instead. Colours are the theme's own background/surface tokens.
const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: colors.bgElevated }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: colors.textDisabled }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: colors.bgPrimary }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: colors.surfaceCardSolid }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: colors.borderSubtle }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: colors.bgPrimary }] },
];

const EDGE_PADDING = { top: spacing.x8, right: spacing.x8, bottom: spacing.x8, left: spacing.x8 };

// The planned taxi route on a small dark map: display only (it never moves or zooms), always
// fitted to the whole route. Touches pass through to the screen so it scrolls normally.
export default function RouteMap({ route, pickup, stops, height = 180 }: RouteMapProps) {
  const mapRef = useRef<MapView>(null);
  const everything = [pickup, ...route, ...stops];

  const fit = () => {
    mapRef.current?.fitToCoordinates(everything, { edgePadding: EDGE_PADDING, animated: false });
  };

  return (
    <View style={[styles.frame, { height }]} pointerEvents="none">
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: pickup.latitude,
          longitude: pickup.longitude,
          latitudeDelta: 0.3,
          longitudeDelta: 0.3,
        }}
        onMapReady={fit}
        onLayout={fit}
        userInterfaceStyle="dark"
        customMapStyle={DARK_MAP_STYLE}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Polyline coordinates={route} strokeColor={colors.accentPrimaryStrong} strokeWidth={4} />
        <Marker coordinate={pickup} anchor={{ x: 0.5, y: 0.5 }}>
          <View style={[styles.dot, styles.pickupDot]} />
        </Marker>
        {stops.map((stop, index) => (
          <Marker key={index} coordinate={stop} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={[styles.dot, stop.isMe ? styles.myDot : styles.otherDot]} />
          </Marker>
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceCardSolid,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: radii.pill,
    borderWidth: borders.regular * 2,
    borderColor: colors.white,
  },
  pickupDot: {
    backgroundColor: colors.accentGold,
  },
  myDot: {
    width: 20,
    height: 20,
    backgroundColor: colors.accentPrimary,
  },
  otherDot: {
    backgroundColor: colors.textSecondary,
  },
});
