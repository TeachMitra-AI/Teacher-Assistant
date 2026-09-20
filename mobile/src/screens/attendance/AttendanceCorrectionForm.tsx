// Native port of client/src/components/attendance/AttendanceCorrectionForm.tsx
// — the correction action form for one day, reachable on-demand from
// ReportsScreen's drill-down. There is no review queue any more, so this is
// never part of a "must process" list — a Principal opens it only when
// they've chosen to look at a specific day.
import React, { useState } from 'react';
import { View, Pressable, Platform, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Calendar, Clock } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { TextField } from '../../components/TextField';
import { SelectField } from '../../components/SelectField';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { ApiError } from '../../api/client';
import { reviewAttendance } from '../../api/teacherAttendanceApi';
import { TEACHER_ATTENDANCE_STATUS_LABEL, formatAttendanceTime, formatDistance } from '../../lib/teacherAttendanceLabels';
import type { TeacherAttendanceDetailDto, TeacherAttendanceReviewAction } from '../../types';

const ACTION_OPTIONS: { value: TeacherAttendanceReviewAction; label: string }[] = [
  { value: 'approve', label: 'Approve' },
  { value: 'reject', label: 'Reject' },
  { value: 'mark_on_leave', label: 'Mark as leave' },
  { value: 'mark_on_duty', label: 'Mark as on duty' },
  { value: 'correct_checkin', label: 'Correct check-in time' },
  { value: 'correct_checkout', label: 'Correct check-out time' },
];

function metersLabel(m: number | null): string {
  return m === null ? '—' : `${formatDistance(m)} from school`;
}

export function AttendanceCorrectionForm({
  entry,
  onResolved,
  onCancel,
}: {
  entry: TeacherAttendanceDetailDto;
  onResolved: (id: string) => void;
  onCancel: () => void;
}) {
  const { colors } = useTheme();
  // "Approve" on a missing-checkout day would mark it Present while leaving
  // the checkout time and working hours blank forever — excluded here, not
  // globally.
  const isMissingCheckout = entry.status === 'pending_regularization';
  const actionOptions = isMissingCheckout ? ACTION_OPTIONS.filter((opt) => opt.value !== 'approve') : ACTION_OPTIONS;

  const [action, setAction] = useState<TeacherAttendanceReviewAction>(isMissingCheckout ? 'correct_checkout' : 'approve');
  const [reason, setReason] = useState('');
  const [leaveOrDutyCategory, setLeaveOrDutyCategory] = useState('');
  const [correctedTime, setCorrectedTime] = useState<Date>(() => {
    const base = action === 'correct_checkout' ? entry.checkOutAt : entry.checkInAt;
    return base ? new Date(base) : new Date();
  });
  const [pickerMode, setPickerMode] = useState<'date' | 'time' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const needsCategory = action === 'mark_on_leave' || action === 'mark_on_duty';
  const needsTime = action === 'correct_checkin' || action === 'correct_checkout';
  const canSubmit =
    reason.trim().length > 0 && (!needsCategory || leaveOrDutyCategory.trim().length > 0) && (!needsTime || Boolean(correctedTime));

  function handlePickerChange(_event: unknown, selected?: Date) {
    if (Platform.OS === 'android') setPickerMode(null);
    if (!selected) return;
    setCorrectedTime((prev) => {
      const next = new Date(prev);
      if (pickerMode === 'date') {
        next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
      } else {
        next.setHours(selected.getHours(), selected.getMinutes());
      }
      return next;
    });
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    try {
      const correctedIso = needsTime ? correctedTime.toISOString() : undefined;
      await reviewAttendance(entry.id, {
        action,
        reason: reason.trim(),
        leaveOrDutyCategory: needsCategory ? leaveOrDutyCategory.trim() : undefined,
        correctedCheckInAt: action === 'correct_checkin' ? correctedIso : undefined,
        correctedCheckOutAt: action === 'correct_checkout' ? correctedIso : undefined,
      });
      onResolved(entry.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit this correction.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
      <View style={styles.header}>
        <ThemedText variant="muted">{TEACHER_ATTENDANCE_STATUS_LABEL[entry.status]}</ThemedText>
        <Button title="Cancel" variant="text" onPress={onCancel} />
      </View>

      <View style={styles.evidence}>
        <ThemedText variant="muted" style={styles.evidenceLabel}>Check-in</ThemedText>
        <ThemedText style={styles.evidenceValue}>
          {entry.checkInAt ? `${formatAttendanceTime(entry.checkInAt)} · ${metersLabel(entry.checkInDistanceMeters)}` : '— not checked in'}
        </ThemedText>
        <ThemedText variant="muted" style={styles.evidenceLabel}>Check-out</ThemedText>
        <ThemedText style={styles.evidenceValue}>
          {entry.checkOutAt ? `${formatAttendanceTime(entry.checkOutAt)} · ${metersLabel(entry.checkOutDistanceMeters)}` : '— not yet'}
        </ThemedText>
      </View>

      {!!error && <ThemedText style={{ color: colors.semantic.danger.text }}>{error}</ThemedText>}

      <SelectField
        label="Action"
        options={actionOptions}
        value={action}
        onChange={(v) => setAction(v as TeacherAttendanceReviewAction)}
      />

      {needsCategory && (
        <TextField
          label="Leave / duty category"
          placeholder="e.g. Casual Leave, On Duty"
          value={leaveOrDutyCategory}
          onChangeText={setLeaveOrDutyCategory}
        />
      )}

      {needsTime && (
        <View style={styles.field}>
          <ThemedText variant="muted" style={styles.fieldLabel}>
            {action === 'correct_checkin' ? 'Correct check-in time' : 'Correct check-out time'}
          </ThemedText>
          <View style={styles.timeRow}>
            <Pressable
              onPress={() => setPickerMode('date')}
              style={[styles.timeChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
              accessibilityRole="button"
            >
              <Calendar size={14} color={colors.text} />
              <ThemedText style={styles.timeChipText}>{correctedTime.toLocaleDateString()}</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => setPickerMode('time')}
              style={[styles.timeChip, { backgroundColor: colors.surface, borderColor: colors.border }]}
              accessibilityRole="button"
            >
              <Clock size={14} color={colors.text} />
              <ThemedText style={styles.timeChipText}>{correctedTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</ThemedText>
            </Pressable>
          </View>
          {pickerMode && (
            <DateTimePicker
              value={correctedTime}
              mode={pickerMode}
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={handlePickerChange}
            />
          )}
        </View>
      )}

      <TextField
        label="Reason (required)"
        placeholder="Why this decision — this is kept as a permanent record."
        value={reason}
        onChangeText={setReason}
        multiline
        numberOfLines={2}
        maxLength={1000}
      />

      <Button title={submitting ? 'Submitting…' : 'Submit'} onPress={handleSubmit} disabled={!canSubmit || submitting} loading={submitting} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: spacing.md, gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  evidence: { gap: 2 },
  evidenceLabel: { fontSize: 11, marginTop: spacing.xs },
  evidenceValue: { fontSize: 13 },
  field: { gap: spacing.xs },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  timeRow: { flexDirection: 'row', gap: spacing.sm },
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  timeChipText: { fontSize: 13 },
});
