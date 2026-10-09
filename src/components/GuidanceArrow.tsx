import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { HEADING_MIN_ACCURACY, HEADING_SMOOTHING } from '../constants';
import { arrowRotation, continuousRotation, smoothHeading } from '../services/guidanceRules';
import { baseText, borders, colors, elevation, motion, radii, spacing } from '../theme/colors';
import { easingStandard } from '../utils/animation';

type Props = {
  // Where the target lies from here: 0 = north, 90 = east.
  bearing: number;
};

// How long to wait for a first compass reading before saying there is none (a simulator, the web).
const NO_HEADING_AFTER_MS = 3000;

// The arrow to the meeting point: turned by where the target lies (bearing) minus where the phone
// points (the compass heading). The heading is smoothed, and the turn always takes the short way
// round, so the arrow never spins through 180 degrees when the heading crosses north. When the
// compass can't be trusted - it needs calibrating, or the phone has none - a short hint is shown
// instead of an arrow that may point the wrong way.
export default function GuidanceArrow({ bearing }: Props) {
  const { t } = useTranslation();
  const [isReliable, setIsReliable] = useState<boolean | null>(null);

  const rotation = useRef(new Animated.Value(0)).current;
  const currentRotation = useRef(0);
  const heading = useRef<number | null>(null);
  const bearingRef = useRef(bearing);
  bearingRef.current = bearing;

  const turnArrow = () => {
    if (heading.current == null) return;
    currentRotation.current = continuousRotation(
      currentRotation.current,
      arrowRotation(bearingRef.current, heading.current)
    );
    Animated.timing(rotation, {
      toValue: currentRotation.current,
      duration: motion.durationBase,
      easing: easingStandard,
      useNativeDriver: true,
    }).start();
  };
  const turnArrowRef = useRef(turnArrow);
  turnArrowRef.current = turnArrow;

  useEffect(() => {
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    const noHeading = setTimeout(() => {
      if (!cancelled && heading.current == null) setIsReliable(false);
    }, NO_HEADING_AFTER_MS);

    Location.watchHeadingAsync((reading) => {
      // True north when the phone can give it (it needs the location for that), else magnetic.
      const raw = reading.trueHeading >= 0 ? reading.trueHeading : reading.magHeading;
      const usable = raw >= 0 && reading.accuracy >= HEADING_MIN_ACCURACY;
      setIsReliable(usable);
      if (!usable) return;
      heading.current = smoothHeading(heading.current, raw, HEADING_SMOOTHING);
      turnArrowRef.current();
    })
      .then((started) => {
        if (cancelled) started.remove();
        else subscription = started;
      })
      .catch(() => {
        if (!cancelled) setIsReliable(false);
      });

    return () => {
      cancelled = true;
      clearTimeout(noHeading);
      subscription?.remove();
    };
  }, []);

  // The target moved on the compass rose (the passenger walked): turn without waiting for the
  // next compass reading.
  useEffect(() => {
    turnArrowRef.current();
  }, [bearing]);

  if (isReliable === false) {
    return (
      <View style={styles.hint} accessible accessibilityRole="text">
        <Ionicons name="compass-outline" size={40} color={colors.textSecondary} />
        <Text style={styles.hintText}>{t('guidance.calibrate')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.dial} accessible accessibilityRole="image" accessibilityLabel={t('guidance.arrowLabel')}>
      <Animated.View
        style={{
          transform: [
            {
              rotate: rotation.interpolate({ inputRange: [-36000, 36000], outputRange: ['-36000deg', '36000deg'] }),
            },
          ],
        }}
      >
        <Ionicons name="arrow-up" size={112} color={colors.accentPrimaryStrong} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dial: {
    width: 200,
    height: 200,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentPrimarySoft,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    ...elevation.raised,
  },
  hint: {
    width: 200,
    minHeight: 200,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.x3,
  },
  hintText: {
    ...baseText.bodySmall,
    textAlign: 'center',
  },
});
