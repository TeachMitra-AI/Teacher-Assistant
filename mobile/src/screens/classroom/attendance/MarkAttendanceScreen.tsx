// Daily roster marking (§13) — native re-expression of client/src/components/
// classroom/AttendanceDaily.tsx. Two ToggleButtons per student row (present/
// absent, tapping the active one clears back to unmarked), a "Mark all
// Present" quick action (mobile-only, §13), a native date picker replacing
// the web's <input type="date">, and the exact dirty-check-then-bulk-save
// model: local taps update the UI instantly, nothing persists until "Save
// Attendance" is tapped.
import React, { useState } from 'react';
import { View, FlatList, Pressable, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ChevronLeft, ChevronRight, CalendarDays, ClipboardCheck } from 'lucide-react-native';
import { ThemedText } from '../../../components/ThemedText';
import { Button } from '../../../components/Button';
import { ToggleButton } from '../../../components/ToggleButton';
import { SummaryTile, SummaryTileRow } from '../../../components/SummaryTile';
import { useTheme } from '../../../theme/ThemeContext';
import { spacing, radius } from '../../../theme/tokens';
import { formatDateLabel, parseDateString, toDateString } from '../../../lib/classroomDate';
import { useMarkAttendanceScreen } from './useMarkAttendanceScreen';
import type { AttendanceRosterEntry } from '../../../types';

export function MarkAttendanceScreen({ classId }: { classId: string }) {
  const { colors } = useTheme();
  const {
    date,
    today,
    roster,
    statuses,
    loading,
    error,
    saving,
    saveError,
    dirty,
    summary,
    goToPreviousDate,
    goToNextDate,
    setDate,
    toggle,
    markAllPresent,
    save,
    reload,
  } = useMarkAttendanceScreen(classId);

  const [pickerVisible, setPickerVisible] = useState(false);

  function handlePickerValueChange(_event: unknown, selected: Date) {
    if (Platform.OS === 'android') setPickerVisible(false);
    setDate(toDateString(selected));
  }

  function handlePickerDismiss() {
    if (Platform.OS === 'android') setPickerVisible(false);
  }

  const percentageLabel = summary.percentage === null ? '—' : `${summary.percentage}%`;
  const atToday = date >= today;

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.dateNav}>
        <Pressable
          onPress={goToPreviousDate}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Previous date"
          style={[styles.navBtn, { backgroundColor: colors.surface2, borderColor: colors.border }]}
        >
          <ChevronLeft size={18} color={colors.text} />
        </Pressable>

        <Pressable
          onPress={() => setPickerVisible(true)}
          style={styles.dateDisplay}
          accessibilityRole="button"
          accessibilityLabel={`Attendance date: ${formatDateLabel(date)}. Tap to change.`}
          testID="attendance-date-trigger"
        >
          <CalendarDays size={16} color={colors.textMuted} />
          <ThemedText style={styles.dateText}>{formatDateLabel(date)}</ThemedText>
        </Pressable>

        <Pressable
          onPress={goToNextDate}
          disabled={atToday}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Next date"
          style={[styles.navBtn, { backgroundColor: colors.surface2, borderColor: colors.border }, atToday && styles.navBtnDisabled]}
        >
          <ChevronRight size={18} color={atToday ? colors.textMuted : colors.text} />
        </Pressable>
      </View>

      {pickerVisible && (
        <DateTimePicker
          value={parseDateString(date)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          maximumDate={parseDateString(today)}
          onValueChange={handlePickerValueChange}
          onDismiss={handlePickerDismiss}
          testID="attendance-date-picker"
        />
      )}

      {!loading && !error && (
        <SummaryTileRow>
          <SummaryTile label="Present" value={summary.present} tone="positive" />
          <SummaryTile label="Absent" value={summary.absent} tone="negative" />
          <SummaryTile label="Unmarked" value={summary.unmarked} tone="neutral" />
          <SummaryTile label="Attendance" value={percentageLabel} tone="neutral" />
        </SummaryTileRow>
      )}

      {loading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.orange} />
          <ThemedText variant="muted" style={styles.centerText}>Loading roster…</ThemedText>
        </View>
      )}

      {!loading && !!error && (
        <View style={styles.center}>
          <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>
          <Button title="Retry" variant="secondary" onPress={reload} />
        </View>
      )}

      {!loading && !error && roster.length === 0 && (
        <View style={styles.center} testID="attendance-empty-state">
          <View style={[styles.emptyIconWell, { backgroundColor: colors.surface2 }]}>
            <ClipboardCheck size={26} color={colors.textMuted} strokeWidth={1.8} />
          </View>
          <ThemedText variant="title" style={styles.emptyTitle}>No active students</ThemedText>
          <ThemedText variant="muted" style={styles.emptyHint}>Add students to this class first, from the Students screen.</ThemedText>
        </View>
      )}

      {!loading && !error && roster.length > 0 && (
        <>
          <Button title="Mark all Present" variant="secondary" onPress={markAllPresent} style={styles.markAllBtn} testID="attendance-mark-all-present" />

          <FlatList
            data={roster}
            keyExtractor={(s) => s.studentId}
            contentContainerStyle={styles.list}
            testID="attendance-roster-list"
            renderItem={({ item }: { item: AttendanceRosterEntry }) => {
              const status = statuses.get(item.studentId) || 'unmarked';
              return (
                <View style={[styles.row, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
                  <View style={styles.rowText}>
                    <ThemedText style={styles.name}>{item.name}</ThemedText>
                    {item.rollNumber && <ThemedText variant="muted" style={styles.roll}>Roll {item.rollNumber}</ThemedText>}
                  </View>
                  <View style={styles.toggles}>
                    <ToggleButton
                      label="Present"
                      selected={status === 'present'}
                      tone="positive"
                      onPress={() => toggle(item.studentId, 'present')}
                      testID={`attendance-present-${item.studentId}`}
                      accessibilityLabel={`Mark ${item.name} present`}
                    />
                    <ToggleButton
                      label="Absent"
                      selected={status === 'absent'}
                      tone="negative"
                      onPress={() => toggle(item.studentId, 'absent')}
                      testID={`attendance-absent-${item.studentId}`}
                      accessibilityLabel={`Mark ${item.name} absent`}
                    />
                  </View>
                </View>
              );
            }}
          />

          <View style={[styles.saveBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
            {!!saveError && <ThemedText style={{ color: colors.semantic.danger.text }}>{saveError}</ThemedText>}
            <Button
              title={saving ? 'Saving…' : 'Save Attendance'}
              onPress={() => { void save(); }}
              disabled={saving || !dirty}
              loading={saving}
              testID="attendance-save-button"
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg, gap: spacing.sm },
  dateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  navBtn: {
    width: 36, height: 36, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center',
  },
  navBtnDisabled: { opacity: 0.4 },
  dateDisplay: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center' },
  dateText: { fontSize: 15, fontWeight: '600' },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  centerText: { marginTop: spacing.xs },
  emptyIconWell: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: spacing.sm, textAlign: 'center' },
  emptyHint: { textAlign: 'center', paddingHorizontal: spacing.xl },
  markAllBtn: { alignSelf: 'flex-start' },
  list: { gap: spacing.sm, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, padding: spacing.md, minHeight: 64,
  },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  roll: { fontSize: 12 },
  toggles: { flexDirection: 'row', gap: spacing.xs, width: 168 },
  saveBar: { paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, gap: spacing.xs },
});
