import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInputProps, View } from 'react-native';

import {
  autocompletePlaces,
  generateSessionToken,
  getPlaceDetails,
  PlaceDetails,
  PlaceSuggestion,
} from '../services/placesAutocomplete';
import { baseText, borders, colors, elevation, radii, spacing } from '../theme/colors';
import AuthTextInput from './AuthTextInput';

const MIN_QUERY_LENGTH = 3;
const DEBOUNCE_MS = 300;

type Props = TextInputProps & {
  value: string;
  onChangeText: (text: string) => void;
  onSelectPlace: (details: PlaceDetails) => void;
  leadingIcon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel?: string;
};

// Wraps the existing card-styled text input with a Google Places Autocomplete suggestion list.
// Falls back gracefully to plain free-text entry if the Places lookup returns nothing (e.g. the
// key/API isn't enabled yet) - the caller still gets whatever the user types via onChangeText.
export default function PlaceAutocompleteInput({ value, onChangeText, onSelectPlace, ...props }: Props) {
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const sessionTokenRef = useRef(generateSessionToken());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChangeText = (text: string) => {
    onChangeText(text);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    if (text.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const results = await autocompletePlaces(text, sessionTokenRef.current);
      setSuggestions(results);
    }, DEBOUNCE_MS);
  };

  const handleSelect = async (suggestion: PlaceSuggestion) => {
    setSuggestions([]);
    const details = await getPlaceDetails(suggestion.placeId, sessionTokenRef.current);
    sessionTokenRef.current = generateSessionToken();

    if (!details) {
      return;
    }

    onChangeText(details.formattedAddress);
    onSelectPlace(details);
  };

  return (
    <View style={styles.wrapper}>
      <AuthTextInput
        variant="card"
        value={value}
        onChangeText={handleChangeText}
        {...props}
      />
      {suggestions.length > 0 ? (
        <View style={styles.suggestionsCard}>
          <FlatList
            data={suggestions}
            keyExtractor={(item) => item.placeId}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable style={styles.suggestionRow} onPress={() => handleSelect(item)} accessibilityRole="button">
                <Ionicons name="location-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.suggestionText} numberOfLines={2}>
                  {item.text}
                </Text>
              </Pressable>
            )}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    zIndex: 10,
  },
  suggestionsCard: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    maxHeight: 220,
    marginTop: -spacing.x2,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceCardSolid,
    ...elevation.floating,
    overflow: 'hidden',
    zIndex: 20,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
    minHeight: 48,
    paddingHorizontal: spacing.x4,
    borderBottomWidth: borders.hairline,
    borderBottomColor: colors.borderSubtle,
  },
  suggestionText: {
    ...baseText.bodySmall,
    color: colors.textPrimary,
    flex: 1,
  },
});
