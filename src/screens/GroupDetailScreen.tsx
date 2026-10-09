import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import AdminGroupPayments from '../components/AdminGroupPayments';
import { adminWordingLanguage } from '../components/AdminMeetingPoints';
import AdminReceiptReview from '../components/AdminReceiptReview';
import AuthTextInput from '../components/AuthTextInput';
import Card from '../components/Card';
import ErrorNotice from '../components/ErrorNotice';
import PrimaryButton from '../components/PrimaryButton';
import RideDateLine, { formatRideDateTime, rideDateAccessibilityText } from '../components/RideDateLine';
import ScreenBackground from '../components/ScreenBackground';
import SecondaryButton from '../components/SecondaryButton';
import Skeleton from '../components/Skeleton';
import StatusPill from '../components/StatusPill';
import { MAX_PASSENGERS_PER_TAXI, PAYMENTS_ENABLED } from '../constants';
import {
  addGroupMember,
  confirmTaxiGroup,
  dissolveGroup,
  fetchGroupById,
  fetchGroupMembers,
  fetchPendingRequests,
  fetchPayoutStatusForUser,
  fetchReceiptShares,
  PendingPassengerRequest,
  ReceiptShareRow,
  removeGroupMember,
  setGroupMeetingPoint,
  TaxiGroupMember,
  TaxiGroupStatus,
  updateGroupTotalFare,
  updatePassengerDistance,
} from '../services/adminGrouping';
import { calculateFareSplit, FareSplitResult } from '../services/fareSplit';
import { fetchRideReceipt, formatCents, RideReceipt, syncGroupHolds } from '../services/payments';
import { MeetingPoint, meetingPointText } from '../services/meetingPointRules';
import { fetchMeetingPoints, shippedText } from '../services/meetingPoints';
import { sameTerminal, terminalOfMeetingPoint } from '../services/terminalRules';
import { baseText, colors, overlays, radii, spacing } from '../theme/colors';

type Props = {
  groupId: string;
  onBack: () => void;
};

// Every correction (remove/add/dissolve) asks for confirmation inline rather than via
// Alert.alert, which is a no-op for multi-button alerts on react-native-web (see HomeScreen's
// ActiveRidePrompt for the same pattern). 'add' has an extra 'warning' step when the candidate
// doesn't meet the compatibility rules - the admin has to see that and choose to force it.
type PendingGroupAction =
  | { type: 'remove'; member: TaxiGroupMember }
  | { type: 'add'; candidate: PendingPassengerRequest; step: 'confirm' | 'warning' }
  | { type: 'dissolve' };

// A ride may have no flight number (and an account no name): a dash rather than an empty title.
function memberDisplayName(member: TaxiGroupMember) {
  return member.passenger_name?.trim() || member.flight_number || '—';
}

function candidateDisplayName(candidate: PendingPassengerRequest) {
  return candidate.passenger_name?.trim() || candidate.flight_number || '—';
}

export default function GroupDetailScreen({ groupId, onBack }: Props) {
  const { t, i18n } = useTranslation();

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
  // Payments prototype, phase 4: who pays the taxi, and whether their payout is set up.
  const [payer, setPayer] = useState<{ requestId: string; payout: string } | null>(null);
  // Phase 5: the payer's taxi receipt and each member's part of it.
  const [receipt, setReceipt] = useState<RideReceipt | null>(null);
  const [receiptShares, setReceiptShares] = useState<Record<string, ReceiptShareRow>>({});

  const [isAddingOpen, setIsAddingOpen] = useState(false);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [candidates, setCandidates] = useState<PendingPassengerRequest[]>([]);
  const [pendingAction, setPendingAction] = useState<PendingGroupAction | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Where a confirmed group meets at the airport: assigned automatically, the admin may override.
  const [meetingPoint, setMeetingPoint] = useState<{ id: string | null; time: string | null }>({ id: null, time: null });
  const [meetingPoints, setMeetingPoints] = useState<MeetingPoint[]>([]);
  const [isPickingMeetingPoint, setIsPickingMeetingPoint] = useState(false);
  const [isSavingMeetingPoint, setIsSavingMeetingPoint] = useState(false);
  const [meetingPointError, setMeetingPointError] = useState<string | null>(null);

  const canCorrect = groupStatus === 'unconfirmed';

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
      setMeetingPoint({ id: groupResult.data.meeting_point_id, time: groupResult.data.meeting_time });
    }


    if (PAYMENTS_ENABLED && groupResult.data?.payer_request_id) {
      const payerUserId = groupResult.data.payer_user_id;
      const payout = payerUserId ? (await fetchPayoutStatusForUser(payerUserId)).data?.payout_onboarding_status : null;
      setPayer({
        requestId: groupResult.data.payer_request_id,
        payout: payout ?? 'NOT_STARTED',
      });
    } else {
      setPayer(null);
    }

    if (PAYMENTS_ENABLED) {
      const [receiptResult, sharesResult] = await Promise.all([fetchRideReceipt(groupId), fetchReceiptShares(groupId)]);
      if (receiptResult.error) console.warn('fetchRideReceipt failed', receiptResult.error);
      if (sharesResult.error) console.warn('fetchReceiptShares failed', sharesResult.error);
      setReceipt(receiptResult.data ?? null);
      setReceiptShares(Object.fromEntries((sharesResult.data ?? []).map((row) => [row.request_id, row])));
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

  // The points to choose from, once the group is confirmed (also when it was confirmed just now,
  // on this screen).
  useEffect(() => {
    if (groupStatus !== 'confirmed') return;
    fetchMeetingPoints().then(({ data, error }) => {
      if (error) console.warn('fetchMeetingPoints failed', error);
      setMeetingPoints(data ?? []);
    });
  }, [groupStatus]);

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

    // Payments prototype: create the passengers' seat reservations right away (the 5-minute
    // payments-sync-holds job would otherwise pick the group up on its next run).
    if (PAYMENTS_ENABLED) {
      const { error: syncError } = await syncGroupHolds(groupId);
      if (syncError) console.warn('syncGroupHolds failed', syncError);
    }
  };

  const handleToggleAdding = async () => {
    setActionError(null);
    if (isAddingOpen) {
      setIsAddingOpen(false);
      return;
    }

    setIsAddingOpen(true);
    setIsLoadingCandidates(true);
    const { data, error } = await fetchPendingRequests();
    setIsLoadingCandidates(false);

    if (error) {
      console.warn('fetchPendingRequests failed', error);
      setActionError(t('groupDetail.addLoadError'));
      return;
    }
    setCandidates(data ?? []);
  };

  const handleCancelAction = () => {
    setPendingAction(null);
    setActionError(null);
  };

  // A group only holds passengers arriving at the same terminal (also enforced by the server and
  // the database): why this candidate can't join, or null when they can.
  const groupTerminal = members[0]?.arrival_terminal ?? null;
  const terminalBlockMessage = (candidate: PendingPassengerRequest) =>
    candidate.arrival_terminal
      ? t('groupDetail.addTerminalError', {
          name: candidateDisplayName(candidate),
          terminal: candidate.arrival_terminal,
          groupTerminal: groupTerminal ?? t('admin.terminalUnknown'),
        })
      : t('admin.terminalUnknownError', { name: candidateDisplayName(candidate) });

  const wordingLanguage = adminWordingLanguage(i18n.language);
  const meetingPointLabel = (point: MeetingPoint) =>
    `${point.short_code} · ${meetingPointText(point, 'name', wordingLanguage, shippedText)}`;
  const currentMeetingPoint = meetingPoints.find((point) => point.id === meetingPoint.id) ?? null;
  // Only active points at the group's own terminal can be picked (the server checks it too).
  const pickableMeetingPoints = meetingPoints.filter(
    (point) => point.is_active && groupTerminal != null && terminalOfMeetingPoint(point.terminal) === groupTerminal
  );

  const handleSetMeetingPoint = async (meetingPointId: string | null) => {
    setMeetingPointError(null);
    setIsSavingMeetingPoint(true);
    const { error, blockedReason } = await setGroupMeetingPoint(groupId, meetingPointId);
    setIsSavingMeetingPoint(false);
    if (error || blockedReason) {
      console.warn('setGroupMeetingPoint failed', error ?? blockedReason);
      setMeetingPointError(t('groupDetail.meetingPointError'));
      return;
    }
    setIsPickingMeetingPoint(false);
    await loadData();
  };

  const handlePickCandidate = (candidate: PendingPassengerRequest) => {
    if (!sameTerminal(candidate.arrival_terminal, groupTerminal)) {
      setActionError(terminalBlockMessage(candidate));
      return;
    }
    setActionError(null);
    setPendingAction({ type: 'add', candidate, step: 'confirm' });
  };

  const handleRunAction = async () => {
    if (!pendingAction) return;
    setActionError(null);
    setIsActing(true);

    if (pendingAction.type === 'remove') {
      const { error, blockedReason } = await removeGroupMember(groupId, pendingAction.member.id);
      setIsActing(false);

      if (blockedReason === 'group_confirmed') {
        setGroupStatus('confirmed');
        setPendingAction(null);
        setActionError(t('groupDetail.lockedExplanation'));
        return;
      }
      if (error) {
        console.warn('removeGroupMember failed', error);
        setActionError(t('groupDetail.removeError'));
        return;
      }
      setPendingAction(null);
      await loadData();
      return;
    }

    if (pendingAction.type === 'dissolve') {
      const { error, blockedReason } = await dissolveGroup(groupId);
      setIsActing(false);

      if (blockedReason === 'group_confirmed') {
        setGroupStatus('confirmed');
        setPendingAction(null);
        setActionError(t('groupDetail.lockedExplanation'));
        return;
      }
      if (error) {
        console.warn('dissolveGroup failed', error);
        setActionError(t('groupDetail.dissolveError'));
        return;
      }
      onBack();
      return;
    }

    // pendingAction.type === 'add'
    const candidateId = pendingAction.candidate.id;
    const result = await addGroupMember(groupId, candidateId, pendingAction.step === 'warning');
    setIsActing(false);

    if (result.warning) {
      setPendingAction({ type: 'add', candidate: pendingAction.candidate, step: 'warning' });
      return;
    }
    if (result.blockedReason === 'group_confirmed') {
      setGroupStatus('confirmed');
      setPendingAction(null);
      setActionError(t('groupDetail.lockedExplanation'));
      return;
    }
    if (result.blockedReason === 'group_full') {
      setPendingAction(null);
      setActionError(t('groupDetail.addFullError'));
      return;
    }
    if (result.blockedReason === 'terminal_mismatch') {
      setPendingAction(null);
      setActionError(terminalBlockMessage(pendingAction.candidate));
      return;
    }
    if (result.blockedReason === 'request_not_available' || result.blockedReason === 'stale') {
      setPendingAction(null);
      setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
      setActionError(t('groupDetail.addUnavailableError'));
      return;
    }
    if (result.error) {
      console.warn('addGroupMember failed', result.error);
      setActionError(t('groupDetail.addError'));
      return;
    }

    setPendingAction(null);
    setIsAddingOpen(false);
    setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
    await loadData();
  };

  const actionConfirmTitle = (() => {
    if (!pendingAction) return '';
    if (pendingAction.type === 'remove') {
      return t('groupDetail.removeConfirmTitle', { name: memberDisplayName(pendingAction.member) });
    }
    if (pendingAction.type === 'dissolve') {
      return t('groupDetail.dissolveConfirmTitle');
    }
    return pendingAction.step === 'warning'
      ? t('groupDetail.addWarningTitle', { name: candidateDisplayName(pendingAction.candidate) })
      : t('groupDetail.addConfirmTitle', { name: candidateDisplayName(pendingAction.candidate) });
  })();

  const actionConfirmButtonLabel = (() => {
    if (!pendingAction) return '';
    if (pendingAction.type === 'remove') return t('groupDetail.removeConfirmAction');
    if (pendingAction.type === 'dissolve') return t('groupDetail.dissolveConfirmAction');
    return pendingAction.step === 'warning' ? t('groupDetail.addForceAction') : t('groupDetail.addConfirmAction');
  })();

  return (
    <ScreenBackground
      source={require('../../assets/bg-airport-arrival.png')}
      naturalWidth={941}
      naturalHeight={1672}
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
                status={groupStatus === 'confirmed' ? 'Group Confirmed' : groupStatus === 'dissolved' ? 'Cancelled' : 'Searching'}
                label={
                  groupStatus === 'confirmed'
                    ? t('groupDetail.statusConfirmed')
                    : groupStatus === 'dissolved'
                      ? t('groupDetail.statusDissolved')
                      : t('groupDetail.statusUnconfirmed')
                }
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

            {!canCorrect ? (
              <Text style={styles.lockedNote}>
                {groupStatus === 'confirmed' ? t('groupDetail.lockedExplanation') : t('groupDetail.dissolvedExplanation')}
              </Text>
            ) : null}

            {receipt ? <AdminReceiptReview groupId={groupId} receipt={receipt} onChanged={loadData} /> : null}

            {PAYMENTS_ENABLED ? (
              <AdminGroupPayments
                groupId={groupId}
                receipt={receipt}
                payerRequestId={payer?.requestId ?? null}
                payerPayout={payer?.payout ?? null}
              />
            ) : null}

            {pendingAction ? (
              <Card style={styles.actionConfirmCard}>
                <Text style={styles.actionConfirmText} accessibilityLiveRegion="polite">
                  {actionConfirmTitle}
                </Text>
                {actionError ? <ErrorNotice message={actionError} /> : null}
                <View style={styles.actionConfirmButtons}>
                  <PrimaryButton label={actionConfirmButtonLabel} onPress={handleRunAction} loading={isActing} />
                  <SecondaryButton label={t('groupDetail.cancelAction')} onPress={handleCancelAction} disabled={isActing} />
                </View>
              </Card>
            ) : actionError ? (
              <ErrorNotice message={actionError} />
            ) : null}

            <Text style={styles.label}>{t('groupDetail.totalFareLabel')}</Text>
            <AuthTextInput
              variant="card"
              leadingIcon="cash-outline"
              placeholder="e.g. 32.50"
              accessibilityLabel={t('groupDetail.totalFareLabel')}
              value={totalFareInput}
              onChangeText={setTotalFareInput}
              keyboardType="decimal-pad"
            />

            {members.map((member) => (
              <Card key={member.id} style={styles.memberCard}>
                <RideDateLine
                  arrivalAt={member.arrival_at}
                  flightNumber={member.flight_number}
                  arrivalTimeSource={member.arrival_time_source}
                  createdAt={member.created_at}
                />
                <Text style={styles.memberTitle}>{memberDisplayName(member)}</Text>
                <Text style={styles.memberSubtitle}>{member.destination_address}</Text>
                <Text style={styles.memberScoreNote}>
                  {member.arrival_terminal
                    ? t('admin.terminalLabel', { terminal: member.arrival_terminal })
                    : t('admin.terminalUnknown')}
                </Text>
                {member.terminal_conflict ? (
                  <Text style={styles.guaranteeNote}>
                    {t('groupDetail.terminalConflictNote', { terminal: member.terminal_conflict })}
                  </Text>
                ) : null}
                {payer?.requestId === member.id ? (
                  <Text style={styles.memberScoreNote}>
                    {t('groupDetail.payerLabel', { payout: t(`groupDetail.payout.${payer.payout}`) })}
                  </Text>
                ) : null}
                {receipt && receiptShares[member.id]?.receipt_share_cents != null ? (
                  <Text style={receiptShares[member.id].guarantee_cents > 0 ? styles.guaranteeNote : styles.memberScoreNote}>
                    {payer?.requestId === member.id
                      ? t('groupDetail.receiptSharePayer', { share: formatCents(receiptShares[member.id].receipt_share_cents!) })
                      : receiptShares[member.id].guarantee_cents > 0
                        ? t('groupDetail.receiptShareGuaranteed', {
                            share: formatCents(receiptShares[member.id].receipt_share_cents!),
                            capture: formatCents(receiptShares[member.id].final_share_cents ?? 0),
                            guarantee: formatCents(receiptShares[member.id].guarantee_cents),
                          })
                        : t('groupDetail.receiptShare', { share: formatCents(receiptShares[member.id].receipt_share_cents!) })}
                  </Text>
                ) : null}
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
                  variant="card"
                  leadingIcon="navigate-outline"
                  placeholder="e.g. 12.5"
                  accessibilityLabel={`${member.flight_number} ${t('groupDetail.distanceLabel')}`}
                  value={distanceInputs[member.id] ?? ''}
                  onChangeText={(text) => setDistanceInputs((prev) => ({ ...prev, [member.id]: text }))}
                  keyboardType="decimal-pad"
                />
                <SecondaryButton
                  label={t('groupDetail.removeButton')}
                  onPress={() => setPendingAction({ type: 'remove', member })}
                  disabled={!canCorrect}
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
                  const displayName = member ? memberDisplayName(member) : '—';
                  return (
                    <Card
                      key={r.id}
                      style={styles.resultRow}
                      accessible
                      accessibilityLabel={`${displayName}: ${r.amount.toFixed(2)} €`}
                    >
                      <Text style={styles.resultFlight}>{displayName}</Text>
                      <Text style={styles.resultAmount}>{r.amount.toFixed(2)} €</Text>
                    </Card>
                  );
                })}
              </View>
            ) : null}

            {groupStatus === 'confirmed' ? (
              <View style={styles.correctionsSection}>
                <Text style={styles.sectionTitle}>{t('groupDetail.meetingPointTitle')}</Text>
                <Text style={styles.memberTitle}>
                  {currentMeetingPoint ? meetingPointLabel(currentMeetingPoint) : t('groupDetail.meetingPointNone')}
                </Text>
                {meetingPoint.id && meetingPoint.time ? (
                  <Text style={styles.memberSubtitle}>
                    {t('groupDetail.meetingTimeLabel', { time: formatRideDateTime(t, i18n.language, meetingPoint.time) })}
                  </Text>
                ) : null}
                {meetingPointError ? <ErrorNotice message={meetingPointError} /> : null}

                <SecondaryButton
                  label={t('groupDetail.meetingPointChange')}
                  onPress={() => setIsPickingMeetingPoint((open) => !open)}
                  loading={isSavingMeetingPoint}
                />
                {isPickingMeetingPoint ? (
                  <>
                    {pickableMeetingPoints.length === 0 ? (
                      <Text style={styles.correctionsNote}>{t('groupDetail.meetingPointPickerEmpty')}</Text>
                    ) : (
                      pickableMeetingPoints.map((point) => (
                        <Card
                          key={point.id}
                          onPress={() => handleSetMeetingPoint(point.id)}
                          style={styles.candidateRow}
                          highlighted={point.id === meetingPoint.id}
                          accessibilityLabel={meetingPointLabel(point)}
                          accessibilityState={{ selected: point.id === meetingPoint.id }}
                        >
                          <Text style={styles.memberTitle}>{meetingPointLabel(point)}</Text>
                          <Text style={styles.memberSubtitle}>
                            {meetingPointText(point, 'directions', wordingLanguage, shippedText)}
                          </Text>
                        </Card>
                      ))
                    )}
                    {meetingPoint.id ? (
                      <SecondaryButton
                        label={t('groupDetail.meetingPointAuto')}
                        onPress={() => handleSetMeetingPoint(null)}
                        disabled={isSavingMeetingPoint}
                      />
                    ) : null}
                  </>
                ) : null}
              </View>
            ) : null}

            <View style={styles.correctionsSection}>
              <Text style={styles.sectionTitle}>{t('groupDetail.correctionsTitle')}</Text>

              <SecondaryButton
                label={t('groupDetail.addButton')}
                onPress={handleToggleAdding}
                disabled={!canCorrect || members.length >= MAX_PASSENGERS_PER_TAXI}
              />
              {canCorrect && members.length >= MAX_PASSENGERS_PER_TAXI ? (
                <Text style={styles.correctionsNote}>{t('groupDetail.addFullError')}</Text>
              ) : null}

              {isAddingOpen ? (
                isLoadingCandidates ? (
                  <Text style={styles.correctionsNote}>{t('groupDetail.addLoading')}</Text>
                ) : candidates.length === 0 ? (
                  <Text style={styles.correctionsNote}>{t('groupDetail.addPickerEmpty')}</Text>
                ) : (
                  candidates.map((candidate) => (
                    <Card
                      key={candidate.id}
                      onPress={() => handlePickCandidate(candidate)}
                      style={styles.candidateRow}
                      accessibilityLabel={`${candidateDisplayName(candidate)}, ${rideDateAccessibilityText(t, i18n.language, {
                        arrivalAt: candidate.arrival_at,
                        flightNumber: candidate.flight_number,
                        arrivalTimeSource: candidate.arrival_time_source,
                        createdAt: candidate.created_at,
                      })}, ${candidate.destination_address}`}
                    >
                      <RideDateLine
                        arrivalAt={candidate.arrival_at}
                        flightNumber={candidate.flight_number}
                        arrivalTimeSource={candidate.arrival_time_source}
                        createdAt={candidate.created_at}
                      />
                      <Text style={styles.memberTitle}>{candidateDisplayName(candidate)}</Text>
                      <Text style={styles.memberSubtitle}>{candidate.destination_address}</Text>
                      <Text style={styles.memberScoreNote}>
                        {candidate.arrival_terminal
                          ? t('admin.terminalLabel', { terminal: candidate.arrival_terminal })
                          : t('admin.terminalUnknown')}
                      </Text>
                    </Card>
                  ))
                )
              ) : null}

              <SecondaryButton
                label={t('groupDetail.dissolveButton')}
                onPress={() => setPendingAction({ type: 'dissolve' })}
                disabled={!canCorrect}
              />
            </View>
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
  lockedNote: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
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
    gap: spacing.x2,
  },
  guaranteeNote: {
    ...baseText.caption,
    color: colors.warning,
    fontWeight: '700',
    marginBottom: spacing.x2,
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
  actionConfirmCard: {
    marginBottom: spacing.x4,
    gap: spacing.x2,
  },
  actionConfirmText: {
    ...baseText.body,
    marginBottom: spacing.x2,
  },
  actionConfirmButtons: {
    gap: spacing.x2,
  },
  correctionsSection: {
    marginTop: spacing.x6,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.x6,
    gap: spacing.x3,
  },
  correctionsNote: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
  },
  candidateRow: {
    marginBottom: spacing.x2,
  },
});
