import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import AuthTextInput from '../components/AuthTextInput';
import PrimaryButton from '../components/PrimaryButton';
import {
  fetchGroupById,
  fetchGroupMembers,
  TaxiGroupMember,
  updateGroupTotalFare,
  updatePassengerDistance,
} from '../services/adminGrouping';
import { calculateFareSplit, FareSplitResult } from '../services/fareSplit';
import { colors } from '../theme/colors';

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
  const [results, setResults] = useState<FareSplitResult[] | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const [groupResult, membersResult] = await Promise.all([fetchGroupById(groupId), fetchGroupMembers(groupId)]);
    setIsLoading(false);

    if (groupResult.error) {
      setErrorMessage(groupResult.error.message);
      return;
    }
    if (membersResult.error) {
      setErrorMessage(membersResult.error.message);
      return;
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
  }, [groupId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCalculate = async () => {
    setErrorMessage(null);
    setResults(null);

    const totalFare = Number.parseFloat(totalFareInput);
    if (Number.isNaN(totalFare) || totalFare <= 0) {
      setErrorMessage(t('groupDetail.invalidFareError'));
      return;
    }

    const parsedDistances: { id: string; distanceKm: number }[] = [];
    for (const member of members) {
      const raw = distanceInputs[member.id];
      const distanceKm = raw ? Number.parseFloat(raw) : NaN;
      if (!raw || Number.isNaN(distanceKm) || distanceKm <= 0) {
        setErrorMessage(t('groupDetail.invalidDistanceError'));
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
      setErrorMessage(failed.error.message);
      return;
    }

    setResults(calculateFareSplit(parsedDistances, totalFare));
  };

  const memberById = (id: string) => members.find((m) => m.id === id);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable onPress={onBack}>
        <Text style={styles.backText}>{t('admin.back')}</Text>
      </Pressable>
      <Text style={styles.title}>{t('groupDetail.title')}</Text>

      {isLoading ? (
        <Text style={styles.emptyText}>{t('admin.loading')}</Text>
      ) : (
        <>
          <Text style={styles.label}>{t('groupDetail.totalFareLabel')}</Text>
          <AuthTextInput
            placeholder="e.g. 32.50"
            value={totalFareInput}
            onChangeText={setTotalFareInput}
            keyboardType="decimal-pad"
          />

          {members.map((member) => (
            <View key={member.id} style={styles.memberCard}>
              <Text style={styles.memberTitle}>{member.flight_number}</Text>
              <Text style={styles.memberSubtitle}>{member.destination_address}</Text>
              <Text style={styles.label}>{t('groupDetail.distanceLabel')}</Text>
              <AuthTextInput
                placeholder="e.g. 12.5"
                value={distanceInputs[member.id] ?? ''}
                onChangeText={(text) => setDistanceInputs((prev) => ({ ...prev, [member.id]: text }))}
                keyboardType="decimal-pad"
              />
            </View>
          ))}

          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

          <PrimaryButton label={t('groupDetail.calculate')} onPress={handleCalculate} loading={isSaving} />

          {results ? (
            <View style={styles.results}>
              <Text style={styles.sectionTitle}>{t('groupDetail.resultsTitle')}</Text>
              {results.map((r) => {
                const member = memberById(r.id);
                return (
                  <View key={r.id} style={styles.resultRow}>
                    <Text style={styles.resultFlight}>{member?.flight_number}</Text>
                    <Text style={styles.resultAmount}>{r.amount.toFixed(2)} €</Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingTop: 48,
    paddingHorizontal: 24,
    paddingBottom: 48,
  },
  backText: {
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 20,
  },
  label: {
    color: colors.textSecondary,
    marginBottom: 8,
    fontSize: 13,
  },
  memberCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  memberTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  memberSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: 12,
  },
  error: {
    color: colors.error,
    marginBottom: 16,
    textAlign: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 24,
  },
  results: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  resultFlight: {
    color: colors.text,
    fontWeight: '600',
  },
  resultAmount: {
    color: colors.primary,
    fontWeight: 'bold',
    fontSize: 16,
  },
});
