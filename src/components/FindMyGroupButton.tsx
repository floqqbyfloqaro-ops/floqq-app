import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Animated, StyleSheet, Text, View } from 'react-native';

import { fetchMeetup, Meetup } from '../services/findGroup';
import { findGroupEntryState } from '../services/findGroupEntryRules';
import { subscribeToRide } from '../services/matchOffer';
import { meetingPointText, wordingLanguageFor } from '../services/meetingPointRules';
import { shippedText } from '../services/meetingPoints';
import { MyPassengerRequest } from '../services/passengerRequests';
import { baseText, colors, motion, spacing } from '../theme/colors';
import { easingStandard } from '../utils/animation';
import { barcelonaDateParts } from '../utils/formatDateTime';
import PrimaryButton from './PrimaryButton';

type Props = {
  request: MyPassengerRequest;
  onPress: () => void;
};

// How often the group is re-read on top of the live updates, and how often the clock-driven part
// (has the passenger landed?) is refreshed.
const RECHECK_MS = 30_000;
const CLOCK_TICK_MS = 10_000;

// One beat of the pulse, there or back.
const PULSE_MS = motion.durationSlow * 3;

// "T1" -> "1", "T2B" -> "2B": the part that follows the word "Terminal".
const terminalNumber = (terminal: string) => terminal.replace(/^T/, '');

// "Find my group": the main action of a confirmed group, opening the meetup screen. Renders
// nothing while there is no confirmed group to find or once the ride has started
// (findGroupEntryRules.ts). Once the passenger has landed it says so and pulses gently.
export default function FindMyGroupButton({ request, onPress }: Props) {
  const { t, i18n } = useTranslation();
  const [meetup, setMeetup] = useState<Meetup | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [reduceMotion, setReduceMotion] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    const { meetup: next, error } = await fetchMeetup(request.id);
    if (error) {
      console.warn('fetchMeetup failed', error);
      return;
    }
    setMeetup(next);
  }, [request.id]);

  useEffect(() => {
    load();
    const unsubscribe = subscribeToRide('findgroupentry', request.id, request.group_id, load);
    const timer = setInterval(load, RECHECK_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [load, request.id, request.group_id]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => {});
  }, []);

  const state = findGroupEntryState(meetup, now);
  const isPulsing = state === 'landed' && !reduceMotion;

  useEffect(() => {
    if (!isPulsing) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, easing: easingStandard, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: PULSE_MS, easing: easingStandard, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [isPulsing, pulse]);

  if (state === 'hidden' || !meetup) return null;

  const point = meetup.meetingPoint;
  const terminal = point?.terminal ?? meetup.terminal;
  const { hour, minute } = barcelonaDateParts(meetup.meetingTime);
  const time = `${hour}:${minute}`;
  const pointName = point ? meetingPointText(point, 'name', wordingLanguageFor(i18n.language), shippedText) : null;
  const helper = terminal
    ? pointName
      ? t('find_my_group_helper', { terminal: terminalNumber(terminal), name: pointName, time })
      : t('find_my_group_helper_terminal', { terminal: terminalNumber(terminal), time })
    : t('find_my_group_helper_time', { time });

  return (
    <View>
      {state === 'landed' ? (
        <Text style={styles.landed} accessibilityLiveRegion="polite">
          {t('find_my_group_landed')}
        </Text>
      ) : null}
      <Animated.View
        style={{ transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] }) }] }}
      >
        <PrimaryButton label={t('find_my_group_button')} onPress={onPress} />
      </Animated.View>
      <Text style={styles.helper}>{helper}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  landed: {
    ...baseText.bodySmall,
    color: colors.success,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.x2,
  },
  helper: {
    ...baseText.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    // The button brings its own space below it; the helper belongs right under the button.
    marginTop: -spacing.x3,
  },
});
