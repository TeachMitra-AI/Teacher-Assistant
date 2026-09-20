// Native port of client/src/components/attendance/HistoryTab.tsx — a
// teacher's own month, with a mini calendar strip + summary line + a
// day-by-day list.
import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { ChevronLeft, ChevronRight, AlertTriangle } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../auth/AuthContext';
import { spacing, radius } from '../../theme/tokens';
import { ApiError } from '../../api/client';
import { getAttendanceHistory, getSchoolConfig, getHolidays } from '../../api/teacherAttendanceApi';
import { addMonths, currentMonthString, formatMonthLabel, todayDateString } from '../../lib/classroomDate';
import { buildMonthDates, sinceDateFor, buildRows, summarizeRows, formatSummary, type HistoryRow } from '../../lib/teacherAttendanceCalendar';
import { AttendanceCalendarStrip } from './AttendanceCalendarStrip';
import { AttendanceHistoryRow } from './AttendanceHistoryRow';

const CURRENT_MONTH = currentMonthString();

export function HistoryScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [month, setMonth] = useState(CURRENT_MONTH);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [records, config, holidays] = await Promise.all([
        getAttendanceHistory(month),
        getSchoolConfig(),
        getHolidays(),
      ]);
      const dates = config
        ? buildMonthDates(month, todayDateString(), sinceDateFor(config, user?.createdAt))
        : records.map((r) => r.date);
      setRows(buildRows(dates, records, config, holidays));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your attendance history.');
    } finally {
      setLoading(false);
    }
  }, [month, user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const summary = rows.length > 0 ? summarizeRows(rows) : null;

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      <View style={styles.nav}>
        <Pressable
          onPress={() => setMonth((m) => addMonths(m, -1))}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          style={[styles.navBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
        >
          <ChevronLeft size={18} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.navLabel}>{formatMonthLabel(month)}</ThemedText>
        <Pressable
          onPress={() => setMonth((m) => addMonths(m, 1))}
          disabled={month >= CURRENT_MONTH}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          style={[styles.navBtn, { backgroundColor: colors.surface2, borderColor: colors.border }, month >= CURRENT_MONTH && styles.navBtnDisabled]}
        >
          <ChevronRight size={18} color={month >= CURRENT_MONTH ? colors.textMuted : colors.text} />
        </Pressable>
      </View>

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.orange} />
        </View>
      )}

      {!loading && !!error && (
        <View style={[styles.banner, { backgroundColor: colors.semantic.danger.bg, borderColor: colors.semantic.danger.border }]}>
          <AlertTriangle size={16} color={colors.semantic.danger.text} />
          <ThemedText style={{ color: colors.semantic.danger.text, flex: 1 }}>{error}</ThemedText>
        </View>
      )}

      {!loading && !error && rows.length === 0 && (
        <ThemedText variant="muted" style={styles.hint}>No attendance recorded for this month.</ThemedText>
      )}

      {!loading && !error && rows.length > 0 && summary && (
        <>
          <AttendanceCalendarStrip rows={rows} />
          <ThemedText variant="muted" style={styles.summary}>{formatSummary(summary)}</ThemedText>
          <View style={[styles.list, { borderColor: colors.border }]}>
            {rows.map((row) => (
              <AttendanceHistoryRow key={row.date} row={row} />
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.sm },
  nav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  navBtnDisabled: { opacity: 0.4 },
  navLabel: { fontSize: 16, fontWeight: '700' },
  center: { alignItems: 'center', paddingVertical: spacing.xl },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
  hint: { fontSize: 13, textAlign: 'center', paddingVertical: spacing.lg },
  summary: { fontSize: 13, textAlign: 'center' },
  list: { marginTop: spacing.sm },
});
