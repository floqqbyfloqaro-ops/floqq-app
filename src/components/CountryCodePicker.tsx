import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CountryCode } from 'libphonenumber-js';

import { PhoneCountry, phoneCountries } from '../services/phoneRules';
import { baseText, borders, colors, radii, spacing } from '../theme/colors';
import AuthTextInput from './AuthTextInput';

type Props = {
  value: CountryCode;
  onChange: (code: CountryCode) => void;
};

// The country code in front of the call-back number: a button with flag and code, and a
// searchable list (by country code such as "FR", or dial code such as "+33").
export default function CountryCodePicker({ value, onChange }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const countries = useMemo(phoneCountries, []);
  const selected = countries.find((country) => country.code === value) ?? countries[0];

  const shown = useMemo(() => {
    const q = query.trim().toUpperCase().replace(/^\+/, '');
    if (!q) return countries;
    return countries.filter((country) => country.code.includes(q) || country.dialCode.slice(1).startsWith(q));
  }, [countries, query]);

  const choose = (country: PhoneCountry) => {
    onChange(country.code);
    setOpen(false);
    setQuery('');
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel={t('help.countryCodeLabel', { code: selected.code, dialCode: selected.dialCode })}
      >
        <Text style={styles.buttonText}>
          {selected.flag} {selected.dialCode}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
      </Pressable>
      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle} accessibilityRole="header">
                {t('help.countryCodeTitle')}
              </Text>
              <Pressable onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel={t('help.close')} hitSlop={12}>
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </Pressable>
            </View>
            <AuthTextInput
              variant="card"
              leadingIcon="search"
              placeholder={t('help.countryCodeSearch')}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <FlatList
              data={shown}
              keyExtractor={(country) => country.code}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => choose(item)}
                  style={[styles.row, item.code === value && styles.rowSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: item.code === value }}
                  accessibilityLabel={`${item.code} ${item.dialCode}`}
                >
                  <Text style={styles.rowText}>
                    {item.flag}  {item.code}
                  </Text>
                  <Text style={styles.rowDial}>{item.dialCode}</Text>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x1,
    minHeight: 52,
    paddingHorizontal: spacing.x3,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCard,
  },
  buttonText: {
    ...baseText.body,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.bgPrimary,
  },
  sheet: {
    flex: 1,
    paddingTop: spacing.x12,
    paddingHorizontal: spacing.x6,
    backgroundColor: colors.bgElevated,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.x4,
  },
  sheetTitle: {
    ...baseText.h3,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.x3,
    paddingHorizontal: spacing.x2,
    borderBottomWidth: borders.hairline,
    borderBottomColor: colors.borderSubtle,
  },
  rowSelected: {
    backgroundColor: colors.accentPrimarySoft,
  },
  rowText: {
    ...baseText.body,
  },
  rowDial: {
    ...baseText.body,
    color: colors.textSecondary,
  },
});
