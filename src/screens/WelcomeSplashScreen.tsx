import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, View } from 'react-native';

import ScreenBackground from '../components/ScreenBackground';
import { baseText, colors, overlays, spacing, typography } from '../theme/colors';

export default function WelcomeSplashScreen() {
  const { t } = useTranslation();

  return (
    <ScreenBackground
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={colors.transparent}
    >
      <View style={styles.outer}>
        <View style={styles.centerWrapper}>
          <LinearGradient
            colors={['transparent', overlays.scrimHeavy, 'transparent']}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.content}>
            <Image source={require('../../assets/icon-full.png')} style={styles.logo} resizeMode="contain" />

            <Text style={styles.wordmark}>FLOQQ</Text>

            <Text style={styles.tagline}>{t('splash.tagline')}</Text>

            <View style={styles.separatorRow}>
              <View style={styles.separatorLine} />
              <Text style={styles.separatorIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                ✈️
              </Text>
              <View style={styles.separatorLine} />
            </View>

            <Text style={styles.caption}>{t('splash.caption')}</Text>
          </View>
        </View>
      </View>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  outer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.x6,
    // Same safe-area clearance token used elsewhere, now on the bottom edge - keeps the block
    // clear of the home indicator while sitting in the photo's dark lower third.
    paddingBottom: spacing.x12,
  },
  centerWrapper: {
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    paddingVertical: spacing.x8,
    paddingHorizontal: spacing.x8,
  },
  logo: {
    width: 96,
    height: 96,
  },
  wordmark: {
    ...baseText.display,
    marginTop: spacing.x4,
    textAlign: 'center',
  },
  tagline: {
    ...typography.h3,
    color: colors.accentPrimaryStrong,
    textAlign: 'center',
    marginTop: spacing.x3,
  },
  separatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    marginTop: spacing.x8,
    gap: spacing.x3,
  },
  separatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: overlays.overlayWhite16,
  },
  separatorIcon: {
    fontSize: 16,
  },
  caption: {
    ...baseText.caption,
    textAlign: 'center',
    marginTop: spacing.x4,
  },
});
