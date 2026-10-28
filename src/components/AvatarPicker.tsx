import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { AVATARS } from '../avatars/registry';
import { colors, radii, spacing } from '../theme/colors';
import Avatar from './Avatar';

const COLUMNS = 4;
const GAP = spacing.x3;
// The selection ring sits outside the avatar, inside the tile.
const RING = 3;
const RING_GAP = 2;

type Props = {
  selectedId: number | null;
  onSelect: (avatarId: number) => void;
};

// The avatars in a grid of four per row (4 x 2 for eight). The chosen one gets the accent ring and
// a checkmark; a tap gives a light haptic. Used on the sign-up step and in the Profile sheet.
export default function AvatarPicker({ selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  const [width, setWidth] = useState(0);
  const tile = width > 0 ? Math.floor((width - GAP * (COLUMNS - 1)) / COLUMNS) : 0;
  const avatarSize = tile - 2 * (RING + RING_GAP);

  return (
    <View
      style={styles.grid}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {tile > 0
        ? AVATARS.map((avatar, index) => {
            const selected = avatar.id === selectedId;
            return (
              <Pressable
                key={avatar.id}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
                  onSelect(avatar.id);
                }}
                style={({ pressed }) => [
                  styles.tile,
                  { width: tile, height: tile },
                  selected && styles.tileSelected,
                  pressed && styles.tilePressed,
                ]}
                // "Avatar 3 of 8, selected": said in the label itself, the same on iOS and Android.
                accessibilityRole="button"
                accessibilityLabel={t(selected ? 'avatar.optionLabelSelected' : 'avatar.optionLabel', {
                  number: index + 1,
                  count: AVATARS.length,
                })}
              >
                <Avatar avatarId={avatar.id} size={avatarSize} />
                {selected ? (
                  <View style={styles.check}>
                    <Ionicons name="checkmark" size={14} color={colors.white} />
                  </View>
                ) : null}
              </Pressable>
            );
          })
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: RING,
    borderColor: colors.transparent,
  },
  tileSelected: {
    borderColor: colors.accentPrimary,
  },
  tilePressed: {
    transform: [{ scale: 0.96 }],
  },
  check: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 22,
    height: 22,
    borderRadius: radii.pill,
    backgroundColor: colors.accentPrimary,
    borderWidth: 2,
    borderColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
