import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { adminWordingLanguage, closePointWarnings } from '../components/AdminMeetingPoints';
import AuthTextInput from '../components/AuthTextInput';
import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import PinMap from '../components/PinMap';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import StatusPill from '../components/StatusPill';
import { MEETING_POINT_CAPTURE_MAX_ACCURACY_METERS, MEETING_POINT_MIN_SEPARATION_METERS } from '../constants';
import { pointsTooClose } from '../services/guidanceRules';
import {
  LocalizedText,
  MeetingPoint,
  MeetingPointLanguage,
  MEETING_POINT_LANGUAGES,
  meetingPointText,
  missingForActivation,
  missingForVerification,
  WordingField,
} from '../services/meetingPointRules';
import {
  fetchMeetingPoints,
  meetingPointPhotoUrl,
  MeetingPointPatch,
  removeMeetingPointPhoto,
  RESET_VERIFICATION,
  shippedText,
  updateMeetingPoint,
  uploadMeetingPointPhoto,
  verifiedByMe,
} from '../services/meetingPoints';
import { baseText, colors, overlays, radii, spacing } from '../theme/colors';
import { formatBarcelonaDateTime } from '../utils/formatDateTime';

type Props = {
  point: MeetingPoint;
  onBack: () => void;
};

// How long "Use my current location" listens to the GPS before keeping its most accurate reading:
// the first fix after opening the screen is often the worst one.
const CAPTURE_MS = 6000;

type Candidate = {
  latitude: number;
  longitude: number;
  // The GPS's own accuracy radius; null when the pin was placed by hand.
  accuracy: number | null;
};

type Wording = Record<MeetingPointLanguage, Record<WordingField, string>>;

function wordingOf(point: MeetingPoint): Wording {
  const wording = {} as Wording;
  for (const language of MEETING_POINT_LANGUAGES) {
    wording[language] = {
      name: meetingPointText(point, 'name', language, shippedText),
      directions: meetingPointText(point, 'directions', language, shippedText),
    };
  }
  return wording;
}

// Only what differs from the wording shipped with the app is stored; null when nothing does.
function overridesOf(wording: Wording, field: WordingField, key: string): LocalizedText | null {
  const overrides: LocalizedText = {};
  for (const language of MEETING_POINT_LANGUAGES) {
    const text = wording[language][field].trim();
    if (text && text !== shippedText(key, language)?.trim()) overrides[language] = text;
  }
  return Object.keys(overrides).length ? overrides : null;
}

// Admin "capture on site": everything about one meeting point, edited while standing at it - its
// coordinates (from the phone's GPS or a pin on the map), a photo from the direction passengers
// arrive, its wording per language, and the verification that lets it be activated.
export default function MeetingPointEditorScreen({ point: initialPoint, onBack }: Props) {
  const { t, i18n } = useTranslation();

  const [point, setPoint] = useState(initialPoint);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureAccuracy, setCaptureAccuracy] = useState<number | null>(null);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);
  const [photoNotice, setPhotoNotice] = useState<string | null>(null);
  const [wording, setWording] = useState(() => wordingOf(initialPoint));
  const [priority, setPriority] = useState(String(initialPoint.sort_priority));
  const [detailsSaved, setDetailsSaved] = useState(false);

  const save = async (key: string, patch: MeetingPointPatch) => {
    setBusy(key);
    setErrorMessage(null);
    const { data, error } = await updateMeetingPoint(point.id, patch);
    setBusy(null);
    if (error || !data) {
      console.warn('updateMeetingPoint failed', error);
      setErrorMessage(t('adminMeetingPoints.saveError'));
      return null;
    }
    setPoint(data);
    return data;
  };

  const handleCapture = async () => {
    setLocationNotice(null);
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') {
      setLocationNotice(t('adminMeetingPoints.locationDenied'));
      return;
    }

    setIsCapturing(true);
    setCaptureAccuracy(null);
    const reading: { best: Location.LocationObject | null } = { best: null };
    let subscription: Location.LocationSubscription | null = null;
    try {
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 500, distanceInterval: 0 },
        (location) => {
          const accuracy = location.coords.accuracy ?? Number.POSITIVE_INFINITY;
          if (!reading.best || accuracy <= (reading.best.coords.accuracy ?? Number.POSITIVE_INFINITY)) {
            reading.best = location;
            setCaptureAccuracy(location.coords.accuracy);
          }
        }
      );
      await new Promise((resolve) => setTimeout(resolve, CAPTURE_MS));
    } catch (err) {
      console.warn('meeting point location capture failed', err);
    } finally {
      subscription?.remove();
      setIsCapturing(false);
    }

    if (!reading.best) {
      setLocationNotice(t('adminMeetingPoints.locationUnavailable'));
      return;
    }
    setCandidate({
      latitude: reading.best.coords.latitude,
      longitude: reading.best.coords.longitude,
      accuracy: reading.best.coords.accuracy,
    });
  };

  const handleSaveLocation = async () => {
    if (!candidate) return;
    const saved = await save('location', {
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      ...RESET_VERIFICATION,
    });
    if (saved) setCandidate(null);
  };

  const handlePhoto = async (source: 'camera' | 'library') => {
    setPhotoNotice(null);
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setPhotoNotice(t('adminMeetingPoints.cameraDenied'));
        return;
      }
    }
    // base64: the photo's bytes come with the result, so the upload doesn't have to read the file.
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.6, base64: true };
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset?.base64) {
      setPhotoNotice(t('adminMeetingPoints.photoError'));
      return;
    }

    setBusy('photo');
    const upload = await uploadMeetingPointPhoto(point.short_code, asset.base64, asset.mimeType ?? null);
    if (upload.error || !upload.path) {
      setBusy(null);
      console.warn('uploadMeetingPointPhoto failed', upload.error);
      setPhotoNotice(t('adminMeetingPoints.photoError'));
      return;
    }
    const previousPath = point.photo_path;
    const saved = await save('photo', { photo_path: upload.path, ...RESET_VERIFICATION });
    if (saved && previousPath) removeMeetingPointPhoto(previousPath);
  };

  const handleSaveDetails = async () => {
    setDetailsSaved(false);
    const patch: MeetingPointPatch = {
      name_i18n: overridesOf(wording, 'name', point.name_key),
      directions_i18n: overridesOf(wording, 'directions', point.directions_key),
    };
    const parsedPriority = Number.parseInt(priority, 10);
    if (Number.isFinite(parsedPriority)) patch.sort_priority = parsedPriority;
    // An active point whose wording would no longer be complete stops being active.
    const after = { ...point, ...patch } as MeetingPoint;
    if (point.is_active && missingForActivation(after, shippedText).length > 0) patch.is_active = false;

    const saved = await save('details', patch);
    if (!saved) return;
    setWording(wordingOf(saved));
    setPriority(String(saved.sort_priority));
    setDetailsSaved(true);
  };

  const handleVerify = async () => {
    await save('verify', await verifiedByMe());
  };

  const setText = (language: MeetingPointLanguage, field: WordingField, text: string) => {
    setDetailsSaved(false);
    setWording((current) => ({ ...current, [language]: { ...current[language], [field]: text } }));
  };

  // Other active points in this terminal that lie too close to this one for the arrow to tell
  // them apart - checked against the point as it is stored now. A warning only.
  const [otherPoints, setOtherPoints] = useState<MeetingPoint[]>([]);
  useEffect(() => {
    fetchMeetingPoints().then(({ data }) => setOtherPoints((data ?? []).filter((other) => other.id !== initialPoint.id)));
  }, [initialPoint.id]);
  const closeWarnings = closePointWarnings(
    point.id,
    pointsTooClose([point, ...otherPoints], MEETING_POINT_MIN_SEPARATION_METERS),
    t
  );

  const missingToVerify = missingForVerification(point, shippedText);
  const missingToActivate = missingForActivation(point, shippedText);
  const missingLabel = (items: string[]) =>
    t('adminMeetingPoints.missing', {
      items: items.map((item) => t(`adminMeetingPoints.missingItem.${item}`)).join(', '),
    });

  const savedPin =
    point.latitude != null && point.longitude != null ? { latitude: point.latitude, longitude: point.longitude } : null;
  const pin = candidate ?? savedPin;
  const isPoorAccuracy = candidate?.accuracy != null && candidate.accuracy > MEETING_POINT_CAPTURE_MAX_ACCURACY_METERS;

  return (
    <ScreenBackground
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={overlays.scrimMedium}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('admin.back')}
        >
          <Text style={styles.backText}>{t('admin.back')}</Text>
        </Pressable>
        <Text style={styles.code}>
          {point.short_code} · {t('adminMeetingPoints.terminal', { terminal: point.terminal })}
        </Text>
        <Text style={styles.title}>
          {meetingPointText(point, 'name', adminWordingLanguage(i18n.language), shippedText) || point.short_code}
        </Text>

        {errorMessage ? <ErrorNotice message={errorMessage} /> : null}

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminMeetingPoints.locationTitle')}</Text>
          <Text style={styles.body}>
            {savedPin
              ? t('adminMeetingPoints.coordinates', {
                  latitude: savedPin.latitude.toFixed(6),
                  longitude: savedPin.longitude.toFixed(6),
                })
              : t('adminMeetingPoints.noLocation')}
          </Text>

          <View style={styles.gap}>
            <SecondaryButton
              label={t(candidate ? 'adminMeetingPoints.retake' : 'adminMeetingPoints.useCurrentLocation')}
              icon="locate-outline"
              onPress={handleCapture}
              loading={isCapturing}
            />
          </View>
          {isCapturing ? (
            <Text style={styles.hint}>
              {captureAccuracy != null
                ? t('adminMeetingPoints.capturingAccuracy', { meters: Math.round(captureAccuracy) })
                : t('adminMeetingPoints.capturing')}
            </Text>
          ) : null}
          {locationNotice ? <Text style={styles.warning}>{locationNotice}</Text> : null}

          <PinMap value={pin} onChange={(placed) => setCandidate({ ...placed, accuracy: null })} />
          <Text style={styles.hint}>{t('adminMeetingPoints.mapHint')}</Text>

          {candidate ? (
            <View style={styles.candidate}>
              <Text style={styles.body}>
                {t('adminMeetingPoints.coordinates', {
                  latitude: candidate.latitude.toFixed(6),
                  longitude: candidate.longitude.toFixed(6),
                })}
              </Text>
              <Text style={isPoorAccuracy ? styles.warning : styles.hint}>
                {candidate.accuracy == null
                  ? t('adminMeetingPoints.placedByHand')
                  : isPoorAccuracy
                    ? t('adminMeetingPoints.accuracyPoor', {
                        meters: Math.round(candidate.accuracy),
                        limit: MEETING_POINT_CAPTURE_MAX_ACCURACY_METERS,
                      })
                    : t('adminMeetingPoints.accuracy', { meters: Math.round(candidate.accuracy) })}
              </Text>
              {point.verified_at ? <Text style={styles.hint}>{t('adminMeetingPoints.resetsVerification')}</Text> : null}
              <View style={styles.gap}>
                <PrimaryButton
                  label={t('adminMeetingPoints.saveLocation')}
                  onPress={handleSaveLocation}
                  loading={busy === 'location'}
                />
              </View>
              <SecondaryButton label={t('adminMeetingPoints.discard')} onPress={() => setCandidate(null)} />
            </View>
          ) : null}
        </Card>

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminMeetingPoints.photoTitle')}</Text>
          {point.photo_path ? (
            <Image
              source={{ uri: meetingPointPhotoUrl(point.photo_path) }}
              style={styles.photo}
              resizeMode="cover"
              accessibilityLabel={t('adminMeetingPoints.photoTitle')}
            />
          ) : (
            <Text style={styles.body}>{t('adminMeetingPoints.noPhoto')}</Text>
          )}
          <Text style={styles.hint}>{t('adminMeetingPoints.photoHint')}</Text>
          {point.verified_at ? <Text style={styles.hint}>{t('adminMeetingPoints.resetsVerification')}</Text> : null}
          {photoNotice ? <Text style={styles.warning}>{photoNotice}</Text> : null}
          <View style={styles.gap}>
            <SecondaryButton
              label={t('adminMeetingPoints.takePhoto')}
              icon="camera-outline"
              onPress={() => handlePhoto('camera')}
              loading={busy === 'photo'}
            />
          </View>
          <SecondaryButton
            label={t('adminMeetingPoints.choosePhoto')}
            icon="image-outline"
            onPress={() => handlePhoto('library')}
            disabled={busy === 'photo'}
          />
        </Card>

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminMeetingPoints.wordingTitle')}</Text>
          {MEETING_POINT_LANGUAGES.map((language) => (
            <View key={language}>
              <Text style={styles.languageLabel}>{t(`adminMeetingPoints.language.${language}`)}</Text>
              <AuthTextInput
                placeholder={t('adminMeetingPoints.nameLabel')}
                accessibilityLabel={`${t(`adminMeetingPoints.language.${language}`)}: ${t('adminMeetingPoints.nameLabel')}`}
                value={wording[language].name}
                onChangeText={(text) => setText(language, 'name', text)}
              />
              <AuthTextInput
                placeholder={t('adminMeetingPoints.directionsLabel')}
                accessibilityLabel={`${t(`adminMeetingPoints.language.${language}`)}: ${t('adminMeetingPoints.directionsLabel')}`}
                value={wording[language].directions}
                onChangeText={(text) => setText(language, 'directions', text)}
                multiline
              />
            </View>
          ))}

          <Text style={styles.languageLabel}>{t('adminMeetingPoints.priorityLabel')}</Text>
          <AuthTextInput
            placeholder={t('adminMeetingPoints.priorityLabel')}
            value={priority}
            onChangeText={(text) => {
              setDetailsSaved(false);
              setPriority(text);
            }}
            keyboardType="number-pad"
            helperText={t('adminMeetingPoints.priorityHint')}
          />
          <PrimaryButton label={t('adminMeetingPoints.saveDetails')} onPress={handleSaveDetails} loading={busy === 'details'} />
          {detailsSaved ? <Text style={styles.saved}>{t('adminMeetingPoints.saved')}</Text> : null}
        </Card>

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>{t('adminMeetingPoints.statusTitle')}</Text>
          <StatusPill
            status={point.is_active ? 'Group Confirmed' : 'Searching'}
            label={t(point.is_active ? 'adminMeetingPoints.active' : 'adminMeetingPoints.inactive')}
          />
          {closeWarnings.map((warning) => (
            <Text key={warning} style={styles.warning}>
              {warning}
            </Text>
          ))}
          <Text style={[styles.body, styles.statusLine]}>
            {point.verified_at
              ? t('adminMeetingPoints.verifiedOn', { date: formatBarcelonaDateTime(point.verified_at) })
              : t('adminMeetingPoints.notVerified')}
          </Text>

          {!point.verified_at ? (
            <>
              <Text style={missingToVerify.length ? styles.warning : styles.hint}>
                {missingToVerify.length ? missingLabel(missingToVerify) : t('adminMeetingPoints.verifyHint')}
              </Text>
              <View style={styles.gap}>
                <PrimaryButton
                  label={t('adminMeetingPoints.markVerified')}
                  onPress={handleVerify}
                  loading={busy === 'verify'}
                  disabled={missingToVerify.length > 0}
                />
              </View>
            </>
          ) : null}

          {point.is_active ? (
            <SecondaryButton
              label={t('adminMeetingPoints.deactivate')}
              onPress={() => save('active', { is_active: false })}
              loading={busy === 'active'}
            />
          ) : (
            <>
              {point.verified_at && missingToActivate.length ? (
                <Text style={styles.warning}>{missingLabel(missingToActivate)}</Text>
              ) : null}
              <SecondaryButton
                label={t('adminMeetingPoints.activate')}
                onPress={() => save('active', { is_active: true })}
                loading={busy === 'active'}
                disabled={missingToActivate.length > 0}
              />
            </>
          )}
        </Card>
      </ScrollView>
    </ScreenBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingTop: spacing.x12,
    paddingHorizontal: spacing.x6,
    paddingBottom: spacing.x12,
  },
  backText: {
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
    marginBottom: spacing.x3,
  },
  code: {
    ...baseText.label,
    marginBottom: spacing.x1,
  },
  title: {
    ...baseText.h2,
    marginBottom: spacing.x4,
  },
  card: {
    marginBottom: spacing.x4,
  },
  cardTitle: {
    ...baseText.h3,
    marginBottom: spacing.x3,
  },
  body: {
    ...baseText.body,
    marginBottom: spacing.x2,
  },
  statusLine: {
    marginTop: spacing.x3,
  },
  hint: {
    ...baseText.caption,
    marginTop: spacing.x2,
    marginBottom: spacing.x2,
  },
  warning: {
    ...baseText.bodySmall,
    color: colors.warning,
    marginTop: spacing.x2,
    marginBottom: spacing.x2,
  },
  saved: {
    ...baseText.bodySmall,
    color: colors.success,
    textAlign: 'center',
    marginTop: spacing.x3,
  },
  gap: {
    marginTop: spacing.x2,
    marginBottom: spacing.x3,
  },
  candidate: {
    marginTop: spacing.x3,
    paddingTop: spacing.x3,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  photo: {
    width: '100%',
    height: 200,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceCardSolid,
  },
  languageLabel: {
    ...baseText.label,
    marginBottom: spacing.x2,
  },
});
