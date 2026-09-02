import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, LocateFixed, Pencil, Trash2, Check, X } from 'lucide-react';
import { ApiError } from '../../api';
import {
  getSchoolConfig,
  updateSchoolConfig,
  getHolidays,
  createHoliday,
  updateHoliday,
  deleteHoliday,
} from '../../lib/teacherAttendanceApi';
import { requestCurrentPosition } from '../../lib/geolocation';
import { formatDateLabel } from '../../lib/classroomDate';
import { useToast } from '../Toast';
import ConfirmDialog from '../ConfirmDialog';
import type { SchoolAttendanceConfigDto, SchoolAttendanceConfigInput, SchoolHolidayDto } from '../../types';

// Same defaults as SchoolAttendanceConfig's Prisma @default values —
// pre-filled so a Principal setting this up for the first time sees the
// project's own recommended starting numbers (attendance-plan-review.md §8),
// not a blank form.
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

// 0=Sunday..6=Saturday, matching lib/teacherAttendance.js's isWeeklyOff()
// convention exactly.
const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

// GET /school-config returns the full row — id/schoolId/createdAt/updatedAt
// included, since the server does no DTO stripping there. PUT's Zod schema
// is `.strict()` and has no fields for those, so the form must never carry
// them forward: assigning the raw DTO straight into form state (as an
// earlier version of this file did) round-trips those extra keys back to
// PUT on Save and gets "Unrecognized keys" rejected by the server.
function toFormInput(config: SchoolAttendanceConfigDto): SchoolAttendanceConfigInput {
  return {
    openTime: config.openTime,
    closeTime: config.closeTime,
    checkinWindowStart: config.checkinWindowStart,
    checkinWindowEnd: config.checkinWindowEnd,
    weeklyOffDays: config.weeklyOffDays,
    lateGraceMinutes: config.lateGraceMinutes,
    halfDayThresholdPercent: config.halfDayThresholdPercent,
    fullDayGraceMinutes: config.fullDayGraceMinutes,
    geofenceLat: config.geofenceLat,
    geofenceLon: config.geofenceLon,
    geofenceRadiusMeters: config.geofenceRadiusMeters,
    repeatPatternThreshold: config.repeatPatternThreshold,
    repeatPatternWindowDays: config.repeatPatternWindowDays,
    reminderMinutesBeforeClose: config.reminderMinutesBeforeClose,
    reminderMinutesAfterClose: config.reminderMinutesAfterClose,
  };
}

function parseWeeklyOffDays(value: string): Set<number> {
  return new Set(
    value
      .split(',')
      .map((d) => d.trim())
      .filter((d) => d !== '')
      .map(Number)
  );
}

export default function SettingsTab() {
  const { show } = useToast();
  const [form, setForm] = useState<SchoolAttendanceConfigInput>(DEFAULT_CONFIG);
  const [hasExistingConfig, setHasExistingConfig] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');

  const [holidays, setHolidays] = useState<SchoolHolidayDto[]>([]);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayReason, setHolidayReason] = useState('');
  const [addingHoliday, setAddingHoliday] = useState(false);
  const [holidayError, setHolidayError] = useState('');

  const [editingHolidayId, setEditingHolidayId] = useState<string | null>(null);
  const [editHolidayDate, setEditHolidayDate] = useState('');
  const [editHolidayReason, setEditHolidayReason] = useState('');
  const [savingHolidayEdit, setSavingHolidayEdit] = useState(false);
  const [editHolidayError, setEditHolidayError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<SchoolHolidayDto | null>(null);
  const [deletingHoliday, setDeletingHoliday] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [config, holidayList] = await Promise.all([getSchoolConfig(), getHolidays()]);
      if (config) {
        setForm(toFormInput(config));
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
      const position = await requestCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
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
    try {
      const saved = await updateSchoolConfig(form);
      setForm(toFormInput(saved));
      setHasExistingConfig(true);
      show('Attendance settings saved.', 'success');
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
    setEditHolidayError('');
  }

  function cancelEditHoliday() {
    setEditingHolidayId(null);
    setEditHolidayError('');
  }

  async function saveEditHoliday(id: string) {
    if (!editHolidayDate || !editHolidayReason.trim()) return;
    setSavingHolidayEdit(true);
    setEditHolidayError('');
    try {
      const updated = await updateHoliday(id, { date: editHolidayDate, reason: editHolidayReason.trim() });
      setHolidays((list) => list.map((h) => (h.id === id ? updated : h)).sort((a, b) => a.date.localeCompare(b.date)));
      setEditingHolidayId(null);
    } catch (err) {
      setEditHolidayError(err instanceof ApiError ? err.message : 'Could not save this holiday.');
    } finally {
      setSavingHolidayEdit(false);
    }
  }

  async function confirmDeleteHoliday() {
    if (!deleteTarget) return;
    setDeletingHoliday(true);
    try {
      await deleteHoliday(deleteTarget.id);
      setHolidays((list) => list.filter((h) => h.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setHolidayError(err instanceof ApiError ? err.message : 'Could not delete this holiday.');
      setDeleteTarget(null);
    } finally {
      setDeletingHoliday(false);
    }
  }

  if (loading) {
    return (
      <div className="run-skeleton" aria-label="Loading">
        <div className="sk-line" />
        <div className="sk-line" />
        <div className="sk-line" />
      </div>
    );
  }

  return (
    <div>
      {!hasExistingConfig && (
        <p className="attendance-hint">
          Attendance isn't set up for your school yet — fill this in and save to turn on check-in for your teachers.
        </p>
      )}

      {error && (
        <div className="attendance-error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <details className="attendance-settings-group" open>
        <summary>Timing</summary>
        <div className="attendance-settings-group-body">
          <div className="attendance-settings-grid">
            <div>
              <label className="field-label" htmlFor="openTime">School opens</label>
              <input id="openTime" className="text-input" type="time" value={form.openTime} onChange={(e) => updateField('openTime', e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="closeTime">School closes</label>
              <input id="closeTime" className="text-input" type="time" value={form.closeTime} onChange={(e) => updateField('closeTime', e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="checkinWindowStart">Check-in window opens</label>
              <input id="checkinWindowStart" className="text-input" type="time" value={form.checkinWindowStart} onChange={(e) => updateField('checkinWindowStart', e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="checkinWindowEnd">Check-in window closes</label>
              <input id="checkinWindowEnd" className="text-input" type="time" value={form.checkinWindowEnd} onChange={(e) => updateField('checkinWindowEnd', e.target.value)} />
            </div>
          </div>
        </div>
      </details>

      <details className="attendance-settings-group">
        <summary>Location</summary>
        <div className="attendance-settings-group-body">
          <div className="attendance-settings-grid">
            <div>
              <label className="field-label" htmlFor="geofenceRadiusMeters">Check-in distance from school (metres)</label>
              <input id="geofenceRadiusMeters" className="text-input" type="number" min={20} max={5000} value={form.geofenceRadiusMeters} onChange={(e) => updateField('geofenceRadiusMeters', Number(e.target.value))} />
            </div>
          </div>
          <label className="field-label">School location</label>
          <div className="attendance-location-row">
            <input className="text-input" type="number" step="any" aria-label="Latitude" placeholder="Latitude" value={form.geofenceLat} onChange={(e) => updateField('geofenceLat', Number(e.target.value))} />
            <input className="text-input" type="number" step="any" aria-label="Longitude" placeholder="Longitude" value={form.geofenceLon} onChange={(e) => updateField('geofenceLon', Number(e.target.value))} />
            <button type="button" className="btn-text attendance-locate-btn" onClick={handleUseMyLocation} disabled={locating}>
              <LocateFixed size={15} aria-hidden="true" />
              {locating ? 'Locating…' : 'Use my location'}
            </button>
          </div>
        </div>
      </details>

      <details className="attendance-settings-group">
        <summary>Patterns &amp; thresholds</summary>
        <div className="attendance-settings-group-body">
          <p className="attendance-hint">
            Every field below is optional — each one keeps its current default (shown here) until you change it.
          </p>
          <div className="attendance-settings-grid">
            <div>
              <label className="field-label" htmlFor="lateGraceMinutes">Late-arrival grace period (minutes)</label>
              <input id="lateGraceMinutes" className="text-input" type="number" min={0} max={120} value={form.lateGraceMinutes} onChange={(e) => updateField('lateGraceMinutes', Number(e.target.value))} />
            </div>
            <div>
              <label className="field-label" htmlFor="halfDayThresholdPercent">Half-day cutoff (% of the required day)</label>
              <input id="halfDayThresholdPercent" className="text-input" type="number" min={1} max={100} value={form.halfDayThresholdPercent} onChange={(e) => updateField('halfDayThresholdPercent', Number(e.target.value))} />
            </div>
            <div>
              <label className="field-label" htmlFor="fullDayGraceMinutes">Full-day grace period (minutes)</label>
              <input id="fullDayGraceMinutes" className="text-input" type="number" min={0} max={120} value={form.fullDayGraceMinutes} onChange={(e) => updateField('fullDayGraceMinutes', Number(e.target.value))} />
            </div>
            <div>
              <label className="field-label" htmlFor="repeatPatternThreshold">Flag a repeated pattern after this many occurrences</label>
              <input id="repeatPatternThreshold" className="text-input" type="number" min={1} max={100} value={form.repeatPatternThreshold} onChange={(e) => updateField('repeatPatternThreshold', Number(e.target.value))} />
            </div>
            <div>
              <label className="field-label" htmlFor="repeatPatternWindowDays">Repeat-pattern window (days)</label>
              <input id="repeatPatternWindowDays" className="text-input" type="number" min={1} max={365} value={form.repeatPatternWindowDays} onChange={(e) => updateField('repeatPatternWindowDays', Number(e.target.value))} />
            </div>
            <div>
              <label className="field-label" htmlFor="reminderMinutesBeforeClose">Remind to check out, starting this many minutes before closing</label>
              <input id="reminderMinutesBeforeClose" className="text-input" type="number" min={0} max={120} value={form.reminderMinutesBeforeClose} onChange={(e) => updateField('reminderMinutesBeforeClose', Number(e.target.value))} />
            </div>
            <div>
              <label className="field-label" htmlFor="reminderMinutesAfterClose">Keep reminding until this many minutes after closing</label>
              <input id="reminderMinutesAfterClose" className="text-input" type="number" min={0} max={120} value={form.reminderMinutesAfterClose} onChange={(e) => updateField('reminderMinutesAfterClose', Number(e.target.value))} />
            </div>
          </div>
        </div>
      </details>

      <details className="attendance-settings-group">
        <summary>Weekly off days</summary>
        <div className="attendance-settings-group-body">
          <div className="attendance-weekday-picker" role="group" aria-label="Weekly off days">
            {WEEKDAYS.map((day) => {
              const checked = parseWeeklyOffDays(form.weeklyOffDays ?? '').has(day.value);
              return (
                <label key={day.value} className={`attendance-weekday-chip${checked ? ' checked' : ''}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleWeeklyOffDay(day.value)} />
                  {day.label}
                </label>
              );
            })}
          </div>
        </div>
      </details>

      <button type="button" className="btn-primary attendance-action" onClick={handleSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save settings'}
      </button>

      <h3 className="attendance-subhead">Holidays</h3>
      {holidays.length === 0 ? (
        <p className="attendance-hint">No holidays added yet.</p>
      ) : (
        <ul className="attendance-history-list">
          {holidays.map((h) => {
            const isEditing = editingHolidayId === h.id;
            return (
              <li key={h.id} className="attendance-history-row">
                {isEditing ? (
                  <div className="attendance-holiday-edit">
                    <input
                      className="text-input"
                      type="date"
                      aria-label="Edit holiday date"
                      value={editHolidayDate}
                      onChange={(e) => setEditHolidayDate(e.target.value)}
                    />
                    <input
                      className="text-input"
                      type="text"
                      aria-label="Edit holiday reason"
                      value={editHolidayReason}
                      onChange={(e) => setEditHolidayReason(e.target.value)}
                    />
                    <button
                      type="button"
                      className="icon-btn"
                      title="Save"
                      aria-label="Save"
                      disabled={savingHolidayEdit || !editHolidayDate || !editHolidayReason.trim()}
                      onClick={() => saveEditHoliday(h.id)}
                    >
                      <Check size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Cancel"
                      aria-label="Cancel"
                      disabled={savingHolidayEdit}
                      onClick={cancelEditHoliday}
                    >
                      <X size={15} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="attendance-history-date">{formatDateLabel(h.date)}</span>
                    <span className="attendance-history-status">{h.reason}</span>
                    <div className="attendance-holiday-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        title="Edit"
                        aria-label={`Edit ${h.reason}`}
                        onClick={() => startEditHoliday(h)}
                      >
                        <Pencil size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Delete"
                        aria-label={`Delete ${h.reason}`}
                        onClick={() => setDeleteTarget(h)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {editHolidayError && (
        <div className="attendance-error" role="alert">
          <span>{editHolidayError}</span>
        </div>
      )}

      {holidayError && (
        <div className="attendance-error" role="alert">
          <span>{holidayError}</span>
        </div>
      )}

      <div className="attendance-holiday-form">
        <input className="text-input" type="date" aria-label="Holiday date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
        <input
          className="text-input"
          type="text"
          placeholder="Reason (e.g. Gandhi Jayanti)"
          value={holidayReason}
          onChange={(e) => setHolidayReason(e.target.value)}
        />
        <button
          type="button"
          className="btn-primary"
          disabled={!holidayDate || !holidayReason.trim() || addingHoliday}
          onClick={handleAddHoliday}
        >
          {addingHoliday ? 'Adding…' : 'Add holiday'}
        </button>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this holiday?"
        body={`"${deleteTarget?.reason}" on ${deleteTarget ? formatDateLabel(deleteTarget.date) : ''} will be removed. Teachers will be expected to check in on that day again unless it's re-added.`}
        confirmLabel="Delete"
        tone="danger"
        busy={deletingHoliday}
        onConfirm={confirmDeleteHoliday}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
