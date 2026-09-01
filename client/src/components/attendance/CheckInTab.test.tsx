// CheckInTab — docs/feature-teacher-attendance-implementation-plan.md §4.
// Renders the tab component directly (no page shell) now that
// AttendancePage owns TopBar/tabs — mirrors how ResourceWorkspace.test.tsx
// mocks Toast, and throws real ApiError instances so the component's
// `instanceof ApiError` branches are exercised for real.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CheckInTab from './CheckInTab';
import { ApiError } from '../../api';
import * as attendanceApi from '../../lib/teacherAttendanceApi';
import type { TeacherAttendanceDto, NonWorkingDayInfo, SchoolAttendanceConfigDto } from '../../types';

const showToast = vi.fn();
vi.mock('../Toast', () => ({ useToast: () => ({ show: showToast }) }));

vi.mock('../../auth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

vi.mock('../../lib/teacherAttendanceApi', () => ({
  checkIn: vi.fn(),
  checkOut: vi.fn(),
  getTodayAttendance: vi.fn(),
  getSchoolConfig: vi.fn(),
}));

vi.mock('../../lib/geolocation', () => ({
  getLocationWithRetry: vi.fn(),
  requestCurrentPosition: vi.fn(),
  distanceMeters: vi.fn(),
  LocationUnavailableError: class LocationUnavailableError extends Error {},
}));

vi.mock('../../lib/deviceId', () => ({ getOrCreateDeviceId: () => 'test-device-id' }));

// attendanceOfflineQueue.ts has its own detailed test file — stubbed here
// so CheckInTab's tests only check that it CALLS these correctly, not that
// the queue itself works.
const enqueueAction = vi.fn();
const retryQueuedAction = vi.fn();
let queuedActionReturn: unknown = null;
vi.mock('../../lib/attendanceOfflineQueue', () => ({
  enqueueAction: (...args: unknown[]) => enqueueAction(...args),
  getQueuedAction: () => queuedActionReturn,
  subscribeToQueue: () => () => {},
  attemptSync: vi.fn(),
  startAutoSync: () => () => {},
  retryQueuedAction: (...args: unknown[]) => retryQueuedAction(...args),
}));

const mockedApi = vi.mocked(attendanceApi);
const READING = { lat: 12.9716, lon: 77.5946, accuracyMeters: 15 };

function baseAttendance(overrides: Partial<TeacherAttendanceDto> = {}): TeacherAttendanceDto {
  return {
    id: 'att1',
    date: '2026-08-29',
    checkInAt: null,
    checkOutAt: null,
    status: 'present',
    lateMinutes: 0,
    earlyDepartureMinutes: null,
    workingMinutes: null,
    shortfallMinutes: null,
    leaveOrDutyCategory: null,
    leaveOrDutyReason: null,
    reviewReason: null,
    ...overrides,
  };
}

function todayResult(attendance: TeacherAttendanceDto | null, nonWorkingDay: NonWorkingDayInfo | null = null) {
  return { attendance, nonWorkingDay };
}

async function setUpGeolocation() {
  const geolocation = await import('../../lib/geolocation');
  vi.mocked(geolocation.getLocationWithRetry).mockResolvedValue(READING);
  return geolocation;
}

async function setUpDistance(meters: number) {
  const geolocation = await import('../../lib/geolocation');
  vi.mocked(geolocation.distanceMeters).mockReturnValue(meters);
  return geolocation;
}

function schoolConfig(overrides: Partial<SchoolAttendanceConfigDto> = {}): SchoolAttendanceConfigDto {
  return {
    id: 'cfg1',
    schoolId: 's1',
    openTime: '09:00',
    closeTime: '16:00',
    checkinWindowStart: '08:30',
    checkinWindowEnd: '10:00',
    weeklyOffDays: '0',
    lateGraceMinutes: 10,
    halfDayThresholdPercent: 50,
    fullDayGraceMinutes: 15,
    geofenceLat: 26.9,
    geofenceLon: 80.9,
    geofenceRadiusMeters: 180,
    repeatPatternThreshold: 3,
    repeatPatternWindowDays: 30,
    reminderMinutesBeforeClose: 15,
    reminderMinutesAfterClose: 30,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  queuedActionReturn = null;
  // Most tests below don't exercise the live-distance-check feature — this
  // keeps schoolConfig null for them, so it stays a no-op (button behaves
  // exactly as before) unless a test explicitly opts in.
  mockedApi.getSchoolConfig.mockResolvedValue(null);
});

describe('CheckInTab', () => {
  test('shows "Not checked in yet" and a Check In button when there is no record for today', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(null));
    render(<CheckInTab />);

    await waitFor(() => expect(screen.getByText('Not checked in yet')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /check in/i })).toBeInTheDocument();
  });

  test('regression: the automatic distance check settles instead of looping forever', async () => {
    // checkDistance() refetches the school config and calls setSchoolConfig
    // with a brand-new object every time it runs. The effect that
    // auto-triggers checkDistance must never depend on that object's
    // identity directly, or every fetch re-triggers itself: an infinite
    // request loop that (in real use) exhausted the shared rate limit for
    // every /api/teacher-attendance/* route, including Settings.
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(null));
    mockedApi.getSchoolConfig.mockResolvedValue(schoolConfig({ geofenceRadiusMeters: 180 }));
    await setUpGeolocation();
    await setUpDistance(45);

    render(<CheckInTab />);
    await screen.findByText('45m'); // the auto distance-check has run once

    // A settled component makes no further calls on its own. waitFor's own
    // repeated polling below gives a real infinite loop several ticks to
    // reveal itself — a runaway effect would already have pushed this well
    // past a handful of calls by the time this resolves.
    await waitFor(() => expect(mockedApi.getSchoolConfig.mock.calls.length).toBeLessThan(5));
  });

  test('checking in reads location, calls the API, and shows the result', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(null));
    mockedApi.checkIn.mockResolvedValue({
      attendance: baseAttendance({ checkInAt: '2026-08-29T03:35:00.000Z', lateMinutes: 5 }),
    });
    await setUpGeolocation();

    render(<CheckInTab />);
    await waitFor(() => expect(screen.getByRole('button', { name: /check in/i })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /check in/i }));

    await waitFor(() => expect(mockedApi.checkIn).toHaveBeenCalledWith({ ...READING, deviceId: 'test-device-id' }));
    expect(await screen.findByText(/5m late/)).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith('Checked in.', 'success');
  });

  test('an already-checked-in day shows the Check Out button, not Check In', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(baseAttendance({ checkInAt: '2026-08-29T03:30:00.000Z' })));
    render(<CheckInTab />);

    expect(await screen.findByRole('button', { name: /check out/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^check in$/i })).not.toBeInTheDocument();
  });

  test('shows the checkout reminder banner within the configured window before closing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 29, 15, 50)); // closeTime 16:00, default window starts 15min before -> 15:45
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(baseAttendance({ checkInAt: '2026-08-29T03:30:00.000Z' })));
    mockedApi.getSchoolConfig.mockResolvedValue(schoolConfig({ closeTime: '16:00' }));

    render(<CheckInTab />);
    await screen.findByRole('button', { name: /check out/i });

    expect(await screen.findByText(/don't forget to check out/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  test('does not show the reminder banner outside the configured window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 29, 12, 0)); // well before the window
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(baseAttendance({ checkInAt: '2026-08-29T03:30:00.000Z' })));
    mockedApi.getSchoolConfig.mockResolvedValue(schoolConfig({ closeTime: '16:00' }));

    render(<CheckInTab />);
    await screen.findByRole('button', { name: /check out/i });

    expect(screen.queryByText(/don't forget to check out/i)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  test("a school's custom reminder window is respected, not the old hardcoded 15/30 default", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // 50 minutes before closing — outside the old hardcoded 15-minute
    // default, but inside this school's own 60-minute setting.
    vi.setSystemTime(new Date(2026, 7, 29, 15, 10));
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(baseAttendance({ checkInAt: '2026-08-29T03:30:00.000Z' })));
    mockedApi.getSchoolConfig.mockResolvedValue(
      schoolConfig({ closeTime: '16:00', reminderMinutesBeforeClose: 60, reminderMinutesAfterClose: 5 })
    );

    render(<CheckInTab />);
    await screen.findByRole('button', { name: /check out/i });

    expect(await screen.findByText(/don't forget to check out/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  test('checking out shows the whole day — check-in AND check-out together, not just the checkout half', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(baseAttendance({ checkInAt: '2026-08-29T03:30:00.000Z', lateMinutes: 5 })));
    mockedApi.checkOut.mockResolvedValue({
      attendance: baseAttendance({
        checkInAt: '2026-08-29T03:30:00.000Z',
        checkOutAt: '2026-08-29T09:30:00.000Z',
        status: 'present',
        lateMinutes: 5,
        workingMinutes: 360,
        shortfallMinutes: 60,
      }),
    });
    await setUpGeolocation();

    render(<CheckInTab />);
    await userEvent.click(await screen.findByRole('button', { name: /check out/i }));

    // Both halves of the day are visible at once, not just whichever
    // action happened last.
    expect(await screen.findByText('Checked in')).toBeInTheDocument();
    expect(screen.getByText('Checked out')).toBeInTheDocument();
    expect(screen.getByText('5m late')).toBeInTheDocument();

    const footer = document.querySelector('.attendance-day-summary-footer');
    expect(footer).toHaveTextContent('Present');
    expect(footer).toHaveTextContent('Worked 6h — 1h short of a full day');

    // The two halves are colored independently: this check-in was late
    // (amber), but the check-out was on time (green) — one bad half must
    // not tint the other.
    const [checkInCol, checkOutCol] = document.querySelectorAll('.attendance-day-summary-col');
    expect(checkInCol).toHaveClass('tone-warning');
    expect(checkOutCol).toHaveClass('tone-routine');
  });

  test('checking in from too far away is blocked outright — a clear error, no attendance saved', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(null));
    mockedApi.checkIn.mockRejectedValue(
      new ApiError("You're too far from school to check in (410m away).", 403)
    );
    await setUpGeolocation();

    render(<CheckInTab />);
    await userEvent.click(await screen.findByRole('button', { name: /check in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too far from school/i);
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('Checked in'), expect.anything());
  });

  test('checking in after the check-in window closes is blocked outright', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(null));
    mockedApi.checkIn.mockRejectedValue(new ApiError('The check-in window for today has closed.', 403));
    await setUpGeolocation();

    render(<CheckInTab />);
    await userEvent.click(await screen.findByRole('button', { name: /check in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/window.*closed/i);
  });

  test('a denied location permission shows a clear message and never calls the API', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(null));
    const geolocation = await import('../../lib/geolocation');
    vi.mocked(geolocation.getLocationWithRetry).mockRejectedValue({ code: 1, message: 'denied' });

    render(<CheckInTab />);
    await userEvent.click(await screen.findByRole('button', { name: /check in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/location permission was denied/i);
    expect(mockedApi.checkIn).not.toHaveBeenCalled();
  });

  test('an "already checked in" response shows the server message and refetches today', async () => {
    mockedApi.getTodayAttendance
      .mockResolvedValueOnce(todayResult(null))
      .mockResolvedValueOnce(todayResult(baseAttendance({ checkInAt: '2026-08-29T03:30:00.000Z' })));
    mockedApi.checkIn.mockRejectedValue(new ApiError('You already checked in today.', 409));
    await setUpGeolocation();

    render(<CheckInTab />);
    await userEvent.click(await screen.findByRole('button', { name: /check in/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('You already checked in today.');
    await waitFor(() => expect(mockedApi.getTodayAttendance).toHaveBeenCalledTimes(2));
  });

  test('a network failure queues the check-in instead of showing a hard error', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(null));
    mockedApi.checkIn.mockRejectedValue(new ApiError('Network error. Please check your connection.', 0));
    await setUpGeolocation();

    render(<CheckInTab />);
    await userEvent.click(await screen.findByRole('button', { name: /check in/i }));

    await waitFor(() =>
      expect(enqueueAction).toHaveBeenCalledWith('u1', expect.any(String), 'check-in', {
        ...READING,
        deviceId: 'test-device-id',
      })
    );
    expect(showToast).toHaveBeenCalledWith('Saved — will sync automatically once you\'re back online.', 'info');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a queued action shows the sync banner, and Retry now calls retryQueuedAction', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(null));
    queuedActionReturn = { key: 'u1:2026-08-29:check-in', kind: 'check-in' };

    render(<CheckInTab />);

    expect(await screen.findByText(/will sync automatically once you're back online/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry now/i }));

    expect(retryQueuedAction).toHaveBeenCalledWith('u1:2026-08-29:check-in', 'u1');
  });

  test('a non-working day (holiday/weekly-off) shows the server\'s message instead of a Check In button', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(
      todayResult(null, { code: 'HOLIDAY', message: 'Today is a holiday (Gandhi Jayanti) — no check-in is needed.' })
    );
    render(<CheckInTab />);

    expect(await screen.findByText('Today is a holiday (Gandhi Jayanti) — no check-in is needed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^check in$/i })).not.toBeInTheDocument();
  });

  test('a non-working day is ignored once a check-in already exists for today (e.g. a manual correction)', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(
      todayResult(baseAttendance({ checkInAt: '2026-08-29T03:30:00.000Z' }), {
        code: 'WEEKLY_OFF_DAY',
        message: 'Today is a weekly off day for your school — no check-in is needed.',
      })
    );
    render(<CheckInTab />);

    expect(await screen.findByRole('button', { name: /check out/i })).toBeInTheDocument();
    expect(screen.queryByText(/weekly off day/i)).not.toBeInTheDocument();
  });
});

describe('CheckInTab — live distance check (grey out when too far)', () => {
  test('too far from school: Check In is disabled and says how far away and how close you need to be', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(null));
    mockedApi.getSchoolConfig.mockResolvedValue(schoolConfig({ geofenceRadiusMeters: 180 }));
    await setUpGeolocation();
    await setUpDistance(450);

    render(<CheckInTab />);

    expect(await screen.findByText('450m')).toBeInTheDocument();
    expect(screen.getByText(/need to be within 180m/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check in/i })).toBeDisabled();
  });

  test('within range: Check In stays enabled and just shows the distance', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(null));
    mockedApi.getSchoolConfig.mockResolvedValue(schoolConfig({ geofenceRadiusMeters: 180 }));
    await setUpGeolocation();
    await setUpDistance(45);

    render(<CheckInTab />);

    expect(await screen.findByText('45m')).toBeInTheDocument();
    expect(screen.getByText(/within range/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check in/i })).not.toBeDisabled();
  });

  test('too far from school also disables Check Out', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(
      todayResult(baseAttendance({ checkInAt: '2026-08-29T03:30:00.000Z' }))
    );
    mockedApi.getSchoolConfig.mockResolvedValue(schoolConfig({ geofenceRadiusMeters: 180 }));
    await setUpGeolocation();
    await setUpDistance(900);

    render(<CheckInTab />);

    expect(await screen.findByText(/need to be within 180m/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check out/i })).toBeDisabled();
  });

  test('when distance can\'t be determined (e.g. permission denied), the button stays enabled — never blocks on "unknown"', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(null));
    mockedApi.getSchoolConfig.mockResolvedValue(schoolConfig());
    const geolocation = await import('../../lib/geolocation');
    vi.mocked(geolocation.getLocationWithRetry).mockRejectedValue(new Error('denied'));

    render(<CheckInTab />);
    await waitFor(() => expect(mockedApi.getSchoolConfig).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: /check in/i })).not.toBeDisabled();
    expect(screen.queryByText('Distance to school')).not.toBeInTheDocument();
  });

  test('Refresh re-checks the current distance', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(null));
    mockedApi.getSchoolConfig.mockResolvedValue(schoolConfig({ geofenceRadiusMeters: 180 }));
    const geolocation = await setUpGeolocation();
    vi.mocked(geolocation.distanceMeters).mockReturnValueOnce(450).mockReturnValueOnce(50);

    render(<CheckInTab />);
    await screen.findByText('450m');
    expect(screen.getByRole('button', { name: /check in/i })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => expect(screen.getByText('50m')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /check in/i })).not.toBeDisabled();
  });

  test('Refresh also picks up a school config change made elsewhere (e.g. the admin just moved the geofence) — no page reload needed', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(null));
    mockedApi.getSchoolConfig.mockResolvedValue(schoolConfig({ geofenceRadiusMeters: 180 }));
    await setUpGeolocation();
    await setUpDistance(100); // the teacher's physical distance never changes

    render(<CheckInTab />);
    // Starts in range: 100m is inside the original 180m radius.
    await waitFor(() => expect(screen.getByRole('button', { name: /check in/i })).not.toBeDisabled());

    // The admin shrinks the geofence while this screen is already open.
    mockedApi.getSchoolConfig.mockResolvedValue(schoolConfig({ geofenceRadiusMeters: 50 }));

    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));

    // Refresh alone (no page reload) picks up the new, smaller radius.
    await waitFor(() => expect(screen.getByRole('button', { name: /check in/i })).toBeDisabled());
    expect(screen.getByText(/need to be within 50m/i)).toBeInTheDocument();
  });

  test('no school config yet: no distance check at all, button behaves as before', async () => {
    mockedApi.getTodayAttendance.mockResolvedValue(todayResult(null));
    mockedApi.getSchoolConfig.mockResolvedValue(null);

    render(<CheckInTab />);
    await waitFor(() => expect(mockedApi.getSchoolConfig).toHaveBeenCalled());

    expect(screen.queryByText(/from school/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /check in/i })).not.toBeDisabled();
  });
});
