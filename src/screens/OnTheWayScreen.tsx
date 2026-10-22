import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import Card from '../components/Card';
import Skeleton from '../components/Skeleton';
import { PAYMENTS_ENABLED } from '../constants';
import { fetchMatchOffer } from '../services/matchOffer';
import { shareInfoKey } from '../services/onTheWayRules';
import { formatCents } from '../services/payments';
import { baseText, borders, colors, radii, spacing } from '../theme/colors';

type Props = {
  requestId: string;
  // Back to the home screen; the ride stays reachable from My Ride.
  onBack: () => void;
  // The ride's normal card (for the payer: the taxi receipt).
  onShowDetails: () => void;
};

// The hero image's own proportions (1122 x 1402), shown a little shorter than that: its top part
// is the street ahead, its bottom fades into the screen.
const HERO_ASPECT = 1402 / 1122;
const HERO_VISIBLE = 0.82;

// "On the way": the group is in the taxi. Purely informative - FLOQQ doesn't deal with the taxi,
// so there is no arrival time, driver or plate, and nothing here uses the location, the compass or
// any other sensor (the meetup screen has stopped all of that when the ride started).
export default function OnTheWayScreen({ requestId, onBack, onShowDetails }: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const [shareCents, setShareCents] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // The estimated share, from the same fare split the "Match found" screen shows.
  useEffect(() => {
    let cancelled = false;
    fetchMatchOffer(requestId).then(({ offer, error }) => {
      if (cancelled) return;
      if (error) console.warn('fetchMatchOffer failed', error);
      setShareCents(offer?.myShareCents ?? null);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const heroHeight = width * HERO_ASPECT * HERO_VISIBLE;
  const infoKey = shareInfoKey(PAYMENTS_ENABLED);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={t('admin.back')}
            style={styles.backButton}
          >
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            {t('on_the_way_title')}
          </Text>
          <Text style={styles.subtitle}>{t('on_the_way_subtitle')}</Text>
        </View>

        <View style={[styles.hero, { height: heroHeight }]}>
          <Image
            source={require('../../assets/taxi-on-the-way.png')}
            style={styles.heroImage}
            resizeMode="cover"
            accessible={false}
          />
          {/* Fades into the screen above and below, so the image has no hard edges. */}
          <LinearGradient
            colors={[colors.bgPrimary, 'transparent']}
            locations={[0, 0.25]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <LinearGradient
            colors={['transparent', colors.bgPrimary]}
            locations={[0.55, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        </View>

        <View style={styles.cards}>
          <Card style={styles.card}>
            <Text style={styles.label}>{t('estimated_share')}</Text>
            {isLoading ? (
              <Skeleton width={120} height={34} style={styles.skeleton} />
            ) : (
              <Text style={styles.amount}>{shareCents != null ? `€${formatCents(shareCents)}` : t('matchFound.fareUnknown')}</Text>
            )}
            <Text style={styles.note}>{t('final_share_note')}</Text>
          </Card>

          <Card style={styles.card}>
            <View style={styles.infoRow}>
              <View style={styles.infoIcon}>
                <Ionicons
                  name={PAYMENTS_ENABLED ? 'shield-checkmark-outline' : 'calculator-outline'}
                  size={22}
                  color={colors.accentPrimaryStrong}
                />
              </View>
              <Text style={styles.infoText}>{t(infoKey)}</Text>
            </View>
          </Card>

          <Pressable
            onPress={onShowDetails}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            style={styles.detailsLink}
          >
            <Text style={styles.detailsText}>{t('on_the_way_details')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  content: {
    paddingTop: spacing.x12,
    paddingBottom: spacing.x12,
  },
  header: {
    paddingHorizontal: spacing.x6,
  },
  backButton: {
    alignSelf: 'flex-start',
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.x6,
  },
  title: {
    ...baseText.h1,
    marginBottom: spacing.x2,
  },
  subtitle: {
    ...baseText.body,
    color: colors.textSecondary,
  },
  hero: {
    width: '100%',
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  cards: {
    paddingHorizontal: spacing.x6,
    // The cards rise into the image's faded bottom, as in the reference.
    marginTop: -spacing.x12,
  },
  card: {
    marginBottom: spacing.x4,
  },
  label: {
    ...baseText.label,
    marginBottom: spacing.x1,
  },
  amount: {
    ...baseText.h1,
    marginBottom: spacing.x1,
  },
  skeleton: {
    marginBottom: spacing.x2,
  },
  note: {
    ...baseText.caption,
    color: colors.textSecondary,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.x3,
  },
  infoIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentPrimarySoft,
  },
  infoText: {
    ...baseText.bodySmall,
    flex: 1,
  },
  detailsLink: {
    alignSelf: 'center',
    marginTop: spacing.x2,
  },
  detailsText: {
    ...baseText.bodySmall,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
});
