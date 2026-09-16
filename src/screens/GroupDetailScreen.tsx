import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import Skeleton from '../components/Skeleton';
import StatusPill from '../components/StatusPill';
import {
  confirmTaxiGroup,
  fetchGroupById,
  fetchGroupMembers,
  TaxiGroupMember,
  TaxiGroupStatus,
  updateGroupTotalFare,
  updatePassengerDistance,
} from '../services/adminGrouping';
import { calculateFareSplit, FareSplitResult } from '../services/fareSplit';
import { baseText, colors, overlays, radii, spacing } from '../theme/colors';

type Props = {
  groupId: string;
  onBack: () => void;
};

export default function GroupDetailScreen({ groupId, onBack }: Props) {
  const { t } = useTranslation();

  const [members, setMembers] = useState<TaxiGroupMember[]>([]);
  const [distanceInputs, setDistanceInputs] = useState<Record<string, string>>({});
  const [totalFareInput, setTotalFareInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [results, setResults] = useState<FareSplitResult[] | null>(null);
  const [groupStatus, setGroupStatus] = useState<TaxiGroupStatus>('unconfirmed');
  const [isConfirming, setIsConfirming] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    const [groupResult, membersResult] = await Promise.all([fetchGroupById(groupId), fetchGroupMembers(groupId)]);
    setIsLoading(false);

    if (groupResult.error) {
      console.warn('fetchGroupById failed', groupResult.error);
      setErrorMessage(t('groupDetail.loadError'));
      return;
    }
    if (membersResult.error) {
      console.warn('fetchGroupMembers failed', membersResult.error);
      setErrorMessage(t('groupDetail.loadError'));
      return;
    }

    if (groupResult.data) {
      setGroupStatus(groupResult.data.status);
    }

    const list = membersResult.data ?? [];
    setMembers(list);
    setDistanceInputs((prev) => {
      const next = { ...prev };
      list.forEach((m) => {
        if (next[m.id] === undefined) {
          next[m.id] = m.distance_km != null ? String(m.distance_km) : '';
        }
      });
      return next;
    });
    setTotalFareInput((prev) =>
      prev ? prev : groupResult.data?.total_fare != null ? String(groupResult.data.total_fare) : ''
    );
  }, [groupId, t]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCalculate = async () => {
    setSaveError(null);
    setResults(null);

    const totalFare = Number.parseFloat(totalFareInput);
    if (Number.isNaN(totalFare) || totalFare <= 0) {
      setSaveError(t('groupDetail.invalidFareError'));
      return;
    }

    const parsedDistances: { id: string; distanceKm: number }[] = [];
    for (const member of members) {
      const raw = distanceInputs[member.id];
      const distanceKm = raw ? Number.parseFloat(raw) : NaN;
      if (!raw || Number.isNaN(distanceKm) || distanceKm <= 0) {
        setSaveError(t('groupDetail.invalidDistanceError'));
        return;
      }
      parsedDistances.push({ id: member.id, distanceKm });
    }

    setIsSaving(true);
    const updateResults = await Promise.all([
      updateGroupTotalFare(groupId, totalFare),
      ...parsedDistances.map((p) => updatePassengerDistance(p.id, p.distanceKm)),
    ]);
    setIsSaving(false);

    const failed = updateResults.find((r) => r.error);
    if (failed?.error) {
      console.warn('fare split save failed', failed.error);
      setSaveError(t('groupDetail.saveError'));
      return;
    }

    setResults(calculateFareSplit(parsedDistances, totalFare));
  };

  const memberById = (id: string) => members.find((m) => m.id === id);

  const handleConfirm = async () => {
    setConfirmError(null);
    setIsConfirming(true);
    const { error } = await confirmTaxiGroup(groupId);
    setIsConfirming(false);

    if (error) {
      console.warn('confirmTaxiGroup failed', error);
      setConfirmError(t('groupDetail.confirmError'));
      return;
    }

    setGroupStatus('confirmed');
  };

  return (
    <ScreenBackground
      source={require('../../assets/bg-content.png')}
      naturalWidth={317}
      naturalHeight={1536}
      scrimColor={overlays.scrimMedium}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <Pressable
          onPress={onBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('admin.back')}
        >
          <Text style={styles.backText}>{t('admin.back')}</Text>
        </Pressable>
        <Text style={styles.title}>{t('groupDetail.title')}</Text>

        {errorMessage ? <ErrorNotice message={errorMessage} onRetry={loadData} retryLabel={t('common.retry')} /> : null}

        {isLoading ? (
          <View accessible accessibilityLabel={t('admin.loading')}>
            <Skeleton width={150} height={28} radius={radii.pill} style={styles.skeletonGap} />
            <Skeleton width={110} height={52} radius={radii.md} style={styles.skeletonGap} />
            <Card style={styles.skeletonGap}>
              <Skeleton width={100} height={18} style={styles.skeletonGap} />
              <Skeleton width={160} height={14} />
            </Card>
            <Card>
              <Skeleton width={100} height={18} style={styles.skeletonGap} />
              <Skeleton width={160} height={14} />
            </Card>
          </View>
        ) : (
          <>
            <View style={styles.statusRow}>
              <StatusPill
                status={groupStatus === 'confirmed' ? 'Group Confirmed' : 'Searching'}
                label={groupStatus === 'confirmed' ? t('groupDetail.statusConfirmed') : t('groupDetail.statusUnconfirmed')}
              />
            </View>

            {groupStatus === 'unconfirmed' ? (
              <>
                {confirmError ? (
                  <ErrorNotice message={confirmError} onRetry={handleConfirm} retryLabel={t('common.retry')} />
                ) : null}
                <PrimaryButton label={t('groupDetail.confirmGroup')} onPress={handleConfirm} loading={isConfirming} />
              </>
            ) : null}

            <Text style={styles.label}>{t('groupDetail.totalFareLabel')}</Text>
            <AuthTextInput
              placeholder="e.g. 32.50"
              accessibilityLabel={t('groupDetail.totalFareLabel')}
              value={totalFareInput}
              onChangeText={setTotalFareInput}
              keyboardType="decimal-pad"
            />

            {members.map((member) => (
              <Card key={member.id} style={styles.memberCard}>
                <Text style={styles.memberTitle}>{member.flight_number}</Text>
                <Text style={styles.memberSubtitle}>{member.destination_address}</Text>
                {member.extra_detour_minutes != null && member.waiting_minutes != null ? (
                  <Text style={styles.memberScoreNote}>
                    {t('groupDetail.detourAndWait', {
                      detour: Math.round(member.extra_detour_minutes),
                      wait: Math.round(member.waiting_minutes),
                    })}
                  </Text>
                ) : null}
                <Text style={styles.label}>{t('groupDetail.distanceLabel')}</Text>
                <AuthTextInput
                  placeholder="e.g. 12.5"
                  accessibilityLabel={`${member.flight_number} ${t('groupDetail.distanceLabel')}`}
                  value={distanceInputs[member.id] ?? ''}
                  onChangeText={(text) => setDistanceInputs((prev) => ({ ...prev, [member.id]: text }))}
                  keyboardType="decimal-pad"
                />
              </Card>
            ))}

            {saveError ? <ErrorNotice message={saveError} onRetry={handleCalculate} retryLabel={t('common.retry')} /> : null}

            <PrimaryButton label={t('groupDetail.calculate')} onPress={handleCalculate} loading={isSaving} />

            {results ? (
              <View style={styles.results}>
                <Text style={styles.sectionTitle}>{t('groupDetail.resultsTitle')}</Text>
                {results.map((r) => {
                  const member = memberById(r.id);
                  return (
                    <Card
                      key={r.id}
                      style={styles.resultRow}
                      accessible
                      accessibilityLabel={`${member?.flight_number}: ${r.amount.toFixed(2)} €`}
                    >
                      <Text style={styles.resultFlight}>{member?.flight_number}</Text>
                      <Text style={styles.resultAmount}>{r.amount.toFixed(2)} €</Text>
                    </Card>
                  );
                })}
              </View>
            ) : null}
          </>
        )}
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
  title: {
    ...baseText.h2,
    marginBottom: spacing.x6,
  },
  label: {
    ...baseText.label,
    marginBottom: spacing.x2,
  },
  statusRow: {
    marginBottom: spacing.x4,
  },
  skeletonGap: {
    marginBottom: spacing.x4,
  },
  memberScoreNote: {
    ...baseText.caption,
    color: colors.info,
    marginBottom: spacing.x2,
  },
  memberCard: {
    marginBottom: spacing.x4,
  },
  memberTitle: {
    ...baseText.body,
    fontWeight: '600',
    marginBottom: spacing.x1,
  },
  memberSubtitle: {
    ...baseText.caption,
    marginBottom: spacing.x3,
  },
  results: {
    marginTop: spacing.x6,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.x4,
  },
  sectionTitle: {
    ...baseText.h3,
    marginBottom: spacing.x3,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.x2,
  },
  resultFlight: {
    ...baseText.body,
    fontWeight: '600',
  },
  resultAmount: {
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 16,
  },
});
