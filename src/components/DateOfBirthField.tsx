import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { CalendarDate, parseIsoDate, toIsoDate } from '../services/profileRules';
import { baseText, borders, colors, elevation, radii, spacing } from '../theme/colors';
import AuthTextInput from './AuthTextInput';

type Props = {
  // 'YYYY-MM-DD', or null while nothing is chosen.
  value: string | null;
  onChange: (isoDate: string | null) => void;
  errorText?: string;
};

// Where the picker opens when nothing is chosen yet: a plausible adult's birthday, not today.
const PICKER_START = new Date(Date.UTC(1995, 0, 1));
const EARLIEST = new Date(Date.UTC(1900, 0, 1));

// A date of birth, written the way the passenger's language writes dates (Intl, in UTC so no time
// zone can move it to the day before).
export function formatDateOfBirth(isoDate: string, language: string) {
  return new Intl.DateTimeFormat(language, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${isoDate}T00:00:00Z`));
}

// The order the passenger's language writes day, month and year in (for the web, which has no
// date picker): "22/10/2008" in French and Spanish, "10/22/2008" in US English.
function fieldOrder(language: string): ('day' | 'month' | 'year')[] {
  const parts = new Intl.DateTimeFormat(language, { day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(
    new Date(Date.UTC(2008, 9, 22))
  );
  const order = parts.map((p) => p.type).filter((type): type is 'day' | 'month' | 'year' => ['day', 'month', 'year'].includes(type));
  return order.length === 3 ? order : ['day', 'month', 'year'];
}

// The date of birth input: the phone's own date picker, in the passenger's language. On the web
// (no native picker) three small fields - day, month, year - in that language's order.
export default function DateOfBirthField({ value, onChange, errorText }: Props) {
  const { t, i18n } = useTranslation();
  const [showPicker, setShowPicker] = useState(false);
  const parsed = value ? parseIsoDate(value) : null;

  const [webParts, setWebParts] = useState<Record<'day' | 'month' | 'year', string>>({
    day: parsed ? String(parsed.day) : '',
    month: parsed ? String(parsed.month) : '',
    year: parsed ? String(parsed.year) : '',
  });

  if (Platform.OS === 'web') {
    const update = (part: 'day' | 'month' | 'year', text: string) => {
      const next = { ...webParts, [part]: text.replace(/\D/g, '') };
      setWebParts(next);
      const candidate: CalendarDate = { year: Number(next.year), month: Number(next.month), day: Number(next.day) };
      onChange(next.year.length === 4 && next.month && next.day ? (parseIsoDate(toIsoDate(candidate)) ? toIsoDate(candidate) : null) : null);
    };
    return (
      <View>
        <View style={styles.webRow}>
          {fieldOrder(i18n.language).map((part) => (
            <View key={part} style={part === 'year' ? styles.webYear : styles.webPart}>
              <AuthTextInput
                placeholder={t(`dateOfBirth.${part}`)}
                accessibilityLabel={`${t('dateOfBirth.label')}: ${t(`dateOfBirth.${part}`)}`}
                value={webParts[part]}
                onChangeText={(text) => update(part, text)}
                keyboardType="number-pad"
                maxLength={part === 'year' ? 4 : 2}
              />
            </View>
          ))}
        </View>
        {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
      </View>
    );
  }

  const handleChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') setShowPicker(false);
    if (event.type === 'set' && selected) {
      // The picker hands back a moment; only its calendar day counts.
      onChange(toIsoDate({ year: selected.getFullYear(), month: selected.getMonth() + 1, day: selected.getDate() }));
    }
  };

  const pickerValue = parsed ? new Date(parsed.year, parsed.month - 1, parsed.day) : PICKER_START;

  return (
    <View>
      <Pressable
        style={[styles.field, errorText ? styles.fieldError : null]}
        onPress={() => setShowPicker(true)}
        accessibilityRole="button"
        accessibilityLabel={`${t('dateOfBirth.label')}: ${value ? formatDateOfBirth(value, i18n.language) : t('dateOfBirth.choose')}`}
      >
        <Ionicons name="calendar-outline" size={20} color={colors.textSecondary} />
        <Text style={value ? styles.value : styles.placeholder}>
          {value ? formatDateOfBirth(value, i18n.language) : t('dateOfBirth.choose')}
        </Text>
      </Pressable>
      {showPicker ? (
        <>
          <DateTimePicker
            value={pickerValue}
            mode="date"
            display={Platform.OS === 'ios' ? 'spinner' : 'default'}
            maximumDate={new Date()}
            minimumDate={EARLIEST}
            locale={i18n.language}
            onChange={handleChange}
          />
          {Platform.OS === 'ios' ? (
            <Pressable
              onPress={() => {
                // Closing without turning the wheel keeps what it shows.
                if (!value) onChange(toIsoDate({ year: pickerValue.getFullYear(), month: pickerValue.getMonth() + 1, day: pickerValue.getDate() }));
                setShowPicker(false);
              }}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
            >
              <Text style={styles.done}>{t('newRequest.done')}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.x4,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCard,
    gap: spacing.x3,
    marginBottom: spacing.x2,
    ...elevation.resting,
  },
  fieldError: {
    borderColor: colors.dangerStrong,
  },
  value: {
    ...baseText.body,
  },
  placeholder: {
    ...baseText.body,
    color: colors.textSecondary,
  },
  done: {
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
    textAlign: 'center',
    marginBottom: spacing.x4,
  },
  error: {
    ...baseText.bodySmall,
    color: colors.dangerStrong,
    marginBottom: spacing.x3,
  },
  webRow: {
    flexDirection: 'row',
    gap: spacing.x3,
  },
  webPart: {
    flex: 1,
  },
  webYear: {
    flex: 1.5,
  },
});
