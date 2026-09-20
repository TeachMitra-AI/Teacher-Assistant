// Native port of client/src/components/attendance/HistoryDayRow.tsx — one
// day's row in a "fill every day of the month" list, shared by HistoryScreen
// (a teacher's own month) and ReportsScreen's per-teacher drill-down (the
// Principal's view of someone else's month, with an on-demand "Correct"
// action).
import React, { type ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '../../components/ThemedText';
import { useTheme } from '../../theme/ThemeContext';
import { spacing } from '../../theme/tokens';
import { formatDateLabel } from '../../lib/classroomDate';
import { TEACHER_ATTENDANCE_STATUS_LABEL, formatDuration } from '../../lib/teacherAttendanceLabels';
import type { HistoryRow } from '../../lib/teacherAttendanceCalendar';
import type { TeacherAttendanceDto } from '../../types';

function recordDetail(day: TeacherAttendanceDto): string {
  const flags: string[] = [];
  if (day.lateMinutes) flags.push(`Late ${formatDuration(day.lateMinutes)}`);
  if (day.shortfallMinutes) flags.push(`Short ${formatDuration(day.shortfallMinutes)}`);
  const label = TEACHER_ATTENDANCE_STATUS_LABEL[day.status];
  return flags.length === 0 ? label : `${label} · ${flags.join(' · ')}`;
}

export function AttendanceHistoryRow({ row, action }: { row: HistoryRow; action?: ReactNode }) {
  const { colors } = useTheme();
  const isAbsent = !row.record && !row.offLabel;
  return (
    <View style={[styles.row, { borderColor: colors.border }]}>
      <View style={styles.main}>
        <ThemedText style={styles.date}>{formatDateLabel(row.date)}</ThemedText>
        <ThemedText
          variant="muted"
          style={[styles.status, isAbsent && { color: colors.semantic.danger.text }]}
          numberOfLines={1}
        >
          {row.record ? recordDetail(row.record) : row.offLabel ?? 'Absent'}
        </ThemedText>
        {action}
      </View>
      {!!row.record?.reviewReason && (
        <ThemedText variant="muted" style={styles.reason}>Principal: &ldquo;{row.record.reviewReason}&rdquo;</ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, gap: 2 },
  main: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  date: { fontSize: 13, minWidth: 92 },
  status: { flex: 1, fontSize: 13 },
  reason: { fontSize: 12, fontStyle: 'italic' },
});
