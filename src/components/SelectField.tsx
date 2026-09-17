import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, Keyboard, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { baseText, borders, colors, elevation, overlays, radii, spacing } from '../theme/colors';

export type SelectOption<T extends string | number> = {
  label: string;
  value: T;
};

type Props<T extends string | number> = {
  accessibilityLabel: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  leadingIcon?: keyof typeof Ionicons.glyphMap;
};

// Card-styled dropdown trigger + modal option list, matching the existing date/time picker
// fields on this screen (same surfaceCard/border/radius tokens) since there's no picker
// library installed for a native <select> equivalent.
export default function SelectField<T extends string | number>({
  accessibilityLabel,
  value,
  options,
  onChange,
  leadingIcon,
}: Props<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <>
      <Pressable
        style={styles.trigger}
        onPress={() => {
          Keyboard.dismiss();
          setIsOpen(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${accessibilityLabel}: ${selected?.label ?? ''}`}
      >
        {leadingIcon ? <Ionicons name={leadingIcon} size={20} color={colors.textSecondary} /> : null}
        <Text style={styles.value}>{selected?.label}</Text>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setIsOpen(false)}>
          <View style={styles.sheet}>
            <FlatList
              data={options}
              keyExtractor={(option) => String(option.value)}
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <Pressable
                    style={styles.option}
                    onPress={() => {
                      onChange(item.value);
                      setIsOpen(false);
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>{item.label}</Text>
                    {isSelected ? <Ionicons name="checkmark" size={18} color={colors.accentPrimary} /> : null}
                  </Pressable>
                );
              }}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
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
  value: {
    ...baseText.body,
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: overlays.scrimMedium,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.x8,
  },
  sheet: {
    width: '100%',
    maxHeight: '60%',
    backgroundColor: colors.surfaceCardSolid,
    borderRadius: radii.xl,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    paddingVertical: spacing.x2,
    paddingHorizontal: spacing.x4,
    ...elevation.floating,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    borderBottomWidth: borders.hairline,
    borderBottomColor: colors.borderSubtle,
  },
  optionText: {
    ...baseText.body,
  },
  optionTextSelected: {
    color: colors.accentPrimary,
    fontWeight: '700',
  },
});
