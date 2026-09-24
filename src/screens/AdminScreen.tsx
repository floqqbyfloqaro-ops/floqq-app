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
import RideDateLine, { formatRideDateTime, rideDateAccessibilityText } from '../components/RideDateLine';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import Skeleton from '../components/Skeleton';
import StatusPill from '../components/StatusPill';
import { ADMIN_EMAIL, ADMIN_HISTORY_DEFAULT_WINDOW_DAYS, MAX_PASSENGERS_PER_TAXI } from '../constants';
import {
  createTaxiGroup,
  fetchGroupMemberArrivals,
  fetchHistoryRequests,
  fetchPendingRequests,
  fetchTaxiGroups,
  HISTORY_GROUP_STATUSES,
  HistoryPassengerRequest,
  PendingPassengerRequest,
  TaxiGroupSummary,
  updateGroupTotalFare,
  updatePassengerDistance,
} from '../services/adminGrouping';
import { computeGroupScore, MatchSuggestion, suggestTaxiGroups } from '../services/matchingEngine';
import { baseText, colors, motion, overlays, spacing } from '../theme/colors';
import { addDaysToDayKey, barcelonaDayKey, formatBarcelonaDateTime, weekdayForDayKey } from '../utils/formatDateTime';
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

type RideDateFilter = 'today' | 'tomorrow' | 'all';

const RIDE_DATE_FILTERS: { value: RideDateFilter; labelKey: string }[] = [
  { value: 'today', labelKey: 'admin.filterToday' },
  { value: 'tomorrow', labelKey: 'admin.filterTomorrow' },
  { value: 'all', labelKey: 'admin.filterAllUpcoming' },
];

type RideDaySection = { dayKey: string; requests: PendingPassengerRequest[] };

// Soonest ride first, bucketed by the Barcelona calendar day of each ride so the admin can see at
// a glance which passengers land on the same day and could share a taxi.
function groupRequestsByRideDay(requests: PendingPassengerRequest[]): RideDaySection[] {
  const sorted = [...requests].sort((a, b) => new Date(a.arrival_at).getTime() - new Date(b.arrival_at).getTime());
  const sections: RideDaySection[] = [];
  for (const request of sorted) {
    const dayKey = barcelonaDayKey(request.arrival_at);
    const last = sections[sections.length - 1];
    if (last && last.dayKey === dayKey) {
      last.requests.push(request);
    } else {
      sections.push({ dayKey, requests: [request] });
    }
  }
  return sections;
}

export default function AdminScreen({ session, onBack }: Props) {
  const { t, i18n } = useTranslation();
  const isAdmin = session?.user?.email === ADMIN_EMAIL;

  const [requests, setRequests] = useState<PendingPassengerRequest[]>([]);
  const [groups, setGroups] = useState<TaxiGroupSummary[]>([]);
  const [historyRequests, setHistoryRequests] = useState<HistoryPassengerRequest[]>([]);
  const [historyGroups, setHistoryGroups] = useState<TaxiGroupSummary[]>([]);
  // groupId -> earliest member arrival_at, for the Active tab's "ride date" line. Dissolved
  // groups have no attached members left, so this is only ever populated for active groups.
  const [groupRideDates, setGroupRideDates] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<MatchSuggestion[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [creatingSuggestionKey, setCreatingSuggestionKey] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [rideDateFilter, setRideDateFilter] = useState<RideDateFilter>('all');
  const hasLoadedOnce = useRef(false);

  const loadData = useCallback(async () => {
    setIsLoading(!hasLoadedOnce.current);
    const [pendingResult, groupsResult, historyRequestsResult, historyGroupsResult] = await Promise.all([
      fetchPendingRequests(),
      fetchTaxiGroups(),
      fetchHistoryRequests(),
      fetchTaxiGroups(HISTORY_GROUP_STATUSES),
    ]);
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
      const activeGroups = groupsResult.data ?? [];
      setGroups(activeGroups);

      const { data: arrivals, error: arrivalsError } = await fetchGroupMemberArrivals(
        activeGroups.map((g) => g.id)
      );
      if (arrivalsError) {
        console.warn('fetchGroupMemberArrivals failed', arrivalsError);
      } else {
        const earliestByGroup: Record<string, string> = {};
        for (const row of arrivals ?? []) {
          const current = earliestByGroup[row.group_id];
          if (!current || new Date(row.arrival_at).getTime() < new Date(current).getTime()) {
            earliestByGroup[row.group_id] = row.arrival_at;
          }
        }
        setGroupRideDates(earliestByGroup);
      }
    }

    if (historyRequestsResult.error) {
      console.warn('fetchHistoryRequests failed', historyRequestsResult.error);
      setErrorMessage(t('admin.historyLoadError'));
    } else {
      setHistoryRequests(historyRequestsResult.data ?? []);
    }

    if (historyGroupsResult.error) {
      console.warn('fetchTaxiGroups (history) failed', historyGroupsResult.error);
      setErrorMessage(t('admin.historyLoadError'));
    } else {
      setHistoryGroups(historyGroupsResult.data ?? []);
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

  // Never deletes anything - just hides history older than the default window until the admin
  // asks to see it all, so History doesn't grow unbounded either.
  const historyCutoff = Date.now() - ADMIN_HISTORY_DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const visibleHistoryRequests = showAllHistory
    ? historyRequests
    : historyRequests.filter((r) => new Date(r.arrival_at).getTime() >= historyCutoff);
  const visibleHistoryGroups = showAllHistory
    ? historyGroups
    : historyGroups.filter((g) => new Date(g.created_at).getTime() >= historyCutoff);
  const hiddenHistoryCount =
    historyRequests.length + historyGroups.length - visibleHistoryRequests.length - visibleHistoryGroups.length;

  const todayKey = barcelonaDayKey(new Date());
  const tomorrowKey = addDaysToDayKey(todayKey, 1);
  const filteredRequests =
    rideDateFilter === 'all'
      ? requests
      : requests.filter((r) => barcelonaDayKey(r.arrival_at) === (rideDateFilter === 'today' ? todayKey : tomorrowKey));
  const requestSections = groupRequestsByRideDay(filteredRequests);
  const requestById = new Map(requests.map((r) => [r.id, r]));

  const rideDayLabel = (dayKey: string) => {
    if (dayKey === todayKey) return t('admin.dayToday');
    if (dayKey === tomorrowKey) return t('admin.dayTomorrow');
    const [year, month, day] = dayKey.split('-');
    return t('admin.rideDay', { weekday: weekdayForDayKey(dayKey, i18n.language), date: `${day}/${month}/${year}` });
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

        <View style={styles.tabRow} accessibilityRole="tablist">
          <Pressable
            onPress={() => setActiveTab('active')}
            style={[styles.tab, activeTab === 'active' && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'active' }}
          >
            <Text style={[styles.tabText, activeTab === 'active' && styles.tabTextActive]}>{t('admin.tabActive')}</Text>
          </Pressable>
          <Pressable
            onPress={() => setActiveTab('history')}
            style={[styles.tab, activeTab === 'history' && styles.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: activeTab === 'history' }}
          >
            <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>{t('admin.tabHistory')}</Text>
          </Pressable>
        </View>

        {errorMessage ? <ErrorNotice message={errorMessage} onRetry={loadData} retryLabel={t('common.retry')} /> : null}

        {activeTab === 'active' ? (
          <>
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
                    {suggestion.members.map((member) => {
                      const request = requestById.get(member.id);
                      return (
                        <View key={member.id} style={styles.suggestionMemberRow}>
                          <Text style={styles.rowTitle}>{member.passengerName?.trim() || member.flightNumber}</Text>
                          {request ? (
                            <RideDateLine
                              arrivalAt={request.arrival_at}
                              flightNumber={member.flightNumber}
                              arrivalTimeSource={request.arrival_time_source}
                            />
                          ) : (
                            <Text style={styles.rowSubtitle}>{member.flightNumber}</Text>
                          )}
                          <Text style={styles.rowMeta}>
                            {t('admin.detourLabel', { minutes: Math.round(member.extraDetourMinutes) })}
                            {'  ·  '}
                            {t('admin.waitLabel', { minutes: Math.round(member.waitingMinutes) })}
                            {'  ·  '}
                            {t('admin.estimatedFareLabel', { amount: member.fareAmount.toFixed(2) })}
                          </Text>
                        </View>
                      );
                    })}
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
          <>
            <View style={styles.tabRow} accessibilityRole="tablist" accessibilityLabel={t('admin.rideDateFilterLabel')}>
              {RIDE_DATE_FILTERS.map((filter) => (
                <Pressable
                  key={filter.value}
                  onPress={() => setRideDateFilter(filter.value)}
                  style={[styles.tab, rideDateFilter === filter.value && styles.tabActive]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: rideDateFilter === filter.value }}
                >
                  <Text style={[styles.tabText, rideDateFilter === filter.value && styles.tabTextActive]}>
                    {t(filter.labelKey)}
                  </Text>
                </Pressable>
              ))}
            </View>
            {requestSections.length === 0 ? (
              <Text style={styles.emptyText}>{t('admin.filterEmpty')}</Text>
            ) : null}
            {requestSections.map((section) => (
              <View key={section.dayKey}>
                <Text style={styles.dayHeader} accessibilityRole="header">
                  {rideDayLabel(section.dayKey)}
                </Text>
                {section.requests.map((item) => {
                  const isSelected = selectedIds.includes(item.id);
                  const displayName = item.passenger_name?.trim() || item.flight_number;
                  const rideDateText = rideDateAccessibilityText(t, i18n.language, {
                    arrivalAt: item.arrival_at,
                    flightNumber: item.flight_number,
                    arrivalTimeSource: item.arrival_time_source,
                    createdAt: item.created_at,
                  });
                  const rowLabel = `${displayName}, ${rideDateText}, ${item.destination_address}, ${t('admin.bagsAndWait', {
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
                          <RideDateLine
                            arrivalAt={item.arrival_at}
                            flightNumber={item.flight_number}
                            arrivalTimeSource={item.arrival_time_source}
                            createdAt={item.created_at}
                          />
                          <Text style={styles.rowTitle}>{displayName}</Text>
                          <Text style={styles.rowSubtitle}>{item.destination_address}</Text>
                          <Text style={styles.rowMeta}>
                            {t('admin.bagsAndWait', { bags: item.bags_count, wait: item.max_wait_minutes })}
                          </Text>
                        </View>
                      </View>
                    </Card>
                  );
                })}
              </View>
            ))}
          </>
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
              const rideDate = groupRideDates[group.id];
              const rideDateLabel = rideDate
                ? t('admin.groupRideDateLabel', { date: formatRideDateTime(t, i18n.language, rideDate) })
                : null;
              const createdLabel = t('admin.groupCreatedLabel', { date: formatBarcelonaDateTime(group.created_at) });
              return (
                <Card
                  key={group.id}
                  onPress={() => setOpenGroupId(group.id)}
                  style={styles.groupRow}
                  accessibilityLabel={`${rideDateLabel ? `${rideDateLabel}, ` : ''}${createdLabel}, ${fareLabel}, ${statusLabel}`}
                >
                  {rideDateLabel ? <Text style={styles.groupTitle}>{rideDateLabel}</Text> : null}
                  <Text style={rideDateLabel ? styles.groupSubtitle : styles.groupTitle}>{createdLabel}</Text>
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
          </>
        ) : (
          <>
            <View style={styles.groupsSection}>
              <Text style={styles.sectionTitle}>{t('admin.historyRequestsTitle')}</Text>
              {isLoading ? (
                <View accessible accessibilityLabel={t('admin.loading')}>
                  {[0, 1].map((i) => (
                    <Card key={i} style={styles.row}>
                      <View style={styles.rowText}>
                        <Skeleton width={100} height={18} style={styles.skeletonGap} />
                        <Skeleton width={160} height={14} />
                      </View>
                    </Card>
                  ))}
                </View>
              ) : visibleHistoryRequests.length === 0 ? (
                <Text style={styles.emptyText}>{t('admin.historyEmpty')}</Text>
              ) : (
                visibleHistoryRequests.map((item) => {
                  const displayName = item.passenger_name?.trim() || item.flight_number;
                  const statusLabel =
                    item.status === 'cancelled' ? t('admin.historyStatusCancelled') : t('admin.historyStatusExpired');
                  const rideDateText = rideDateAccessibilityText(t, i18n.language, {
                    arrivalAt: item.arrival_at,
                    flightNumber: item.flight_number,
                    arrivalTimeSource: item.arrival_time_source,
                    createdAt: item.created_at,
                  });
                  return (
                    <Card
                      key={item.id}
                      style={styles.row}
                      accessibilityLabel={`${displayName}, ${rideDateText}, ${statusLabel}`}
                    >
                      <View style={styles.rowText}>
                        <RideDateLine
                          arrivalAt={item.arrival_at}
                          flightNumber={item.flight_number}
                          arrivalTimeSource={item.arrival_time_source}
                          createdAt={item.created_at}
                        />
                        <Text style={styles.rowTitle}>{displayName}</Text>
                        <Text style={styles.rowSubtitle}>{item.destination_address}</Text>
                        <StatusPill status="Cancelled" label={statusLabel} />
                      </View>
                    </Card>
                  );
                })
              )}
            </View>

            <View style={styles.groupsSection}>
              <Text style={styles.sectionTitle}>{t('admin.historyGroupsTitle')}</Text>
              {historyGroups.length === 0 ? (
                <Text style={styles.emptyText}>{t('admin.noGroups')}</Text>
              ) : visibleHistoryGroups.length === 0 ? (
                <Text style={styles.emptyText}>{t('admin.historyEmpty')}</Text>
              ) : (
                visibleHistoryGroups.map((group) => {
                  const fareLabel =
                    group.total_fare != null
                      ? t('admin.groupFareSet', { amount: group.total_fare.toFixed(2) })
                      : t('admin.groupFareNotSet');
                  const statusLabel = t('groupDetail.statusDissolved');
                  const createdLabel = t('admin.groupCreatedLabel', { date: formatBarcelonaDateTime(group.created_at) });
                  return (
                    <Card
                      key={group.id}
                      onPress={() => setOpenGroupId(group.id)}
                      style={styles.groupRow}
                      accessibilityLabel={`${createdLabel}, ${fareLabel}, ${statusLabel}`}
                    >
                      <Text style={styles.groupTitle}>{createdLabel}</Text>
                      <Text style={styles.groupSubtitle}>{fareLabel}</Text>
                      <StatusPill status="Cancelled" label={statusLabel} />
                    </Card>
                  );
                })
              )}
            </View>

            {hiddenHistoryCount > 0 || showAllHistory ? (
              <View style={styles.historyToggle}>
                <Text style={styles.emptyText}>
                  {showAllHistory
                    ? t('admin.showingAllHistory')
                    : t('admin.historyHiddenNotice', { count: hiddenHistoryCount, days: ADMIN_HISTORY_DEFAULT_WINDOW_DAYS })}
                </Text>
                <SecondaryButton
                  label={
                    showAllHistory
                      ? t('admin.showRecentHistory', { days: ADMIN_HISTORY_DEFAULT_WINDOW_DAYS })
                      : t('admin.showAllHistory')
                  }
                  onPress={() => setShowAllHistory((prev) => !prev)}
                />
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
  tabRow: {
    flexDirection: 'row',
    marginBottom: spacing.x4,
    borderRadius: 10,
    backgroundColor: overlays.overlayWhite08,
    padding: spacing.x1,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.x2,
    borderRadius: 8,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.accentPrimaryStrong,
  },
  tabText: {
    ...baseText.bodySmall,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  tabTextActive: {
    color: colors.white,
  },
  dayHeader: {
    ...baseText.label,
    color: colors.textSecondary,
    marginTop: spacing.x2,
    marginBottom: spacing.x2,
  },
  historyToggle: {
    alignItems: 'center',
    marginTop: spacing.x4,
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
