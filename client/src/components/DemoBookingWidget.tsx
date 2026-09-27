import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CircleAlert, ExternalLink } from 'lucide-react';
import { ApiError } from '../api';
import { DemoBookingCalendar } from './DemoBookingCalendar';
import {
  createDemoBooking,
  formatSlotLabel,
  getDemoBookingConfig,
  type DemoBooking,
  type DemoBookingConfig,
  type DemoBookingRole,
} from '../lib/scheduleDemo';

// The Schedule a Call booking widget: date -> time -> details -> confirm ->
// success, all in one panel (no page navigation between steps) — see
// docs/schedule-a-call-plan.md §2/§7. Date/time selection itself lives in
// DemoBookingCalendar, shared with ManageBookingPage's reschedule flow.
type Step = 'picking' | 'details' | 'confirm' | 'success';

const ROLE_OPTIONS: { value: DemoBookingRole; label: string }[] = [
  { value: 'school_admin', label: 'School Admin / Principal' },
  { value: 'org_leadership', label: 'Organization / Trust Leadership' },
  { value: 'other', label: 'Other' },
];

// "YYYY-MM-DD" -> "Mon, 30 Sep" for the confirm step's summary — a UTC-noon
// anchor so the parsed date never shifts to the previous/next day under a
// visitor's local timezone offset.
function formatDateLabel(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export function DemoBookingWidget() {
  const [config, setConfig] = useState<DemoBookingConfig | null>(null);
  const [configError, setConfigError] = useState('');

  const [step, setStep] = useState<Step>('picking');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [role, setRole] = useState<DemoBookingRole>('school_admin');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState<{ name?: boolean; email?: boolean; organization?: boolean }>({});
  function touch(field: keyof typeof touched) {
    setTouched((t) => (t[field] ? t : { ...t, [field]: true }));
  }

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ booking: DemoBooking; manageUrl: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDemoBookingConfig()
      .then((c) => {
        if (!cancelled) setConfig(c);
      })
      .catch(() => {
        if (!cancelled) setConfigError('Scheduling is not available right now. Please try again later.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function selectDate(dateKey: string) {
    setSelectedDate(dateKey);
    setSelectedTime(null);
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const nameError = touched.name && name.trim().length === 0 ? 'Enter your name.' : '';
  const emailError = touched.email && !emailRe.test(email.trim()) ? 'Enter a valid email address.' : '';
  const organizationError = touched.organization && organization.trim().length === 0 ? 'Enter your school or organization.' : '';

  function goToDetails() {
    if (!selectedDate || !selectedTime) return;
    setStep('details');
  }

  function handleDetailsSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched({ name: true, email: true, organization: true });
    if (name.trim().length === 0 || !emailRe.test(email.trim()) || organization.trim().length === 0) return;
    setStep('confirm');
  }

  async function confirmBooking() {
    if (!selectedDate || !selectedTime) return;
    setBusy(true);
    setError('');
    try {
      const res = await createDemoBooking({
        name: name.trim(),
        email: email.trim(),
        organization: organization.trim(),
        role,
        phone: phone.trim() || undefined,
        notes: notes.trim() || undefined,
        date: selectedDate,
        startTime: selectedTime,
      });
      setResult(res);
      setStep('success');
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // Someone else took the slot between selection and confirmation —
        // send the visitor back to pick a fresh one rather than retrying
        // blind.
        setError(err.message);
        setStep('picking');
        setSelectedTime(null);
      } else {
        setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (configError) {
    return (
      <div className="demo-widget demo-widget-error">
        <CircleAlert size={20} aria-hidden="true" />
        <p>{configError}</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="demo-widget demo-widget-loading" aria-busy="true">
        <span className="btn-spinner" aria-hidden="true" /> Loading availability…
      </div>
    );
  }

  if (step === 'success' && result) {
    return (
      <div className="demo-widget demo-success">
        <span className="demo-success-badge" aria-hidden="true">✓</span>
        <h3>You&rsquo;re booked!</h3>
        <p className="demo-success-when">
          {result.booking.dateLabel}
          <br />
          {result.booking.timeLabel} · {result.booking.durationMinutes} minutes
        </p>
        <p className="demo-success-note">
          We&rsquo;ve sent a confirmation to <strong>{email.trim()}</strong> with a calendar invite and a link to
          reschedule or cancel if you need to.
        </p>
        <a className="btn-outline demo-success-link" href={result.manageUrl}>
          Manage this booking <ExternalLink size={14} aria-hidden="true" />
        </a>
      </div>
    );
  }

  if (step === 'confirm') {
    return (
      <div className="demo-widget">
        <h3 className="demo-widget-title">Review &amp; confirm</h3>
        <dl className="demo-confirm-summary">
          <div>
            <dt>When</dt>
            <dd>
              {selectedDate && formatDateLabel(selectedDate)}
              {selectedTime ? ` · ${formatSlotLabel(selectedTime)}` : ''} ({config.slotMinutes} min)
            </dd>
          </div>
          <div>
            <dt>Name</dt>
            <dd>{name}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{email}</dd>
          </div>
          <div>
            <dt>Organization</dt>
            <dd>{organization}</dd>
          </div>
        </dl>
        {error && (
          <p className="auth-error" role="alert">
            <CircleAlert size={16} aria-hidden="true" /> {error}
          </p>
        )}
        <div className="demo-confirm-actions">
          <button type="button" className="btn-text" onClick={() => setStep('details')} disabled={busy}>
            <ArrowLeft size={15} aria-hidden="true" /> Edit details
          </button>
          <button type="button" className="btn-primary" onClick={confirmBooking} disabled={busy} aria-busy={busy}>
            {busy ? (
              <>
                <span className="btn-spinner" aria-hidden="true" /> Booking…
              </>
            ) : (
              'Confirm booking'
            )}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'details') {
    return (
      <div className="demo-widget">
        <button type="button" className="btn-text demo-back" onClick={() => setStep('picking')}>
          <ArrowLeft size={15} aria-hidden="true" /> Change date/time
        </button>
        <h3 className="demo-widget-title">Your details</h3>
        <form onSubmit={handleDetailsSubmit} className="auth-form">
          <label className="auth-field">
            <span className="auth-field-label">Full name</span>
            <span className="auth-input">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => touch('name')}
                aria-invalid={!!nameError}
                required
              />
            </span>
            {nameError && <span className="auth-field-error">{nameError}</span>}
          </label>

          <label className="auth-field">
            <span className="auth-field-label">Work email</span>
            <span className="auth-input">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => touch('email')}
                aria-invalid={!!emailError}
                required
              />
            </span>
            {emailError && <span className="auth-field-error">{emailError}</span>}
          </label>

          <label className="auth-field">
            <span className="auth-field-label">School / Organization</span>
            <span className="auth-input">
              <input
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                onBlur={() => touch('organization')}
                aria-invalid={!!organizationError}
                required
              />
            </span>
            {organizationError && <span className="auth-field-error">{organizationError}</span>}
          </label>

          <label className="auth-field">
            <span className="auth-field-label">Role</span>
            <span className="auth-input">
              <select value={role} onChange={(e) => setRole(e.target.value as DemoBookingRole)}>
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </span>
          </label>

          <label className="auth-field">
            <span className="auth-field-label">Phone (optional)</span>
            <span className="auth-input">
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" />
            </span>
          </label>

          <label className="auth-field">
            <span className="auth-field-label">What are you looking to solve? (optional)</span>
            <span className="auth-input">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="e.g. rolling out lesson planning support across our teachers"
              />
            </span>
          </label>

          <button type="submit" className="btn-primary">
            Continue <ArrowRight size={16} aria-hidden="true" />
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="demo-widget">
      <h3 className="demo-widget-title">Choose a date</h3>
      <DemoBookingCalendar
        config={config}
        selectedDate={selectedDate}
        selectedTime={selectedTime}
        onSelectDate={selectDate}
        onSelectTime={setSelectedTime}
      />

      {error && (
        <p className="auth-error" role="alert">
          <CircleAlert size={16} aria-hidden="true" /> {error}
        </p>
      )}

      <button type="button" className="btn-primary demo-continue" onClick={goToDetails} disabled={!selectedDate || !selectedTime}>
        Continue <ArrowRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
