import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';

import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import Skeleton from '../components/Skeleton';
import StatusPill from '../components/StatusPill';
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
import { computeGroupScore, MatchSuggestion, suggestTaxiGroups } from '../services/matchingEngine';
import { baseText, colors, motion, overlays, spacing } from '../theme/colors';
import GroupDetailScreen from './GroupDetailScreen';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const LIST_LAYOUT_ANIMATION = {
  duration: motion.durationBase,
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};

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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [creatingSuggestionKey, setCreatingSuggestionKey] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);

  const loadData = useCallback(async () => {
    setIsLoading(!hasLoadedOnce.current);
    const [pendingResult, groupsResult] = await Promise.all([fetchPendingRequests(), fetchTaxiGroups()]);
    hasLoadedOnce.current = true;
    setIsLoading(false);
    setIsRefreshing(false);

    LayoutAnimation.configureNext(LIST_LAYOUT_ANIMATION);

    if (pendingResult.error) {
      console.warn('fetchPendingRequests failed', pendingResult.error);
      setErrorMessage(t('admin.loadError'));
    } else {
      setRequests(pendingResult.data ?? []);
    }

    if (groupsResult.error) {
      console.warn('fetchTaxiGroups failed', groupsResult.error);
      setErrorMessage(t('admin.loadError'));
    } else {
      setGroups(groupsResult.data ?? []);
    }
  }, [t]);

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

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadData();
  };

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

    if (error || !data) {
      setIsCreating(false);
      console.warn('createTaxiGroup failed', error);
      setErrorMessage(t('admin.createGroupError'));
      return;
    }

    // Same route-distance calculation "Suggest groups" already uses, applied to this manually
    // picked set of passengers too - so the admin never has to look up and type each member's
    // distance from the airport by hand. Falls back to the manual field in GroupDetailScreen
    // (left blank) if a destination is missing coordinates or the route lookup fails.
    const group = requests.filter(
      (r): r is PendingPassengerRequest & { destination_lat: number; destination_lng: number } =>
        selectedIds.includes(r.id) && r.destination_lat != null && r.destination_lng != null
    );

    if (group.length === selectedIds.length) {
      const suggestion = await computeGroupScore(group);
      if (suggestion) {
        const estimatedTotalFare = suggestion.members.reduce((sum, m) => sum + m.fareAmount, 0);
        await Promise.all([
          updateGroupTotalFare(data.id, estimatedTotalFare),
          ...suggestion.members.map((m) => updatePassengerDistance(m.id, m.distanceKm)),
        ]);
      }
    }

    setIsCreating(false);
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
    } catch (error) {
      console.warn('suggestTaxiGroups failed', error);
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
      console.warn('createTaxiGroup (suggestion) failed', error);
      setCreatingSuggestionKey(null);
      setErrorMessage(t('admin.createGroupError'));
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
    <ScreenBackground
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
      scrimColor={overlays.scrimMedium}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={colors.accentPrimaryStrong} />
        }
      >
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button"
            accessibilityLabel={t('admin.back')}
          >
            <Text style={styles.backText}>{t('admin.back')}</Text>
          </Pressable>
          <Text style={styles.title}>{t('admin.title')}</Text>
        </View>

        {errorMessage ? <ErrorNotice message={errorMessage} onRetry={loadData} retryLabel={t('common.retry')} /> : null}

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
                  <Card key={key} style={styles.suggestionCard}>
                    {suggestion.members.map((member) => (
                      <View key={member.id} style={styles.suggestionMemberRow}>
                        <Text style={styles.rowTitle}>{member.passengerName?.trim() || member.flightNumber}</Text>
                        <Text style={styles.rowSubtitle}>{member.flightNumber}</Text>
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
                  </Card>
                );
              })}
            </>
          ) : null}
        </View>

        {isLoading ? (
          <View accessible accessibilityLabel={t('admin.loading')}>
            {[0, 1, 2].map((i) => (
              <Card key={i} style={styles.row}>
                <View style={styles.rowInner}>
                  <Skeleton width={24} height={24} radius={6} />
                  <View style={styles.rowText}>
                    <Skeleton width={100} height={18} style={styles.skeletonGap} />
                    <Skeleton width={160} height={14} style={styles.skeletonGap} />
                    <Skeleton width={140} height={14} />
                  </View>
                </View>
              </Card>
            ))}
          </View>
        ) : requests.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>{t('admin.empty')}</Text>
            <SecondaryButton label={t('admin.emptyAction')} onPress={handleRefresh} loading={isRefreshing} />
          </View>
        ) : (
          requests.map((item) => {
            const isSelected = selectedIds.includes(item.id);
            const displayName = item.passenger_name?.trim() || item.flight_number;
            const rowLabel = `${displayName}, ${item.flight_number}, ${new Date(item.arrival_at).toLocaleString([], {
              dateStyle: 'short',
              timeStyle: 'short',
            })}, ${item.destination_address}, ${t('admin.bagsAndWait', {
              bags: item.bags_count,
              wait: item.max_wait_minutes,
            })}`;
            return (
              <Card
                key={item.id}
                onPress={() => toggleSelect(item.id)}
                style={styles.row}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={rowLabel}
              >
                <View style={styles.rowInner}>
                  <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
                    {isSelected ? (
                      <Text style={styles.checkmark} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                        ✓
                      </Text>
                    ) : null}
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{displayName}</Text>
                    <Text style={styles.rowSubtitle}>
                      {item.flight_number} ·{' '}
                      {new Date(item.arrival_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                    </Text>
                    <Text style={styles.rowSubtitle}>{item.destination_address}</Text>
                    <Text style={styles.rowMeta}>
                      {t('admin.bagsAndWait', { bags: item.bags_count, wait: item.max_wait_minutes })}
                    </Text>
                  </View>
                </View>
              </Card>
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
            groups.map((group) => {
              const fareLabel =
                group.total_fare != null
                  ? t('admin.groupFareSet', { amount: group.total_fare.toFixed(2) })
                  : t('admin.groupFareNotSet');
              const statusLabel =
                group.status === 'confirmed'
                  ? t('groupDetail.statusConfirmed')
                  : group.status === 'dissolved'
                    ? t('groupDetail.statusDissolved')
                    : t('groupDetail.statusUnconfirmed');
              return (
                <Card
                  key={group.id}
                  onPress={() => setOpenGroupId(group.id)}
                  style={styles.groupRow}
                  accessibilityLabel={`${new Date(group.created_at).toLocaleString([], {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}, ${fareLabel}, ${statusLabel}`}
                >
                  <Text style={styles.groupTitle}>
                    {new Date(group.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </Text>
                  <Text style={styles.groupSubtitle}>{fareLabel}</Text>
                  <StatusPill
                    status={group.status === 'confirmed' ? 'Group Confirmed' : group.status === 'dissolved' ? 'Cancelled' : 'Searching'}
                    label={statusLabel}
                  />
                </Card>
              );
            })
          )}
        </View>
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
  header: {
    marginBottom: spacing.x4,
  },
  backText: {
    color: colors.textPrimary,
    fontWeight: '700',
    textDecorationLine: 'underline',
    marginBottom: spacing.x3,
  },
  title: {
    ...baseText.h2,
  },
  row: {
    marginBottom: spacing.x3,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.x3,
  },
  skeletonGap: {
    marginBottom: spacing.x2,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxSelected: {
    backgroundColor: colors.accentPrimaryStrong,
    borderColor: colors.accentPrimaryStrong,
  },
  checkmark: {
    color: colors.white,
    fontSize: 14,
    fontWeight: 'bold',
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    ...baseText.body,
    fontWeight: '600',
    marginBottom: spacing.x1,
  },
  rowSubtitle: {
    ...baseText.caption,
  },
  rowMeta: {
    ...baseText.caption,
    color: colors.info,
    marginTop: spacing.x1,
  },
  emptyState: {
    alignItems: 'stretch',
    marginTop: spacing.x6,
    marginBottom: spacing.x6,
  },
  emptyText: {
    ...baseText.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.x4,
  },
  suggestionsSection: {
    marginBottom: spacing.x4,
  },
  suggestionCard: {
    marginBottom: spacing.x3,
  },
  suggestionMemberRow: {
    marginBottom: spacing.x2,
  },
  footer: {
    paddingVertical: spacing.x4,
  },
  selectionCount: {
    ...baseText.bodySmall,
    textAlign: 'center',
    marginBottom: spacing.x3,
  },
  groupsSection: {
    marginTop: spacing.x4,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.x6,
  },
  sectionTitle: {
    ...baseText.h3,
    marginBottom: spacing.x3,
  },
  groupRow: {
    marginBottom: spacing.x3,
  },
  groupTitle: {
    ...baseText.body,
    fontWeight: '600',
    marginBottom: spacing.x1,
  },
  groupSubtitle: {
    ...baseText.caption,
    color: colors.info,
    marginBottom: spacing.x2,
  },
});
