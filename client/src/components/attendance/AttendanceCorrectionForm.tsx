import { useState } from 'react';
import { ApiError } from '../../api';
import { reviewAttendance } from '../../lib/teacherAttendanceApi';
import { TEACHER_ATTENDANCE_STATUS_LABEL, formatAttendanceTime, formatDistance } from '../../lib/teacherAttendanceLabels';
import type { TeacherAttendanceDetailDto, TeacherAttendanceReviewAction } from '../../types';

// Correction action form for one day — reachable on-demand from
// ReportsTab's drill-down (docs/feature-teacher-attendance-implementation-plan.md
// §1.7/§4). There is no review queue any more, so this is never rendered as
// part of a "must process" list — a Principal opens it only when they've
// chosen to look at a specific day. Formerly ReviewQueueCard; renamed and
// stripped of queue-only concerns (repeatPatternWarning) when the queue
// was retired — the pattern itself still shows as a coloured count in
// ReportsTab's summary table.
const ACTION_OPTIONS: { value: TeacherAttendanceReviewAction; label: string }[] = [
  { value: 'approve', label: 'Approve' },
  { value: 'reject', label: 'Reject' },
  { value: 'mark_on_leave', label: 'Mark as leave' },
  { value: 'mark_on_duty', label: 'Mark as on duty' },
  { value: 'correct_checkin', label: 'Correct check-in time' },
  { value: 'correct_checkout', label: 'Correct check-out time' },
];

// Distance is shown as plain evidence, never as a guessed reason — the app
// reports facts, the Principal decides what they mean
// (attendance-plan-review.md §2).
function metersLabel(m: number | null): string {
  return m === null ? '—' : `${formatDistance(m)} from school`;
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function AttendanceCorrectionForm({
  entry,
  onResolved,
  onCancel,
}: {
  entry: TeacherAttendanceDetailDto;
  onResolved: (id: string) => void;
  onCancel: () => void;
}) {
  // "Approve" on a missing-checkout day would mark it Present while leaving
  // the checkout time and working hours blank forever — there's no way to
  // recover that data later, unlike every other case where Approve
  // genuinely just means "this is fine." Excluded here, not globally.
  const isMissingCheckout = entry.status === 'pending_regularization';
  const actionOptions = isMissingCheckout ? ACTION_OPTIONS.filter((opt) => opt.value !== 'approve') : ACTION_OPTIONS;

  const [action, setAction] = useState<TeacherAttendanceReviewAction>(isMissingCheckout ? 'correct_checkout' : 'approve');
  const [reason, setReason] = useState('');
  const [leaveOrDutyCategory, setLeaveOrDutyCategory] = useState('');
  const [correctedTime, setCorrectedTime] = useState(() =>
    toDatetimeLocal(action === 'correct_checkout' ? entry.checkOutAt : entry.checkInAt)
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const needsCategory = action === 'mark_on_leave' || action === 'mark_on_duty';
  const needsTime = action === 'correct_checkin' || action === 'correct_checkout';
  const canSubmit =
    reason.trim().length > 0 && (!needsCategory || leaveOrDutyCategory.trim().length > 0) && (!needsTime || correctedTime);

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    try {
      const correctedIso = needsTime ? new Date(correctedTime).toISOString() : undefined;
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
    <div className="attendance-review-card">
      <div className="attendance-review-header">
        <span className="attendance-summary-muted">{TEACHER_ATTENDANCE_STATUS_LABEL[entry.status]}</span>
        <button type="button" className="btn-text" onClick={onCancel}>Cancel</button>
      </div>

      <dl className="attendance-review-evidence">
        <div>
          <dt>Check-in</dt>
          <dd>
            {entry.checkInAt ? formatAttendanceTime(entry.checkInAt) : '— not checked in'}
            {entry.checkInAt && ` · ${metersLabel(entry.checkInDistanceMeters)}`}
          </dd>
        </div>
        <div>
          <dt>Check-out</dt>
          <dd>
            {entry.checkOutAt ? formatAttendanceTime(entry.checkOutAt) : '— not yet'}
            {entry.checkOutAt && ` · ${metersLabel(entry.checkOutDistanceMeters)}`}
          </dd>
        </div>
      </dl>

      {error && (
        <div className="attendance-error" role="alert">
          <span>{error}</span>
        </div>
      )}

      <label className="field-label" htmlFor={`action-${entry.id}`}>Action</label>
      <select
        id={`action-${entry.id}`}
        className="text-input"
        value={action}
        onChange={(e) => setAction(e.target.value as TeacherAttendanceReviewAction)}
      >
        {actionOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {needsCategory && (
        <>
          <label className="field-label" htmlFor={`category-${entry.id}`}>Leave / duty category</label>
          <input
            id={`category-${entry.id}`}
            className="text-input"
            type="text"
            placeholder="e.g. Casual Leave, On Duty"
            value={leaveOrDutyCategory}
            onChange={(e) => setLeaveOrDutyCategory(e.target.value)}
          />
        </>
      )}

      {needsTime && (
        <>
          <label className="field-label" htmlFor={`time-${entry.id}`}>
            {action === 'correct_checkin' ? 'Correct check-in time' : 'Correct check-out time'}
          </label>
          <input
            id={`time-${entry.id}`}
            className="text-input"
            type="datetime-local"
            value={correctedTime}
            onChange={(e) => setCorrectedTime(e.target.value)}
          />
        </>
      )}

      <label className="field-label" htmlFor={`reason-${entry.id}`}>Reason (required)</label>
      <textarea
        id={`reason-${entry.id}`}
        className="text-input"
        rows={2}
        maxLength={1000}
        placeholder="Why this decision — this is kept as a permanent record."
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />

      <button
        type="button"
        className="btn-primary attendance-action"
        disabled={!canSubmit || submitting}
        onClick={handleSubmit}
      >
        {submitting ? 'Submitting…' : 'Submit'}
      </button>
    </div>
  );
}
