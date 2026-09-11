import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import PrimaryButton from '../components/PrimaryButton';
import { ADMIN_EMAIL, MAX_PASSENGERS_PER_TAXI } from '../constants';
import {
  createTaxiGroup,
  fetchPendingRequests,
  fetchTaxiGroups,
  PendingPassengerRequest,
  TaxiGroupSummary,
  updateGroupTotalFare,
  updatePassengerDistance,
} from '../services/adminGrouping';
import { MatchSuggestion, suggestTaxiGroups } from '../services/matchingEngine';
import { colors } from '../theme/colors';
import GroupDetailScreen from './GroupDetailScreen';

type Props = {
  session: Session | null;
  onBack: () => void;
};

export default function AdminScreen({ session, onBack }: Props) {
  const { t } = useTranslation();
  const isAdmin = session?.user?.email === ADMIN_EMAIL;

  const [requests, setRequests] = useState<PendingPassengerRequest[]>([]);
  const [groups, setGroups] = useState<TaxiGroupSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [creatingSuggestionKey, setCreatingSuggestionKey] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    const [pendingResult, groupsResult] = await Promise.all([fetchPendingRequests(), fetchTaxiGroups()]);
    setIsLoading(false);

    if (pendingResult.error) {
      setErrorMessage(pendingResult.error.message);
    } else {
      setRequests(pendingResult.data ?? []);
    }

    if (groupsResult.error) {
      setErrorMessage(groupsResult.error.message);
    } else {
      setGroups(groupsResult.data ?? []);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) {
      loadData();
    }
  }, [isAdmin, loadData]);

  useEffect(() => {
    if (!isAdmin) {
      onBack();
    }
  }, [isAdmin, onBack]);

  if (!isAdmin) {
    return null;
  }

  if (openGroupId) {
    return (
      <GroupDetailScreen
        groupId={openGroupId}
        onBack={() => {
          setOpenGroupId(null);
          loadData();
        }}
      />
    );
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((i) => i !== id);
      }
      if (prev.length >= MAX_PASSENGERS_PER_TAXI) {
        setErrorMessage(t('admin.maxSelectedError', { max: MAX_PASSENGERS_PER_TAXI }));
        return prev;
      }
      setErrorMessage(null);
      return [...prev, id];
    });
  };

  const handleCreateGroup = async () => {
    if (selectedIds.length < 2) return;
    setErrorMessage(null);
    setIsCreating(true);
    const { data, error } = await createTaxiGroup(selectedIds);
    setIsCreating(false);

    if (error || !data) {
      setErrorMessage(error?.message ?? t('admin.createGroupError'));
      return;
    }

    setSelectedIds([]);
    await loadData();
    setOpenGroupId(data.id);
  };

  const handleSuggestGroups = async () => {
    setErrorMessage(null);
    setIsSuggesting(true);
    try {
      const result = await suggestTaxiGroups(requests);
      setSuggestions(result);
    } catch {
      setErrorMessage(t('admin.createGroupError'));
    } finally {
      setIsSuggesting(false);
    }
  };

  const handleCreateFromSuggestion = async (suggestion: MatchSuggestion) => {
    const key = suggestion.requestIds.join(',');
    setErrorMessage(null);
    setCreatingSuggestionKey(key);

    const { data, error } = await createTaxiGroup(suggestion.requestIds);
    if (error || !data) {
      setCreatingSuggestionKey(null);
      setErrorMessage(error?.message ?? t('admin.createGroupError'));
      return;
    }

    const estimatedTotalFare = suggestion.members.reduce((sum, m) => sum + m.fareAmount, 0);
    await Promise.all([
      updateGroupTotalFare(data.id, estimatedTotalFare),
      ...suggestion.members.map((m) => updatePassengerDistance(m.id, m.distanceKm)),
    ]);

    setCreatingSuggestionKey(null);
    setSuggestions((prev) => prev.filter((s) => s.requestIds.join(',') !== key));
    await loadData();
    setOpenGroupId(data.id);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable onPress={onBack}>
          <Text style={styles.backText}>{t('admin.back')}</Text>
        </Pressable>
        <Text style={styles.title}>{t('admin.title')}</Text>
      </View>

      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

      <View style={styles.suggestionsSection}>
        <PrimaryButton
          label={t('admin.suggestGroups')}
          onPress={handleSuggestGroups}
          loading={isSuggesting}
          disabled={requests.length < 2}
        />

        {isSuggesting ? (
          <Text style={styles.emptyText}>{t('admin.suggestionsLoading')}</Text>
        ) : suggestions.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>{t('admin.suggestionsTitle')}</Text>
            {suggestions.map((suggestion) => {
              const key = suggestion.requestIds.join(',');
              return (
                <View key={key} style={styles.suggestionCard}>
                  {suggestion.members.map((member) => (
                    <View key={member.id} style={styles.suggestionMemberRow}>
                      <Text style={styles.rowTitle}>{member.flightNumber}</Text>
                      <Text style={styles.rowMeta}>
                        {t('admin.detourLabel', { minutes: Math.round(member.extraDetourMinutes) })}
                        {'  ·  '}
                        {t('admin.waitLabel', { minutes: Math.round(member.waitingMinutes) })}
                        {'  ·  '}
                        {t('admin.estimatedFareLabel', { amount: member.fareAmount.toFixed(2) })}
                      </Text>
                    </View>
                  ))}
                  <PrimaryButton
                    label={t('admin.createGroup')}
                    onPress={() => handleCreateFromSuggestion(suggestion)}
                    loading={creatingSuggestionKey === key}
                  />
                </View>
              );
            })}
          </>
        ) : null}
      </View>

      {isLoading ? (
        <Text style={styles.emptyText}>{t('admin.loading')}</Text>
      ) : requests.length === 0 ? (
        <Text style={styles.emptyText}>{t('admin.empty')}</Text>
      ) : (
        requests.map((item) => {
          const isSelected = selectedIds.includes(item.id);
          return (
            <Pressable key={item.id} style={styles.row} onPress={() => toggleSelect(item.id)}>
              <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                {isSelected ? <Text style={styles.checkmark}>✓</Text> : null}
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{item.flight_number}</Text>
                <Text style={styles.rowSubtitle}>
                  {new Date(item.arrival_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                </Text>
                <Text style={styles.rowSubtitle}>{item.destination_address}</Text>
                <Text style={styles.rowMeta}>
                  {t('admin.bagsAndWait', { bags: item.bags_count, wait: item.max_wait_minutes })}
                </Text>
              </View>
            </Pressable>
          );
        })
      )}

      <View style={styles.footer}>
        <Text style={styles.selectionCount}>
          {t('admin.selectedCount', { count: selectedIds.length, max: MAX_PASSENGERS_PER_TAXI })}
        </Text>
        <PrimaryButton label={t('admin.createGroup')} onPress={handleCreateGroup} loading={isCreating} />
      </View>

      <View style={styles.groupsSection}>
        <Text style={styles.sectionTitle}>{t('admin.groupsTitle')}</Text>
        {groups.length === 0 ? (
          <Text style={styles.emptyText}>{t('admin.noGroups')}</Text>
        ) : (
          groups.map((group) => (
            <Pressable key={group.id} style={styles.groupRow} onPress={() => setOpenGroupId(group.id)}>
              <Text style={styles.groupTitle}>
                {new Date(group.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
              </Text>
              <Text style={styles.groupSubtitle}>
                {group.total_fare != null
                  ? t('admin.groupFareSet', { amount: group.total_fare.toFixed(2) })
                  : t('admin.groupFareNotSet')}
              </Text>
              <Text style={styles.groupStatusBadge}>
                {group.status === 'confirmed' ? t('groupDetail.statusConfirmed') : t('groupDetail.statusUnconfirmed')}
              </Text>
            </Pressable>
          ))
        )}
      </View>
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
  header: {
    marginBottom: 16,
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
  },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'flex-start',
    gap: 12,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  checkmark: {
    color: colors.text,
    fontSize: 14,
    fontWeight: 'bold',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  rowSubtitle: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  rowMeta: {
    color: colors.accent,
    fontSize: 12,
    marginTop: 4,
  },
  emptyText: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 24,
  },
  error: {
    color: colors.error,
    marginBottom: 12,
    textAlign: 'center',
  },
  suggestionsSection: {
    marginBottom: 16,
  },
  suggestionCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  suggestionMemberRow: {
    marginBottom: 10,
  },
  footer: {
    paddingVertical: 16,
  },
  selectionCount: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: 12,
  },
  groupsSection: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text,
    marginBottom: 12,
  },
  groupRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  groupTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  groupSubtitle: {
    color: colors.accent,
    fontSize: 13,
  },
  groupStatusBadge: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
});
