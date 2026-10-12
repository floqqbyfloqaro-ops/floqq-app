import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AIRLINE_TERMINAL_CHECK } from '../constants';
import { airlinesToCheck, AirlineTerminalRow, TerminalMismatch } from '../services/airlineTerminalRules';
import {
  deleteAirlineTerminal,
  fetchAirlineTerminals,
  fetchTerminalMismatches,
  saveAirlineTerminal,
  setAirlineTerminal,
} from '../services/airlineTerminals';
import { ARRIVAL_TERMINALS, ArrivalTerminal } from '../services/terminalRules';
import { baseText, borders, colors, radii, spacing } from '../theme/colors';
import AuthTextInput from './AuthTextInput';
import Card from './Card';
import ErrorNotice from './ErrorNotice';
import PrimaryButton from './PrimaryButton';
import Skeleton from './Skeleton';

type Props = {
  // Only the "Check airline terminal" warnings, for the top of the dashboard's first tab.
  warningsOnly?: boolean;
  // Reloads when this changes (the dashboard's pull-to-refresh).
  refreshKey?: number;
};

// Admin dashboard, "Airlines" tab: which airline lands at which terminal. A passenger who types a
// flight number gets their terminal from this table; flight data confirms or corrects it later,
// and an airline it keeps contradicting is flagged here.
export default function AdminAirlineTerminals({ warningsOnly = false, refreshKey = 0 }: Props) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AirlineTerminalRow[]>([]);
  const [mismatches, setMismatches] = useState<TerminalMismatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [removingCode, setRemovingCode] = useState<string | null>(null);

  const [newIata, setNewIata] = useState('');
  const [newIcao, setNewIcao] = useState('');
  const [newName, setNewName] = useState('');
  const [newTerminal, setNewTerminal] = useState<ArrivalTerminal | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    const [rowsResult, mismatchesResult] = await Promise.all([fetchAirlineTerminals(), fetchTerminalMismatches()]);
    setIsLoading(false);
    if (rowsResult.error) {
      console.warn('fetchAirlineTerminals failed', rowsResult.error);
      setLoadFailed(true);
      return;
    }
    // The table is usable without the warnings.
    if (mismatchesResult.error) console.warn('fetchTerminalMismatches failed', mismatchesResult.error);
    setLoadFailed(false);
    setRows(rowsResult.data ?? []);
    setMismatches(mismatchesResult.data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const toCheck = airlinesToCheck(mismatches, rows, Date.now(), AIRLINE_TERMINAL_CHECK);
  const warnings = toCheck.map((item) => {
    const row = rows.find((r) => r.airline_iata === item.airline_iata);
    return (
      <Card key={`${item.airline_iata}-${item.reported_terminal}`} style={styles.row}>
        <Text style={styles.warningTitle}>{t('adminAirlines.checkTitle', { code: item.airline_iata })}</Text>
        <Text style={styles.warningText}>
          {t('adminAirlines.checkDetail', {
            name: row?.airline_name || item.airline_iata,
            reported: item.reported_terminal,
            table: row?.terminal,
            flights: item.flights,
            days: AIRLINE_TERMINAL_CHECK.windowDays,
          })}
        </Text>
      </Card>
    );
  });

  if (warningsOnly) {
    return warnings.length > 0 ? <View>{warnings}</View> : null;
  }

  if (isLoading) {
    return (
      <View accessible accessibilityLabel={t('admin.loading')}>
        {[0, 1, 2].map((i) => (
          <Card key={i} style={styles.row}>
            <Skeleton width={160} height={18} style={styles.skeletonGap} />
            <Skeleton width={120} height={32} />
          </Card>
        ))}
      </View>
    );
  }

  if (loadFailed) {
    return <ErrorNotice message={t('adminAirlines.loadError')} onRetry={load} retryLabel={t('common.retry')} />;
  }

  const handleSetTerminal = async (row: AirlineTerminalRow, terminal: ArrivalTerminal) => {
    if (row.terminal === terminal) return;
    setErrorMessage(null);
    setRows((prev) => prev.map((r) => (r.airline_iata === row.airline_iata ? { ...r, terminal } : r)));
    const { error } = await setAirlineTerminal(row.airline_iata, terminal);
    if (error) {
      console.warn('setAirlineTerminal failed', error);
      setErrorMessage(t('adminAirlines.saveError'));
      load();
    }
  };

  const handleRemove = async (row: AirlineTerminalRow) => {
    setErrorMessage(null);
    setRemovingCode(null);
    const { error } = await deleteAirlineTerminal(row.airline_iata);
    if (error) {
      console.warn('deleteAirlineTerminal failed', error);
      setErrorMessage(t('adminAirlines.saveError'));
      return;
    }
    setRows((prev) => prev.filter((r) => r.airline_iata !== row.airline_iata));
  };

  const handleAdd = async () => {
    const airlineIata = newIata.trim().toUpperCase();
    const airlineIcao = newIcao.trim().toUpperCase();
    if (!/^[A-Z0-9]{2}$/.test(airlineIata) || (airlineIcao && !/^[A-Z]{3}$/.test(airlineIcao))) {
      setErrorMessage(t('adminAirlines.codeError'));
      return;
    }
    if (!newTerminal) {
      setErrorMessage(t('adminAirlines.terminalError'));
      return;
    }
    setErrorMessage(null);
    setIsSaving(true);
    const { error } = await saveAirlineTerminal({
      airlineIata,
      airlineIcao: airlineIcao || null,
      airlineName: newName.trim(),
      terminal: newTerminal,
    });
    setIsSaving(false);
    if (error) {
      console.warn('saveAirlineTerminal failed', error);
      setErrorMessage(t('adminAirlines.saveError'));
      return;
    }
    setNewIata('');
    setNewIcao('');
    setNewName('');
    setNewTerminal(null);
    load();
  };

  const terminalButtons = (selected: ArrivalTerminal | null, onSelect: (terminal: ArrivalTerminal) => void, label: string) => (
    <View style={styles.terminalRow} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {ARRIVAL_TERMINALS.map((terminal) => {
        const isSelected = selected === terminal;
        return (
          <Pressable
            key={terminal}
            style={[styles.terminalOption, isSelected && styles.terminalOptionSelected]}
            onPress={() => onSelect(terminal)}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={`${label}: ${terminal}`}
          >
            <Text style={[styles.terminalOptionLabel, isSelected && styles.terminalOptionLabelSelected]}>{terminal}</Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View>
      <Text style={styles.intro}>{t('adminAirlines.intro')}</Text>

      {warnings}

      {errorMessage ? <ErrorNotice message={errorMessage} /> : null}

      <Card style={styles.row}>
        <Text style={styles.sectionTitle}>{t('adminAirlines.addTitle')}</Text>
        <AuthTextInput
          placeholder={t('adminAirlines.codePlaceholder')}
          accessibilityLabel={t('adminAirlines.codePlaceholder')}
          value={newIata}
          onChangeText={setNewIata}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={2}
        />
        <AuthTextInput
          placeholder={t('adminAirlines.icaoPlaceholder')}
          accessibilityLabel={t('adminAirlines.icaoPlaceholder')}
          value={newIcao}
          onChangeText={setNewIcao}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={3}
        />
        <AuthTextInput
          placeholder={t('adminAirlines.namePlaceholder')}
          accessibilityLabel={t('adminAirlines.namePlaceholder')}
          value={newName}
          onChangeText={setNewName}
        />
        {terminalButtons(newTerminal, setNewTerminal, t('adminAirlines.terminalLabel'))}
        <PrimaryButton label={t('adminAirlines.add')} onPress={handleAdd} loading={isSaving} />
      </Card>

      {rows.length === 0 ? <Text style={styles.emptyText}>{t('adminAirlines.empty')}</Text> : null}
      {ARRIVAL_TERMINALS.map((terminal) => {
        const terminalRows = rows.filter((row) => row.terminal === terminal);
        if (terminalRows.length === 0) return null;
        return (
          <View key={terminal}>
            <Text style={styles.terminalHeader} accessibilityRole="header">
              {t('adminAirlines.terminalHeader', { terminal, total: terminalRows.length })}
            </Text>
            {terminalRows.map((row) => {
              const codes = row.airline_icao ? `${row.airline_iata} · ${row.airline_icao}` : row.airline_iata;
              return (
                <Card key={row.airline_iata} style={styles.row}>
                  <Text style={styles.name}>{row.airline_name || row.airline_iata}</Text>
                  <Text style={styles.code}>{codes}</Text>
                  {terminalButtons(
                    row.terminal,
                    (picked) => handleSetTerminal(row, picked),
                    row.airline_name || row.airline_iata
                  )}
                  {removingCode === row.airline_iata ? (
                    <View style={styles.removeRow}>
                      <Pressable
                        onPress={() => handleRemove(row)}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        accessibilityRole="button"
                      >
                        <Text style={styles.removeConfirm}>
                          {t('adminAirlines.removeConfirm', { code: row.airline_iata })}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => setRemovingCode(null)}
                        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                        accessibilityRole="button"
                      >
                        <Text style={styles.removeLink}>{t('adminAirlines.keep')}</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      onPress={() => setRemovingCode(row.airline_iata)}
                      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                      accessibilityRole="button"
                      accessibilityLabel={`${t('adminAirlines.remove')}: ${row.airline_name || row.airline_iata}`}
                    >
                      <Text style={styles.removeLink}>{t('adminAirlines.remove')}</Text>
                    </Pressable>
                  )}
                </Card>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginBottom: spacing.x3,
  },
  skeletonGap: {
    marginBottom: spacing.x2,
  },
  intro: {
    ...baseText.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.x4,
  },
  sectionTitle: {
    ...baseText.h3,
    marginBottom: spacing.x3,
  },
  emptyText: {
    ...baseText.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.x4,
  },
  terminalHeader: {
    ...baseText.h3,
    marginTop: spacing.x2,
    marginBottom: spacing.x3,
  },
  name: {
    ...baseText.body,
    fontWeight: '600',
    marginBottom: spacing.x1,
  },
  code: {
    ...baseText.caption,
    color: colors.info,
    marginBottom: spacing.x2,
  },
  warningTitle: {
    ...baseText.body,
    color: colors.warning,
    fontWeight: '700',
    marginBottom: spacing.x1,
  },
  warningText: {
    ...baseText.caption,
    color: colors.warning,
  },
  terminalRow: {
    flexDirection: 'row',
    gap: spacing.x3,
    marginBottom: spacing.x3,
  },
  terminalOption: {
    flex: 1,
    minHeight: 44,
    borderRadius: radii.lg,
    borderWidth: borders.regular,
    borderColor: colors.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  terminalOptionSelected: {
    borderColor: colors.accentPrimary,
    backgroundColor: colors.accentPrimarySoft,
  },
  terminalOptionLabel: {
    ...baseText.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  terminalOptionLabelSelected: {
    color: colors.textPrimary,
  },
  removeRow: {
    flexDirection: 'row',
    gap: spacing.x6,
  },
  removeLink: {
    ...baseText.caption,
    color: colors.textPrimary,
    textDecorationLine: 'underline',
  },
  removeConfirm: {
    ...baseText.caption,
    color: colors.warning,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
});
