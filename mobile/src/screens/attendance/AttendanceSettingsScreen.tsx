// Native port of client/src/components/attendance/SettingsTab.tsx —
// school_admin only. The Principal's one-time/occasional configuration
// screen: Timing/Location/Patterns/Weekly-off collapsible sections, plus a
// holidays list (add/edit/delete).
import React, { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Platform, StyleSheet } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ChevronDown, ChevronUp, AlertTriangle, Pencil, Trash2, Check, X, Clock } from 'lucide-react-native';
import { ThemedText } from '../../components/ThemedText';
import { Card } from '../../components/Card';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { spacing, radius } from '../../theme/tokens';
import { ApiError } from '../../api/client';
import {
  getSchoolConfig, updateSchoolConfig, getHolidays, createHoliday, updateHoliday, deleteHoliday,
} from '../../api/teacherAttendanceApi';
import { requestCurrentPosition } from '../../lib/geolocation';
import { formatDateLabel } from '../../lib/classroomDate';
import type { SchoolAttendanceConfigInput, SchoolHolidayDto } from '../../types';

const DEFAULT_CONFIG: SchoolAttendanceConfigInput = {
  openTime: '09:00',
  closeTime: '16:00',
  checkinWindowStart: '08:30',
  checkinWindowEnd: '10:00',
  weeklyOffDays: '0',
  lateGraceMinutes: 10,
  halfDayThresholdPercent: 50,
  fullDayGraceMinutes: 15,
  geofenceLat: 0,
  geofenceLon: 0,
  geofenceRadiusMeters: 180,
  repeatPatternThreshold: 3,
  repeatPatternWindowDays: 30,
  reminderMinutesBeforeClose: 15,
  reminderMinutesAfterClose: 30,
};

const WEEKDAYS = [
  { value: 0, label: 'Sun' }, { value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' },
];

function parseWeeklyOffDays(value: string): Set<number> {
  return new Set(value.split(',').map((d) => d.trim()).filter((d) => d !== '').map(Number));
}

function toTimeDate(hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

function fromTimeDate(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.field}>
      <ThemedText variant="muted" style={styles.fieldLabel}>{label}</ThemedText>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.timeInput, { backgroundColor: colors.surface2, borderColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Clock size={14} color={colors.textMuted} />
        <ThemedText style={styles.timeValue}>{value}</ThemedText>
      </Pressable>
      {open && (
        <DateTimePicker
          value={toTimeDate(value)}
          mode="time"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_e, selected) => {
            if (Platform.OS === 'android') setOpen(false);
            if (selected) onChange(fromTimeDate(selected));
          }}
        />
      )}
    </View>
  );
}

function NumberField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <ThemedText variant="muted" style={styles.fieldLabel}>{label}</ThemedText>
      <TextInput
        style={[styles.numberInput, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.text }]}
        keyboardType="number-pad"
        value={String(value)}
        onChangeText={(text) => {
          const n = Number(text.replace(/[^0-9.-]/g, ''));
          if (!Number.isNaN(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
        }}
      />
    </View>
  );
}

function Section({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <Card style={styles.section}>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.sectionHeader} accessibilityRole="button">
        <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
        {open ? <ChevronUp size={16} color={colors.textMuted} /> : <ChevronDown size={16} color={colors.textMuted} />}
      </Pressable>
      {open && <View style={styles.sectionBody}>{children}</View>}
    </Card>
  );
}

export function AttendanceSettingsScreen() {
  const { colors } = useTheme();
  const [form, setForm] = useState<SchoolAttendanceConfigInput>(DEFAULT_CONFIG);
  const [hasExistingConfig, setHasExistingConfig] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');

  const [holidays, setHolidays] = useState<SchoolHolidayDto[]>([]);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayReason, setHolidayReason] = useState('');
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [holidayError, setHolidayError] = useState('');
  const [showHolidayDatePicker, setShowHolidayDatePicker] = useState(false);

  const [editingHolidayId, setEditingHolidayId] = useState<string | null>(null);
  const [editHolidayDate, setEditHolidayDate] = useState('');
  const [editHolidayReason, setEditHolidayReason] = useState('');
  const [savingHolidayEdit, setSavingHolidayEdit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [config, holidayList] = await Promise.all([getSchoolConfig(), getHolidays()]);
      if (config) {
        setForm({
          openTime: config.openTime, closeTime: config.closeTime,
          checkinWindowStart: config.checkinWindowStart, checkinWindowEnd: config.checkinWindowEnd,
          weeklyOffDays: config.weeklyOffDays, lateGraceMinutes: config.lateGraceMinutes,
          halfDayThresholdPercent: config.halfDayThresholdPercent, fullDayGraceMinutes: config.fullDayGraceMinutes,
          geofenceLat: config.geofenceLat, geofenceLon: config.geofenceLon, geofenceRadiusMeters: config.geofenceRadiusMeters,
          repeatPatternThreshold: config.repeatPatternThreshold, repeatPatternWindowDays: config.repeatPatternWindowDays,
          reminderMinutesBeforeClose: config.reminderMinutesBeforeClose, reminderMinutesAfterClose: config.reminderMinutesAfterClose,
        });
        setHasExistingConfig(true);
      }
      setHolidays(holidayList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load attendance settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function updateField<K extends keyof SchoolAttendanceConfigInput>(key: K, value: SchoolAttendanceConfigInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function toggleWeeklyOffDay(day: number) {
    const current = parseWeeklyOffDays(form.weeklyOffDays ?? '');
    if (current.has(day)) current.delete(day);
    else current.add(day);
    updateField('weeklyOffDays', Array.from(current).sort().join(','));
  }

  async function handleUseMyLocation() {
    setLocating(true);
    setError('');
    try {
      const position = await requestCurrentPosition();
      updateField('geofenceLat', position.coords.latitude);
      updateField('geofenceLon', position.coords.longitude);
    } catch {
      setError('Could not get your current location. You can still type coordinates in manually.');
    } finally {
      setLocating(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    setSaved(false);
    try {
      await updateSchoolConfig(form);
      setHasExistingConfig(true);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save attendance settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handleAddHoliday() {
    setAddingHoliday(true);
    setHolidayError('');
    try {
      const holiday = await createHoliday({ date: holidayDate, reason: holidayReason.trim() });
      setHolidays((list) => [...list, holiday].sort((a, b) => a.date.localeCompare(b.date)));
      setHolidayDate('');
      setHolidayReason('');
    } catch (err) {
      setHolidayError(err instanceof ApiError ? err.message : 'Could not add this holiday.');
    } finally {
      setAddingHoliday(false);
    }
  }

  function startEditHoliday(h: SchoolHolidayDto) {
    setEditingHolidayId(h.id);
    setEditHolidayDate(h.date);
    setEditHolidayReason(h.reason);
  }

  async function saveEditHoliday(id: string) {
    if (!editHolidayDate || !editHolidayReason.trim()) return;
    setSavingHolidayEdit(true);
    try {
      const updated = await updateHoliday(id, { date: editHolidayDate, reason: editHolidayReason.trim() });
      setHolidays((list) => list.map((h) => (h.id === id ? updated : h)).sort((a, b) => a.date.localeCompare(b.date)));
      setEditingHolidayId(null);
    } catch (err) {
      setHolidayError(err instanceof ApiError ? err.message : 'Could not save this holiday.');
    } finally {
      setSavingHolidayEdit(false);
    }
  }

  function confirmDeleteHoliday(h: SchoolHolidayDto) {
    Alert.alert(
      'Delete this holiday?',
      `"${h.reason}" on ${formatDateLabel(h.date)} will be removed. Teachers will be expected to check in on that day again unless it's re-added.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteHoliday(h.id);
              setHolidays((list) => list.filter((x) => x.id !== h.id));
            } catch (err) {
              setHolidayError(err instanceof ApiError ? err.message : 'Could not delete this holiday.');
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.orange} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.container}>
      {!hasExistingConfig && (
        <ThemedText variant="muted" style={styles.hint}>
          Attendance isn&apos;t set up for your school yet — fill this in and save to turn on check-in for your teachers.
        </ThemedText>
      )}

      {!!error && (
        <View style={[styles.banner, { backgroundColor: colors.semantic.danger.bg, borderColor: colors.semantic.danger.border }]}>
          <AlertTriangle size={16} color={colors.semantic.danger.text} />
          <ThemedText style={{ color: colors.semantic.danger.text, flex: 1 }}>{error}</ThemedText>
        </View>
      )}

      <Section title="Timing" defaultOpen>
        <TimeField label="School opens" value={form.openTime} onChange={(v) => updateField('openTime', v)} />
        <TimeField label="School closes" value={form.closeTime} onChange={(v) => updateField('closeTime', v)} />
        <TimeField label="Check-in window opens" value={form.checkinWindowStart} onChange={(v) => updateField('checkinWindowStart', v)} />
        <TimeField label="Check-in window closes" value={form.checkinWindowEnd} onChange={(v) => updateField('checkinWindowEnd', v)} />
      </Section>

      <Section title="Location">
        <NumberField label="Check-in distance from school (metres)" value={form.geofenceRadiusMeters ?? 180} min={20} max={5000} onChange={(v) => updateField('geofenceRadiusMeters', v)} />
        <ThemedText variant="muted" style={styles.fieldLabel}>School location</ThemedText>
        <View style={styles.locationRow}>
          <TextField label="Latitude" keyboardType="numeric" value={String(form.geofenceLat)} onChangeText={(t) => updateField('geofenceLat', Number(t) || 0)} />
          <TextField label="Longitude" keyboardType="numeric" value={String(form.geofenceLon)} onChangeText={(t) => updateField('geofenceLon', Number(t) || 0)} />
        </View>
        <Button title={locating ? 'Locating…' : 'Use my location'} variant="secondary" onPress={handleUseMyLocation} disabled={locating} />
      </Section>

      <Section title="Patterns &amp; thresholds">
        <ThemedText variant="muted" style={styles.hint}>Every field below keeps its current default until you change it.</ThemedText>
        <NumberField label="Late-arrival grace period (minutes)" value={form.lateGraceMinutes ?? 10} min={0} max={120} onChange={(v) => updateField('lateGraceMinutes', v)} />
        <NumberField label="Half-day cutoff (% of the required day)" value={form.halfDayThresholdPercent ?? 50} min={1} max={100} onChange={(v) => updateField('halfDayThresholdPercent', v)} />
        <NumberField label="Full-day grace period (minutes)" value={form.fullDayGraceMinutes ?? 15} min={0} max={120} onChange={(v) => updateField('fullDayGraceMinutes', v)} />
        <NumberField label="Flag a repeated pattern after this many occurrences" value={form.repeatPatternThreshold ?? 3} min={1} max={100} onChange={(v) => updateField('repeatPatternThreshold', v)} />
        <NumberField label="Repeat-pattern window (days)" value={form.repeatPatternWindowDays ?? 30} min={1} max={365} onChange={(v) => updateField('repeatPatternWindowDays', v)} />
        <NumberField label="Remind to check out, starting this many minutes before closing" value={form.reminderMinutesBeforeClose ?? 15} min={0} max={120} onChange={(v) => updateField('reminderMinutesBeforeClose', v)} />
        <NumberField label="Keep reminding until this many minutes after closing" value={form.reminderMinutesAfterClose ?? 30} min={0} max={120} onChange={(v) => updateField('reminderMinutesAfterClose', v)} />
      </Section>

      <Section title="Weekly off days">
        <View style={styles.weekdayRow}>
          {WEEKDAYS.map((day) => {
            const checked = parseWeeklyOffDays(form.weeklyOffDays ?? '').has(day.value);
            return (
              <Pressable
                key={day.value}
                onPress={() => toggleWeeklyOffDay(day.value)}
                style={[styles.weekdayChip, { backgroundColor: checked ? colors.orangeSoft : colors.surface2, borderColor: checked ? colors.orange : colors.border }]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
              >
                <ThemedText style={{ fontSize: 12, fontWeight: '600' }}>{day.label}</ThemedText>
              </Pressable>
            );
          })}
        </View>
      </Section>

      <Button title={saving ? 'Saving…' : 'Save settings'} onPress={handleSave} loading={saving} />
      {saved && !error && <ThemedText style={{ color: colors.semantic.success.text }}>Attendance settings saved.</ThemedText>}

      <ThemedText style={styles.subhead}>Holidays</ThemedText>
      {holidays.length === 0 ? (
        <ThemedText variant="muted" style={styles.hint}>No holidays added yet.</ThemedText>
      ) : (
        <View style={[styles.holidayList, { borderColor: colors.border }]}>
          {holidays.map((h) => {
            const isEditing = editingHolidayId === h.id;
            return (
              <View key={h.id} style={[styles.holidayRow, { borderColor: colors.border }]}>
                {isEditing ? (
                  <>
                    <Pressable onPress={() => setShowHolidayDatePicker(true)} style={styles.holidayEditDate}>
                      <ThemedText style={{ fontSize: 13 }}>{formatDateLabel(editHolidayDate)}</ThemedText>
                    </Pressable>
                    {showHolidayDatePicker && (
                      <DateTimePicker
                        value={new Date(editHolidayDate)}
                        mode="date"
                        display={Platform.OS === 'ios' ? 'inline' : 'default'}
                        onChange={(_e, selected) => {
                          if (Platform.OS === 'android') setShowHolidayDatePicker(false);
                          if (selected) {
                            const y = selected.getFullYear();
                            const m = String(selected.getMonth() + 1).padStart(2, '0');
                            const d = String(selected.getDate()).padStart(2, '0');
                            setEditHolidayDate(`${y}-${m}-${d}`);
                          }
                        }}
                      />
                    )}
                    <TextInput
                      style={[styles.holidayReasonInput, { backgroundColor: colors.surface2, borderColor: colors.border, color: colors.text }]}
                      value={editHolidayReason}
                      onChangeText={setEditHolidayReason}
                    />
                    <Pressable onPress={() => saveEditHoliday(h.id)} disabled={savingHolidayEdit || !editHolidayDate || !editHolidayReason.trim()} accessibilityRole="button" accessibilityLabel="Save" hitSlop={8}>
                      <Check size={18} color={colors.semantic.success.text} />
                    </Pressable>
                    <Pressable onPress={() => setEditingHolidayId(null)} disabled={savingHolidayEdit} accessibilityRole="button" accessibilityLabel="Cancel" hitSlop={8}>
                      <X size={18} color={colors.textMuted} />
                    </Pressable>
                  </>
                ) : (
                  <>
                    <View style={{ flex: 1 }}>
                      <ThemedText style={{ fontSize: 13, fontWeight: '600' }}>{formatDateLabel(h.date)}</ThemedText>
                      <ThemedText variant="muted" style={{ fontSize: 12 }}>{h.reason}</ThemedText>
                    </View>
                    <Pressable onPress={() => startEditHoliday(h)} accessibilityRole="button" accessibilityLabel={`Edit ${h.reason}`} hitSlop={8} style={styles.holidayActionBtn}>
                      <Pencil size={14} color={colors.text} />
                    </Pressable>
                    <Pressable onPress={() => confirmDeleteHoliday(h)} accessibilityRole="button" accessibilityLabel={`Delete ${h.reason}`} hitSlop={8} style={styles.holidayActionBtn}>
                      <Trash2 size={14} color={colors.semantic.danger.action} />
                    </Pressable>
                  </>
                )}
              </View>
            );
          })}
        </View>
      )}

      {!!holidayError && <ThemedText style={{ color: colors.semantic.danger.text }}>{holidayError}</ThemedText>}

      <View style={styles.addHolidayForm}>
        <Pressable onPress={() => setShowHolidayDatePicker(true)} style={[styles.holidayDateTrigger, { backgroundColor: colors.surface2, borderColor: colors.border }]}>
          <ThemedText style={{ fontSize: 13, color: holidayDate ? colors.text : colors.textMuted }}>
            {holidayDate ? formatDateLabel(holidayDate) : 'Pick a date'}
          </ThemedText>
        </Pressable>
        {showHolidayDatePicker && !editingHolidayId && (
          <DateTimePicker
            value={holidayDate ? new Date(holidayDate) : new Date()}
            mode="date"
            display={Platform.OS === 'ios' ? 'inline' : 'default'}
            onChange={(_e, selected) => {
              if (Platform.OS === 'android') setShowHolidayDatePicker(false);
              if (selected) {
                const y = selected.getFullYear();
                const m = String(selected.getMonth() + 1).padStart(2, '0');
                const d = String(selected.getDate()).padStart(2, '0');
                setHolidayDate(`${y}-${m}-${d}`);
              }
            }}
          />
        )}
        <TextField label="Reason" placeholder="e.g. Gandhi Jayanti" value={holidayReason} onChangeText={setHolidayReason} />
        <Button title={addingHoliday ? 'Adding…' : 'Add holiday'} onPress={handleAddHoliday} disabled={!holidayDate || !holidayReason.trim() || addingHoliday} loading={addingHoliday} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md },
  center: { alignItems: 'center', paddingVertical: spacing.xl },
  hint: { fontSize: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.sm, borderWidth: StyleSheet.hairlineWidth },
  section: { gap: 0, padding: 0, overflow: 'hidden' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  sectionTitle: { fontSize: 14, fontWeight: '700' },
  sectionBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.md },
  field: { gap: spacing.xs },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  timeInput: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: spacing.md, minHeight: 44 },
  timeValue: { fontSize: 15 },
  numberInput: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: spacing.md, minHeight: 44, fontSize: 15 },
  locationRow: { flexDirection: 'row', gap: spacing.sm },
  weekdayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  weekdayChip: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 999, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  subhead: { fontSize: 16, fontWeight: '700', marginTop: spacing.sm },
  holidayList: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, overflow: 'hidden' },
  holidayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  holidayEditDate: { minWidth: 90 },
  holidayReasonInput: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: spacing.sm, minHeight: 36, fontSize: 13 },
  holidayActionBtn: { padding: spacing.xs },
  addHolidayForm: { gap: spacing.sm },
  holidayDateTrigger: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.sm, paddingHorizontal: spacing.md, minHeight: 44, justifyContent: 'center' },
});
