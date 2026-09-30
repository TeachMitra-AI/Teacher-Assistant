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

  // Live "how far from school" check shown before the button is tapped. A nudge, not the security check (the server always
  // recomputes). When we can't tell (no config, geolocation failed, offline) the button stays enabled and the on-tap flow
  // reports its own error; only a known "too far" reading disables it.
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

  // Reflects today's queued check-in/out, if any, and re-checks server state when a queued item disappears (that's what
  // "it just synced" looks like, since attemptSync() can't know this component exists).
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

  // Wires the online/visibility sync triggers once and catches up on anything queued from a previous offline session.
  useEffect(() => {
    if (!user) return;
    const stopAutoSync = startAutoSync(() => user.id);
    void attemptSync(user.id);
    return stopAutoSync;
  }, [user]);

  useEffect(() => {
    getSchoolConfig().then(setSchoolConfig).catch(() => {}); // silent — falls back to no distance check
  }, []);

  // Re-fetches the school config every time instead of reusing the mount-time state: a Principal can move the geofence
  // while a teacher has this screen open, and "Refresh" should pick that up. (Submission is unaffected; the server uses its live config.)
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

  // Re-checks when the relevant action changes (check-in done, check-out next) so the distance matches the button on screen.
  // Depends on `hasSchoolConfig` (a primitive), not `schoolConfig`: checkDistance() sets a fresh config object every run, so
  // depending on the object looped forever, hammering the API and exhausting the shared rate limit for every
  // /api/teacher-attendance/* route. `hasSchoolConfig` flips once and stays.
  const hasSchoolConfig = schoolConfig !== null;
  useEffect(() => {
    if (!hasSchoolConfig || loading) return;
    const needsCheckIn = !today?.checkInAt && !nonWorkingDay;
    const needsCheckOut = Boolean(today?.checkInAt) && !today?.checkOutAt;
    if (needsCheckIn || needsCheckOut) void checkDistance();
  }, [hasSchoolConfig, loading, today?.checkInAt, today?.checkOutAt, nonWorkingDay, checkDistance]);

  const tooFarToActNow = Boolean(schoolConfig && liveDistanceMeters !== null && liveDistanceMeters > schoolConfig.geofenceRadiusMeters);

  // Inline "don't forget to check out" nudge, using the same 15-before/30-after window as the server's reminder sweep
  // (docs/feature-teacher-attendance-implementation-plan.md). Assumes the device clock is IST, like other teacher-facing times.
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
        // Queued rather than shown as a hard error: the evidence syncs when the connection returns.
        if (user) {
          enqueueAction(user.id, todayDateString(), kind, evidence);
          show('Saved — will sync automatically once you\'re back online.', 'info');
        } else {
          setError('No internet connection right now. Please try again once you\'re back online.');
        }
      } else if (err instanceof ApiError) {
        setError(err.message);
        // Covers "already checked in/out": the server's state is more useful than the stale one on screen. Not load(),
        // which resets `error` and would erase the message just set.
        getTodayAttendance().then((result) => setToday(result.attendance)).catch(() => {});
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setWorking(false);
      setLocationStatus('');
    }
  }

  // "Distance to school" card: present whenever there's a config to measure against, so there's no vanished button-shaped
  // gap (docs/attendance-register-design.html). The button stays, disabled with the live reason when too far.
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
          // The day is done: show the whole day (both times plus the final status) in one card rather than letting the
          // check-in half vanish at check-out.
          <div className={`attendance-checked-block attendance-day-summary tone-${today.status === 'half_day' ? 'warning' : 'routine'}`}>
            <div className="attendance-day-summary-times">
              {/* Each half is colored by whether that event was on time, so on-time check-in with an early departure
                  shows green then amber, not one color for the whole day. */}
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
