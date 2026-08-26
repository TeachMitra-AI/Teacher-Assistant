// One student's day-by-day attendance for a month (§13) — pushed from
// Monthly Summary's per-student row. Native port of the day-list content
// client/src/components/classroom/AttendanceMonthly.tsx renders inline on
// expand, as its own full screen instead (this app's push-not-expand
// idiom, §12) with its own month nav so browsing doesn't require a round
// trip back to Monthly Summary.
import React from 'react';
import { View, FlatList, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ChevronLeft, ChevronRight, CalendarX } from 'lucide-react-native';
import type { ClassroomStackParamList } from '../../../navigation/types';
import { ThemedText } from '../../../components/ThemedText';
import { Button } from '../../../components/Button';
import { SummaryTile, SummaryTileRow } from '../../../components/SummaryTile';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing, radius } from '../../../theme/tokens';
import { formatDateLabel, formatMonthLabel } from '../../../lib/classroomDate';
import { useStudentAttendanceHistoryScreen } from './useStudentAttendanceHistoryScreen';

function pct(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

type Props = NativeStackScreenProps<ClassroomStackParamList, 'StudentAttendanceHistory'>;

export function StudentAttendanceHistoryScreen({ route }: Props) {
  const { colors } = useTheme();
  const { studentId, month: initialMonth } = route.params;
  const { month, currentMonth, history, loading, error, goToPreviousMonth, goToNextMonth, reload } =
    useStudentAttendanceHistoryScreen(studentId, initialMonth);

  const atCurrentMonth = month >= currentMonth;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.monthNav}>
        <Pressable
          onPress={goToPreviousMonth}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          style={[styles.navBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
        >
          <ChevronLeft size={18} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.monthLabel}>{formatMonthLabel(month)}</ThemedText>
        <Pressable
          onPress={goToNextMonth}
          disabled={atCurrentMonth}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Next month"
          style={[styles.navBtn, { backgroundColor: colors.surface2, borderColor: colors.border }, atCurrentMonth && styles.navBtnDisabled]}
        >
          <ChevronRight size={18} color={atCurrentMonth ? colors.textMuted : colors.text} />
        </Pressable>
      </View>

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.orange} />
          <ThemedText variant="muted" style={styles.centerText}>Loading history…</ThemedText>
        </View>
      )}

      {!loading && !!error && (
        <View style={styles.center}>
          <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>
          <Button title="Retry" variant="secondary" onPress={reload} />
        </View>
      )}

      {!loading && !error && history && (
        <>
          <SummaryTileRow>
            <SummaryTile label="Present" value={history.present} tone="positive" />
            <SummaryTile label="Absent" value={history.absent} tone="negative" />
            <SummaryTile label="Unmarked" value={history.unmarked} />
            <SummaryTile label="Attendance" value={pct(history.percentage)} />
          </SummaryTileRow>

          {history.days.length === 0 && (
            <View style={styles.center} testID="student-history-empty-state">
              <View style={[styles.emptyIconWell, { backgroundColor: colors.surface2 }]}>
                <CalendarX size={26} color={colors.textMuted} strokeWidth={1.8} />
              </View>
              <ThemedText variant="title" style={styles.emptyTitle}>No attendance recorded</ThemedText>
              <ThemedText variant="muted" style={styles.emptyHint}>{history.name} has no marked days this month.</ThemedText>
            </View>
          )}

          {history.days.length > 0 && (
            <FlatList
              data={history.days}
              keyExtractor={(d) => d.date}
              contentContainerStyle={styles.list}
              testID="student-history-day-list"
              renderItem={({ item }) => {
                const isPresent = item.status === 'present';
                const tone = isPresent ? colors.semantic.success : colors.semantic.danger;
                return (
                  <View style={[styles.dayRow, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                    <ThemedText style={styles.dayLabel}>{formatDateLabel(item.date)}</ThemedText>
                    <ThemedText style={{ color: tone.text, fontWeight: '700' }}>{isPresent ? 'Present' : 'Absent'}</ThemedText>
                  </View>
                );
              }}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  navBtn: {
    width: 36, height: 36, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  navBtnDisabled: { opacity: 0.4 },
  monthLabel: { fontSize: 16, fontWeight: '700' },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  centerText: { marginTop: spacing.xs },
  emptyIconWell: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: spacing.sm, textAlign: 'center' },
  emptyHint: { textAlign: 'center', paddingHorizontal: spacing.xl },
  list: { gap: spacing.sm, paddingBottom: spacing.xxl },
  dayRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: spacing.md, minHeight: 48,
  },
  dayLabel: { fontSize: 14, fontWeight: '600' },
});
