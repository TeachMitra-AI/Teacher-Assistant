import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CircleAlert } from 'lucide-react';
import { usePreferences } from '../hooks/usePreferences';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useAuthModal } from '../hooks/useAuthModal';
import AuthModal from '../components/AuthModal';
import { PublicHeader, PublicFooter } from '../components/PublicSiteChrome';
import { DemoBookingCalendar } from '../components/DemoBookingCalendar';
import { ApiError } from '../api';
import {
  cancelDemoBooking,
  formatSlotLabel,
  getDemoBooking,
  getDemoBookingConfig,
  rescheduleDemoBooking,
  type DemoBooking,
  type DemoBookingConfig,
} from '../lib/scheduleDemo';

// Reschedule/cancel page for a Schedule a Call booking, reached from the confirmation email link (?id=...&token=...). No
// login: the same "possess the token" model as password reset. The date/time picker is DemoBookingCalendar, shared with
// DemoBookingWidget's initial booking.
export default function ManageBookingPage({ signedIn = false }: { signedIn?: boolean }) {
  const { theme, toggleTheme } = usePreferences();
  const { authMode, openAuth, closeAuth } = useAuthModal();
  const [searchParams] = useSearchParams();
  const id = searchParams.get('id') || '';
  const token = searchParams.get('token') || '';

  useDocumentMeta({
    title: 'Manage your SarasTech call',
    description: 'Reschedule or cancel your scheduled call with SarasTech.',
    // Canonical points at the bare path, since a token-bearing URL shouldn't be what search engines treat as canonical.
    canonical: 'https://www.sarastech.co.in/schedule-demo/manage',
  });

  const [booking, setBooking] = useState<DemoBooking | null>(null);
  const [config, setConfig] = useState<DemoBookingConfig | null>(null);
  const [loadError, setLoadError] = useState('');

  const [rescheduling, setRescheduling] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (!id || !token) {
      setLoadError('This link is missing some information. Please use the link from your confirmation email.');
      return;
    }
    let cancelled = false;
    Promise.all([getDemoBooking(id, token), getDemoBookingConfig()])
      .then(([b, c]) => {
        if (!cancelled) {
          setBooking(b);
          setConfig(c);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof ApiError && err.status === 404 ? 'This booking could not be found.' : 'Something went wrong loading this booking.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [id, token]);

  async function handleReschedule() {
    if (!selectedDate || !selectedTime) return;
    setBusy(true);
    setActionError('');
    try {
      const updated = await rescheduleDemoBooking(id, token, { date: selectedDate, startTime: selectedTime });
      setBooking(updated);
      setRescheduling(false);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    setBusy(true);
    setActionError('');
    try {
      const updated = await cancelDemoBooking(id, token);
      setBooking(updated);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="home-page seo-page demo-page">
      <PublicHeader theme={theme} toggleTheme={toggleTheme} signedIn={signedIn} onOpenAuth={openAuth} />

      <main>
        <header className="demo-hero">
          <span className="home-eyebrow">Schedule a Call</span>
          <h1>Manage your call</h1>
        </header>

        <div className="demo-manage-panel">
          {loadError && (
            <p className="auth-error" role="alert">
              <CircleAlert size={16} aria-hidden="true" /> {loadError}
            </p>
          )}

          {!loadError && !booking && <p className="demo-widget-sub">Loading your booking…</p>}

          {booking && booking.status === 'cancelled' && (
            <div className="demo-widget">
              <p>This call has been cancelled. If that wasn&rsquo;t intentional, please book a new one from the homepage.</p>
            </div>
          )}

          {booking && booking.status === 'confirmed' && !rescheduling && (
            <div className="demo-widget">
              <h3 className="demo-widget-title">{booking.dateLabel}</h3>
              <p className="demo-widget-sub">
                {booking.timeLabel} · {booking.durationMinutes} minutes with {booking.organization}
              </p>
              {actionError && (
                <p className="auth-error" role="alert">
                  <CircleAlert size={16} aria-hidden="true" /> {actionError}
                </p>
              )}
              <div className="demo-confirm-actions">
                <button type="button" className="btn-outline" onClick={() => setRescheduling(true)} disabled={busy}>
                  Reschedule
                </button>
                <button type="button" className="btn-text" onClick={handleCancel} disabled={busy}>
                  Cancel booking
                </button>
              </div>
            </div>
          )}

          {booking && booking.status === 'confirmed' && rescheduling && config && (
            <div className="demo-widget">
              <h3 className="demo-widget-title">Choose a new date</h3>
              <DemoBookingCalendar
                config={config}
                selectedDate={selectedDate}
                selectedTime={selectedTime}
                onSelectDate={(d) => {
                  setSelectedDate(d);
                  setSelectedTime(null);
                }}
                onSelectTime={setSelectedTime}
              />
              {actionError && (
                <p className="auth-error" role="alert">
                  <CircleAlert size={16} aria-hidden="true" /> {actionError}
                </p>
              )}
              <div className="demo-confirm-actions">
                <button type="button" className="btn-text" onClick={() => setRescheduling(false)} disabled={busy}>
                  Back
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleReschedule}
                  disabled={busy || !selectedDate || !selectedTime}
                  aria-busy={busy}
                >
                  {busy ? (
                    <>
                      <span className="btn-spinner" aria-hidden="true" /> Saving…
                    </>
                  ) : (
                    `Confirm ${selectedTime ? formatSlotLabel(selectedTime) : 'new time'}`
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      <PublicFooter signedIn={signedIn} onOpenAuth={openAuth} />

      {!signedIn && <AuthModal open={authMode !== null} mode={authMode ?? 'login'} theme={theme} onClose={closeAuth} />}
    </div>
  );
}
