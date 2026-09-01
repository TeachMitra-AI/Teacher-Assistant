import { useCallback, useEffect, useState } from 'react';
import { MapPin, Loader2, AlertTriangle, CloudOff, CalendarOff, RefreshCw, Bell } from 'lucide-react';
import { useToast } from '../Toast';
import { useAuth } from '../../auth';
import { ApiError } from '../../api';
import { checkIn, checkOut, getTodayAttendance, getSchoolConfig, type AttendanceEvidenceInput } from '../../lib/teacherAttendanceApi';
import { getLocationWithRetry, requestCurrentPosition, distanceMeters, LocationUnavailableError } from '../../lib/geolocation';
import { getOrCreateDeviceId } from '../../lib/deviceId';
import {
  TEACHER_ATTENDANCE_STATUS_LABEL,
  formatAttendanceTime,
  formatDuration,
  formatDistance,
} from '../../lib/teacherAttendanceLabels';
import { todayDateString } from '../../lib/classroomDate';
import {
  enqueueAction,
  getQueuedAction,
  subscribeToQueue,
  attemptSync,
  startAutoSync,
  retryQueuedAction,
  type QueuedAttendanceAction,
} from '../../lib/attendanceOfflineQueue';
import type { TeacherAttendanceDto, NonWorkingDayInfo, SchoolAttendanceConfigDto } from '../../types';

function isGeolocationError(err: unknown): err is GeolocationPositionError {
  return typeof err === 'object' && err !== null && 'code' in err && typeof (err as { code: unknown }).code === 'number';
}

const GEOLOCATION_PERMISSION_DENIED = 1;
const GEOLOCATION_TIMEOUT = 3;

export default function CheckInTab() {
  const { show } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [today, setToday] = useState<TeacherAttendanceDto | null>(null);
  const [working, setWorking] = useState(false);
  const [locationStatus, setLocationStatus] = useState('');
  const [error, setError] = useState('');
  const [nonWorkingDay, setNonWorkingDay] = useState<NonWorkingDayInfo | null>(null);
  const [queuedAction, setQueuedAction] = useState<QueuedAttendanceAction | null>(null);

  // Live "how far am I from school" check, shown BEFORE the button is
  // tapped — a nudge, not the real security check (the server always
  // recomputes distance independently and is what actually decides). When
  // we can't tell (no config yet, geolocation failed, offline), the button
  // stays enabled and falls back to the existing on-tap flow, which
  // surfaces its own clear error — only a KNOWN "too far" reading disables it.
  const [schoolConfig, setSchoolConfig] = useState<SchoolAttendanceConfigDto | null>(null);
  const [liveDistanceMeters, setLiveDistanceMeters] = useState<number | null>(null);
  const [checkingDistance, setCheckingDistance] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getTodayAttendance();
      setToday(result.attendance);
      setNonWorkingDay(result.nonWorkingDay);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load today\'s attendance.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Reflects today's queued (not-yet-synced) check-in/check-out, if any, and
  // re-checks today's real server state the moment a queued item disappears
  // — that's what "it just synced" looks like, since attemptSync() itself
  // has no way to know this component exists.
  const refreshQueuedAction = useCallback(() => {
    if (!user) return;
    const date = todayDateString();
    const queued = getQueuedAction(user.id, date, 'check-in') ?? getQueuedAction(user.id, date, 'check-out');
    setQueuedAction((prev) => {
      if (prev && !queued) void load();
      return queued;
    });
  }, [user, load]);

  useEffect(() => {
    refreshQueuedAction();
    return subscribeToQueue(refreshQueuedAction);
  }, [refreshQueuedAction]);

  // Wires the browser's online/visibility sync triggers once, and catches
  // up on anything left queued from a previous offline session.
  useEffect(() => {
    if (!user) return;
    const stopAutoSync = startAutoSync(() => user.id);
    void attemptSync(user.id);
    return stopAutoSync;
  }, [user]);

  useEffect(() => {
    getSchoolConfig().then(setSchoolConfig).catch(() => {}); // silent — falls back to no distance check
  }, []);

  // Re-fetches the school's config fresh every time, rather than reusing
  // the `schoolConfig` state captured at mount — a Principal can change the
  // geofence location in Settings while a teacher already has this screen
  // open, and "Refresh" is exactly the button that should pick that up
  // without needing a full page reload. (The actual check-in/check-out
  // submission was never affected by this — the server always recomputes
  // against its own live config; this only fixes the on-screen preview.)
  const checkDistance = useCallback(async () => {
    setCheckingDistance(true);
    try {
      const [position, freshConfig] = await Promise.all([
        getLocationWithRetry((options) => requestCurrentPosition(options)),
        getSchoolConfig(),
      ]);
      if (!freshConfig) {
        setLiveDistanceMeters(null);
        return;
      }
      setSchoolConfig(freshConfig);
      setLiveDistanceMeters(distanceMeters(position.lat, position.lon, freshConfig.geofenceLat, freshConfig.geofenceLon));
    } catch {
      setLiveDistanceMeters(null); // unknown, not "too far" — never blocks the button by itself
    } finally {
      setCheckingDistance(false);
    }
  }, []);

  // Re-checks whenever the relevant action changes (check-in done -> now
  // check-out is next) so the distance shown always matches which button is
  // actually on screen.
  //
  // Depends on `hasSchoolConfig` (a primitive), NOT `schoolConfig` itself —
  // checkDistance() calls setSchoolConfig() with a freshly-fetched object
  // every time it runs, and a new object is never === the old one, so
  // depending on the object directly turned this into an infinite loop:
  // effect fires -> checkDistance() -> setSchoolConfig(new object) ->
  // dependency "changed" -> effect fires again -> forever, hammering the
  // API (and exhausting the shared rate limit for every other
  // /api/teacher-attendance/* route, including Settings). `hasSchoolConfig`
  // flips false -> true exactly once and then never changes again, so the
  // effect still fires the moment a config first loads, but never again
  // just because a later fetch happened to return a new object.
  const hasSchoolConfig = schoolConfig !== null;
  useEffect(() => {
    if (!hasSchoolConfig || loading) return;
    const needsCheckIn = !today?.checkInAt && !nonWorkingDay;
    const needsCheckOut = Boolean(today?.checkInAt) && !today?.checkOutAt;
    if (needsCheckIn || needsCheckOut) void checkDistance();
  }, [hasSchoolConfig, loading, today?.checkInAt, today?.checkOutAt, nonWorkingDay, checkDistance]);

  const tooFarToActNow = Boolean(schoolConfig && liveDistanceMeters !== null && liveDistanceMeters > schoolConfig.geofenceRadiusMeters);

  // Calm, inline "don't forget to check out" nudge — the same 15-before /
  // 30-after window the server's own reminder sweep uses
  // (docs/feature-teacher-attendance-implementation-plan.md §1.4/§5), shown
  // right on the screen a teacher is already looking at instead of relying
  // solely on a push notification. Assumes the device's own clock is IST,
  // same as every other teacher-facing time display in this app.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  const closingSoon = (() => {
    if (!schoolConfig || !today?.checkInAt || today.checkOutAt) return false;
    const [closeH, closeM] = schoolConfig.closeTime.split(':').map(Number);
    const closeMinutes = closeH * 60 + closeM;
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return (
      nowMinutes >= closeMinutes - schoolConfig.reminderMinutesBeforeClose &&
      nowMinutes <= closeMinutes + schoolConfig.reminderMinutesAfterClose
    );
  })();

  async function performAction(kind: 'check-in' | 'check-out') {
    setWorking(true);
    setError('');
    setLocationStatus('Getting your location…');

    let evidence: AttendanceEvidenceInput;
    try {
      const position = await getLocationWithRetry((options) => requestCurrentPosition(options));
      evidence = { ...position, deviceId: getOrCreateDeviceId() };
    } catch (err) {
      if (err instanceof LocationUnavailableError) {
        setError(err.message);
      } else if (isGeolocationError(err)) {
        if (err.code === GEOLOCATION_PERMISSION_DENIED) {
          setError('Location permission was denied. Please allow location access and try again.');
        } else if (err.code === GEOLOCATION_TIMEOUT) {
          setError('Getting your location took too long. Please try again.');
        } else {
          setError('Could not get your location. Please try again.');
        }
      } else {
        setError('Something went wrong. Please try again.');
      }
      setWorking(false);
      setLocationStatus('');
      return;
    }

    setLocationStatus(kind === 'check-in' ? 'Checking in…' : 'Checking out…');
    try {
      const result = kind === 'check-in' ? await checkIn(evidence) : await checkOut(evidence);

      setToday(result.attendance);
      show(kind === 'check-in' ? 'Checked in.' : 'Checked out.', 'success');
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        // Queued rather than shown as a hard error — evidence isn't lost,
        // it syncs automatically the moment the connection comes back.
        if (user) {
          enqueueAction(user.id, todayDateString(), kind, evidence);
          show('Saved — will sync automatically once you\'re back online.', 'info');
        } else {
          setError('No internet connection right now. Please try again once you\'re back online.');
        }
      } else if (err instanceof ApiError) {
        setError(err.message);
        // Covers "already checked in/out" — the current server state is
        // more useful to show than the stale one already on screen.
        // Deliberately NOT load(): it resets error to '' internally,
        // which would immediately erase the message just set above.
        getTodayAttendance().then((result) => setToday(result.attendance)).catch(() => {});
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setWorking(false);
      setLocationStatus('');
    }
  }

  // "Distance to school" card — always present once there's a config to
  // measure against, never a vanished button-shaped gap
  // (docs/attendance-register-design.html §1/§2): the button itself stays
  // on screen either way, just disabled with the live reason when too far.
  function renderDistanceCard() {
    if (!schoolConfig) return null;
    if (liveDistanceMeters === null) {
      return checkingDistance ? (
        <div className="attendance-distance-card">
          <Loader2 size={16} className="btn-spinner" aria-hidden="true" />
          <span className="attendance-distance-card-caption">Checking your distance from school…</span>
        </div>
      ) : null;
    }
    return (
      <div className={`attendance-distance-card${tooFarToActNow ? ' attendance-distance-toofar' : ''}`}>
        <span className="attendance-distance-card-label">Distance to school</span>
        <span className="attendance-distance-card-value">{formatDistance(liveDistanceMeters)}</span>
        <span className="attendance-distance-card-caption">
          {tooFarToActNow ? `need to be within ${formatDistance(schoolConfig.geofenceRadiusMeters)}` : 'within range'}
        </span>
        <button
          type="button"
          className="btn-text attendance-distance-card-refresh"
          onClick={checkDistance}
          disabled={checkingDistance}
        >
          <RefreshCw size={12} aria-hidden="true" />
          Refresh
        </button>
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="attendance-error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {queuedAction && (
        <div className="attendance-queued-banner" role="status">
          <CloudOff size={16} aria-hidden="true" />
          <span>
            Your {queuedAction.kind === 'check-in' ? 'check-in' : 'check-out'} is saved and will sync automatically
            once you're back online.
          </span>
          <button
            type="button"
            className="btn-text"
            onClick={() => user && retryQueuedAction(queuedAction.key, user.id)}
          >
            Retry now
          </button>
        </div>
      )}

      <div className="attendance-card">
        {loading ? (
          <div className="run-skeleton" aria-label="Loading">
            <div className="sk-line" />
            <div className="sk-line" />
            <div className="sk-line" />
          </div>
        ) : nonWorkingDay && !today?.checkInAt ? (
          <p className="attendance-state">
            <CalendarOff size={16} aria-hidden="true" className="attendance-state-icon" />
            {nonWorkingDay.message}
          </p>
        ) : !today?.checkInAt ? (
          <>
            <p className="attendance-state">Not checked in yet</p>
            {renderDistanceCard()}
            <button
              type="button"
              className="btn-primary attendance-action"
              onClick={() => performAction('check-in')}
              disabled={working || tooFarToActNow}
            >
              {working ? (
                <>
                  <Loader2 size={16} className="btn-spinner" aria-hidden="true" />
                  {locationStatus || 'Checking in…'}
                </>
              ) : (
                <>
                  <MapPin size={16} aria-hidden="true" />
                  Check In
                </>
              )}
            </button>
            {tooFarToActNow && (
              <p className="attendance-hint">Move closer to school — the button turns on automatically within range.</p>
            )}
          </>
        ) : !today.checkOutAt ? (
          <>
            <div className="attendance-checked-block">
              <span className="attendance-checked-label">Checked in</span>
              <span className="attendance-checked-time">{formatAttendanceTime(today.checkInAt)}</span>
              <span className="attendance-checked-sub">
                {today.lateMinutes ? `${formatDuration(today.lateMinutes)} late` : 'On time'}
              </span>
            </div>
            {closingSoon && (
              <p className="attendance-reminder-banner" role="status">
                <Bell size={14} aria-hidden="true" />
                Don't forget to check out before school closes.
              </p>
            )}
            {renderDistanceCard()}
            <button
              type="button"
              className="btn-primary attendance-action"
              onClick={() => performAction('check-out')}
              disabled={working || tooFarToActNow}
            >
              {working ? (
                <>
                  <Loader2 size={16} className="btn-spinner" aria-hidden="true" />
                  {locationStatus || 'Checking out…'}
                </>
              ) : (
                <>
                  <MapPin size={16} aria-hidden="true" />
                  Check Out
                </>
              )}
            </button>
            {tooFarToActNow && (
              <p className="attendance-hint">Move closer to school — the button turns on automatically within range.</p>
            )}
          </>
        ) : (
          // The day is done — this is the one card a teacher actually
          // wants to see afterward, so it shows the whole day (both times,
          // not just whichever action happened last) plus the final word
          // on it, in one place, instead of the check-in half vanishing
          // the moment check-out happens.
          <div className={`attendance-checked-block attendance-day-summary tone-${today.status === 'half_day' ? 'warning' : 'routine'}`}>
            <div className="attendance-day-summary-times">
              {/* Each half is colored by whether THAT event was on time —
                  a teacher who checked in on time but left early should see
                  green on the left and amber on the right, not one blanket
                  color for the whole day driven only by the overall status. */}
              <div className={`attendance-day-summary-col tone-${today.lateMinutes ? 'warning' : 'routine'}`}>
                <span className="attendance-checked-label">Checked in</span>
                <span className="attendance-checked-time">{formatAttendanceTime(today.checkInAt)}</span>
                <span className="attendance-checked-sub">{today.lateMinutes ? `${formatDuration(today.lateMinutes)} late` : 'On time'}</span>
              </div>
              <div className="attendance-day-summary-divider" aria-hidden="true" />
              <div className={`attendance-day-summary-col tone-${today.earlyDepartureMinutes ? 'warning' : 'routine'}`}>
                <span className="attendance-checked-label">Checked out</span>
                <span className="attendance-checked-time">{formatAttendanceTime(today.checkOutAt)}</span>
                <span className="attendance-checked-sub">
                  {today.earlyDepartureMinutes ? `${formatDuration(today.earlyDepartureMinutes)} early` : 'On time'}
                </span>
              </div>
            </div>
            <div className="attendance-day-summary-footer">
              <span className="attendance-day-summary-status">{TEACHER_ATTENDANCE_STATUS_LABEL[today.status]}</span>
              {typeof today.workingMinutes === 'number' && (
                <span className="attendance-day-summary-worked">
                  Worked {formatDuration(today.workingMinutes)}
                  {typeof today.shortfallMinutes === 'number' && today.shortfallMinutes > 0
                    ? ` — ${formatDuration(today.shortfallMinutes)} short of a full day`
                    : ''}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
