// Monthly Summary (§13) — month nav + statistics + a native calendar grid
// (day-by-day, from getClassAttendanceHistory — a data shape no existing web
// screen renders yet, so this grid is genuinely new UI, not a straight port)
// + the per-student list (a native port of client/src/components/classroom/
// AttendanceMonthly.tsx's list, minus its own inline expand-to-history —
// here a tap pushes the dedicated Student Attendance History screen instead
// of expanding in place, matching this app's push-not-expand navigation
// idiom elsewhere in Classroom, §12).
import React, { useState } from 'react';
import { View, ScrollView, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { ChevronLeft, ChevronRight, ChevronRight as RowChevron, FileBarChart } from 'lucide-react-native';
import { ThemedText } from '../../../components/ThemedText';
import { Button } from '../../../components/Button';
import { SummaryTile, SummaryTileRow } from '../../../components/SummaryTile';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing, radius } from '../../../theme/tokens';
import { formatMonthLabel, daysInMonth, firstWeekdayOfMonth } from '../../../lib/classroomDate';
import { useMonthlyAttendanceScreen } from './useMonthlyAttendanceScreen';
import type { AttendanceStudentMonthStats, ClassAttendanceHistoryDay } from '../../../types';

const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function pct(value: number | null): string {
  return value === null ? '—' : `${value}%`;
}

interface MonthlyAttendanceScreenProps {
  classId: string;
  onSelectStudent: (student: { studentId: string; studentName: string; month: string }) => void;
}

export function MonthlyAttendanceScreen({ classId, onSelectStudent }: MonthlyAttendanceScreenProps) {
  const { colors } = useTheme();
  const { month, currentMonth, summary, history, loading, error, goToPreviousMonth, goToNextMonth, reload } =
    useMonthlyAttendanceScreen(classId);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const atCurrentMonth = month >= currentMonth;
  const dayMap = new Map((history?.days ?? []).map((d) => [d.date, d]));

  function dayTint(day: ClassAttendanceHistoryDay | undefined): string {
    if (!day) return colors.surface2;
    if (day.percentage === null) return colors.surface2;
    if (day.percentage >= 75) return colors.semantic.success.bg;
    if (day.percentage >= 50) return colors.semantic.warning.bg;
    return colors.semantic.danger.bg;
  }

  function dayBorder(day: ClassAttendanceHistoryDay | undefined): string {
    if (!day || day.percentage === null) return colors.border;
    if (day.percentage >= 75) return colors.semantic.success.border;
    if (day.percentage >= 50) return colors.semantic.warning.border;
    return colors.semantic.danger.border;
  }

  const totalDays = daysInMonth(month);
  const leadingBlanks = firstWeekdayOfMonth(month);
  const cells: (number | null)[] = [...Array(leadingBlanks).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedDayRecord = selectedDay ? dayMap.get(selectedDay) : undefined;

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
          <ThemedText variant="muted" style={styles.centerText}>Loading monthly summary…</ThemedText>
        </View>
      )}

      {!loading && !!error && (
        <View style={styles.center}>
          <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>
          <Button title="Retry" variant="secondary" onPress={reload} />
        </View>
      )}

      {!loading && !error && summary && (
        <ScrollView contentContainerStyle={styles.scrollContent} testID="monthly-attendance-scroll">
          <SummaryTileRow>
            <SummaryTile label="Students" value={summary.totalStudents} />
            <SummaryTile label="Days Marked" value={summary.daysMarked} />
            <SummaryTile label="Average" value={pct(summary.percentage)} />
          </SummaryTileRow>
          <SummaryTileRow>
            <SummaryTile label="Present" value={summary.present} tone="positive" />
            <SummaryTile label="Absent" value={summary.absent} tone="negative" />
            <SummaryTile label="Unmarked" value={summary.unmarked} />
          </SummaryTileRow>

          <ThemedText variant="title" style={styles.sectionTitle}>Calendar</ThemedText>
          <View style={styles.weekdayRow}>
            {WEEKDAY_LABELS.map((w, i) => (
              <View key={i} style={styles.dayCell}>
                <ThemedText variant="muted" style={styles.weekdayLabel}>{w}</ThemedText>
              </View>
            ))}
          </View>
          <View style={styles.calendarGrid} testID="attendance-calendar-grid">
            {cells.map((day, i) => {
              if (day === null) return <View key={i} style={styles.dayCell} />;
              const date = `${month}-${String(day).padStart(2, '0')}`;
              const record = dayMap.get(date);
              const isSelected = selectedDay === date;
              return (
                <View key={i} style={styles.dayCell}>
                  <Pressable
                    onPress={() => setSelectedDay(isSelected ? null : date)}
                    accessibilityRole="button"
                    accessibilityLabel={`${date}${record ? `, ${pct(record.percentage)} attendance` : ', no attendance recorded'}`}
                    testID={`attendance-day-${date}`}
                    style={[
                      styles.dayBubble,
                      { backgroundColor: dayTint(record), borderColor: isSelected ? colors.orange : dayBorder(record) },
                      isSelected && styles.dayBubbleSelected,
                    ]}
                  >
                    <ThemedText style={styles.dayNumber}>{day}</ThemedText>
                  </Pressable>
                </View>
              );
            })}
          </View>

          {selectedDay && (
            <View style={[styles.dayDetail, { backgroundColor: colors.surface2, borderColor: colors.border }]} testID="attendance-day-detail">
              <ThemedText style={styles.dayDetailTitle}>{selectedDay}</ThemedText>
              {selectedDayRecord ? (
                <ThemedText variant="muted">
                  {selectedDayRecord.present} present · {selectedDayRecord.absent} absent · {selectedDayRecord.unmarked} unmarked ·{' '}
                  {pct(selectedDayRecord.percentage)}
                </ThemedText>
              ) : (
                <ThemedText variant="muted">No attendance recorded for this day.</ThemedText>
              )}
            </View>
          )}

          <ThemedText variant="title" style={styles.sectionTitle}>Students</ThemedText>
          {summary.perStudent.length === 0 && (
            <View style={styles.center} testID="monthly-attendance-empty-state">
              <View style={[styles.emptyIconWell, { backgroundColor: colors.surface2 }]}>
                <FileBarChart size={26} color={colors.textMuted} strokeWidth={1.8} />
              </View>
              <ThemedText variant="title" style={styles.emptyTitle}>No active students</ThemedText>
              <ThemedText variant="muted" style={styles.emptyHint}>Add students to this class first, from the Students screen.</ThemedText>
            </View>
          )}
          {summary.perStudent.length > 0 && (
            <FlatList
              data={summary.perStudent}
              keyExtractor={(s) => s.studentId}
              scrollEnabled={false}
              contentContainerStyle={styles.list}
              testID="monthly-attendance-student-list"
              renderItem={({ item }: { item: AttendanceStudentMonthStats }) => (
                <Pressable
                  onPress={() => onSelectStudent({ studentId: item.studentId, studentName: item.name, month })}
                  style={[styles.studentRow, { backgroundColor: colors.surface2, borderColor: colors.border }]}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${item.name}'s attendance history`}
                >
                  <View style={styles.rowText}>
                    <ThemedText style={styles.name}>{item.name}</ThemedText>
                    {item.rollNumber && <ThemedText variant="muted" style={styles.roll}>Roll {item.rollNumber}</ThemedText>}
                  </View>
                  <View style={styles.studentStats}>
                    <ThemedText style={{ color: colors.semantic.success.text, fontSize: 12, fontWeight: '600' }}>{item.present}P</ThemedText>
                    <ThemedText style={{ color: colors.semantic.danger.text, fontSize: 12, fontWeight: '600' }}>{item.absent}A</ThemedText>
                    <ThemedText variant="muted" style={styles.statText}>{pct(item.percentage)}</ThemedText>
                    <RowChevron size={16} color={colors.textMuted} />
                  </View>
                </Pressable>
              )}
            />
          )}
        </ScrollView>
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
  scrollContent: { gap: spacing.sm, paddingBottom: spacing.xxl },
  sectionTitle: { marginTop: spacing.sm, fontSize: 15 },
  weekdayRow: { flexDirection: 'row' },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  weekdayLabel: { fontSize: 11, fontWeight: '600' },
  dayBubble: {
    width: '82%', height: '82%', borderRadius: radius.sm, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  dayBubbleSelected: { borderWidth: 2 },
  dayNumber: { fontSize: 12, fontWeight: '600' },
  dayDetail: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: spacing.md, gap: 2 },
  dayDetailTitle: { fontWeight: '700', marginBottom: 2 },
  emptyIconWell: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: spacing.sm, textAlign: 'center' },
  emptyHint: { textAlign: 'center', paddingHorizontal: spacing.xl },
  list: { gap: spacing.sm },
  studentRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: spacing.md, minHeight: 56,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  roll: { fontSize: 12 },
  studentStats: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statText: { fontSize: 12, minWidth: 36, textAlign: 'right' },
});
