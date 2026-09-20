// Native port of client/src/components/attendance/MiniCalendarStrip.tsx — a
// colour-coded 7-column grid so a month's shape (mostly green, one amber
// day) reads at a glance, before reading a single row. Shared by
// HistoryScreen (a teacher's own month) and ReportsScreen's drill-down (the
// Principal's view of someone else's).
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/tokens';
import type { HistoryRow } from '../../lib/teacherAttendanceCalendar';

const WEEKDAY_HEADS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

type CellClass = 'present' | 'warning' | 'absent' | 'off';

function cellClass(row: HistoryRow): CellClass {
  if (row.record) {
    if (row.record.status === 'absent') return 'absent';
    if (row.record.status === 'flagged_review' || row.record.status === 'pending_regularization') return 'warning';
    if (row.record.lateMinutes || (row.record.shortfallMinutes ?? 0) > 0) return 'warning';
    return 'present';
  }
  if (row.offLabel) return 'off';
  return 'absent'; // no record, no reason to be off — genuinely absent
}

export function AttendanceCalendarStrip({ rows }: { rows: HistoryRow[] }) {
  const { colors } = useTheme();
  if (rows.length === 0) return null;

  const [y, m, d] = rows[0].date.split('-').map(Number);
  const firstWeekday = new Date(y, m - 1, d).getDay();

  const tone: Record<CellClass, { bg: string; border: string; text: string }> = {
    present: { bg: colors.semantic.success.bg, border: colors.semantic.success.border, text: colors.semantic.success.text },
    warning: { bg: colors.semantic.warning.bg, border: colors.semantic.warning.border, text: colors.semantic.warning.text },
    absent: { bg: colors.semantic.danger.bg, border: colors.semantic.danger.border, text: colors.semantic.danger.text },
    off: { bg: colors.surface2, border: colors.border, text: colors.textMuted },
  };

  return (
    <View accessibilityRole="image" accessibilityLabel="This month at a glance" style={styles.grid}>
      {WEEKDAY_HEADS.map((label, i) => (
        <View key={`head-${i}`} style={styles.cell}>
          <ThemedText variant="muted" style={styles.headLabel}>{label}</ThemedText>
        </View>
      ))}
      {Array.from({ length: firstWeekday }).map((_, i) => (
        <View key={`lead-${i}`} style={styles.cell} />
      ))}
      {rows.map((row) => {
        const t = tone[cellClass(row)];
        return (
          <View key={row.date} style={styles.cell}>
            <View style={[styles.bubble, { backgroundColor: t.bg, borderColor: t.border }]}>
              <ThemedText style={[styles.dayNumber, { color: t.text }]}>{Number(row.date.slice(-2))}</ThemedText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginVertical: spacing.sm },
  cell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  headLabel: { fontSize: 11, fontWeight: '600' },
  bubble: { width: '82%', height: '82%', borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  dayNumber: { fontSize: 11, fontWeight: '600' },
});
