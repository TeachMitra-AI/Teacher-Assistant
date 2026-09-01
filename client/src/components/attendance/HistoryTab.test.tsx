import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HistoryTab from './HistoryTab';
import { ApiError } from '../../api';
import * as attendanceApi from '../../lib/teacherAttendanceApi';
import { currentMonthString } from '../../lib/classroomDate';
import type { TeacherAttendanceDto, SchoolAttendanceConfigDto } from '../../types';

vi.mock('../../lib/teacherAttendanceApi', () => ({
  getAttendanceHistory: vi.fn(),
  getSchoolConfig: vi.fn(),
  getHolidays: vi.fn(),
}));

// Joined well before the school's config was created in every test below,
// so this floor never interferes unless a test sets mockUserCreatedAt.
let mockUserCreatedAt = '2020-01-01T00:00:00.000Z';
vi.mock('../../auth', () => ({ useAuth: () => ({ user: { id: 'u1', createdAt: mockUserCreatedAt } }) }));

const mockedApi = vi.mocked(attendanceApi);
const CURRENT_MONTH = currentMonthString();

function day(overrides: Partial<TeacherAttendanceDto> = {}): TeacherAttendanceDto {
  return {
    id: 'att1',
    date: `${CURRENT_MONTH}-03`,
    checkInAt: `${CURRENT_MONTH}-03T03:30:00.000Z`,
    checkOutAt: `${CURRENT_MONTH}-03T10:30:00.000Z`,
    status: 'present',
    lateMinutes: 0,
    earlyDepartureMinutes: null,
    workingMinutes: 420,
    shortfallMinutes: null,
    leaveOrDutyCategory: null,
    leaveOrDutyReason: null,
    reviewReason: null,
    ...overrides,
  };
}

function config(overrides: Partial<SchoolAttendanceConfigDto> = {}): SchoolAttendanceConfigDto {
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
    createdAt: `${CURRENT_MONTH}-01T00:00:00.000Z`,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUserCreatedAt = '2020-01-01T00:00:00.000Z';
  // Default: no config — every existing test below relies on the "can't
  // tell weekly-off/holiday from Absent without a config" fallback, which
  // only shows days that actually have a record (the old behavior).
  mockedApi.getSchoolConfig.mockResolvedValue(null);
  mockedApi.getHolidays.mockResolvedValue([]);
});

describe('HistoryTab — without a school config (fallback: only real records)', () => {
  test('loads and shows the current month by default', async () => {
    mockedApi.getAttendanceHistory.mockResolvedValue([day()]);
    render(<HistoryTab />);

    await waitFor(() => expect(mockedApi.getAttendanceHistory).toHaveBeenCalledWith(CURRENT_MONTH));
    expect(await screen.findByText('Present')).toBeInTheDocument();
  });

  test('shows late/shortfall detail together with the status, visually flagged as worth a second look', async () => {
    mockedApi.getAttendanceHistory.mockResolvedValue([day({ lateMinutes: 5, shortfallMinutes: 30 })]);
    render(<HistoryTab />);

    await waitFor(() => expect(document.querySelector('.attendance-history-status')).not.toBeNull());
    const status = document.querySelector('.attendance-history-status')!;
    expect(status).toHaveTextContent('Present · Late 5m · Short 30m');
    // The Late/Short parts render in their own highlighted span, not as
    // plain text indistinguishable from an ordinary day.
    expect(status.querySelectorAll('.attendance-history-flag')).toHaveLength(2);
  });

  test("a reviewed day shows the Principal's own reason underneath, not just the final status", async () => {
    mockedApi.getAttendanceHistory.mockResolvedValue([
      day({ status: 'present', reviewReason: 'Confirmed with the teacher — official duty.' }),
    ]);
    render(<HistoryTab />);

    expect(await screen.findByText('Principal: “Confirmed with the teacher — official duty.”')).toBeInTheDocument();
  });

  test('a never-reviewed day shows no reason line at all', async () => {
    mockedApi.getAttendanceHistory.mockResolvedValue([day({ reviewReason: null })]);
    render(<HistoryTab />);

    await screen.findByText('Present');
    expect(screen.queryByText(/^Principal:/)).not.toBeInTheDocument();
  });

  test('an empty month shows the empty-state message, not a blank list', async () => {
    mockedApi.getAttendanceHistory.mockResolvedValue([]);
    render(<HistoryTab />);

    expect(await screen.findByText(/no attendance recorded for this month/i)).toBeInTheDocument();
  });

  test('a load failure shows the error banner', async () => {
    mockedApi.getAttendanceHistory.mockRejectedValue(new ApiError('Could not load your attendance history.', 500));
    render(<HistoryTab />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your attendance history.');
  });

  test('the "Next month" button is disabled on the current month — there is nothing ahead to show', async () => {
    mockedApi.getAttendanceHistory.mockResolvedValue([]);
    render(<HistoryTab />);
    await waitFor(() => expect(mockedApi.getAttendanceHistory).toHaveBeenCalled());

    expect(screen.getByRole('button', { name: /next month/i })).toBeDisabled();
  });

  test('"Previous month" re-fetches for the month before', async () => {
    mockedApi.getAttendanceHistory.mockResolvedValue([]);
    render(<HistoryTab />);
    await waitFor(() => expect(mockedApi.getAttendanceHistory).toHaveBeenCalledWith(CURRENT_MONTH));

    await userEvent.click(screen.getByRole('button', { name: /previous month/i }));

    await waitFor(() => expect(mockedApi.getAttendanceHistory).toHaveBeenLastCalledWith(expect.not.stringMatching(`^${CURRENT_MONTH}$`)));
  });
});

describe('HistoryTab — teacher joined after the school config existed', () => {
  test('a month before this teacher joined shows the empty state, even though the school was already tracking', async () => {
    mockUserCreatedAt = `${CURRENT_MONTH}-15T00:00:00.000Z`;
    mockedApi.getAttendanceHistory.mockResolvedValue([]);
    mockedApi.getSchoolConfig.mockResolvedValue(config({ createdAt: '2020-01-01T00:00:00.000Z' }));
    render(<HistoryTab />);

    await userEvent.click(screen.getByRole('button', { name: /previous month/i }));

    expect(await screen.findByText(/no attendance recorded for this month/i)).toBeInTheDocument();
    expect(screen.queryByText('Absent')).not.toBeInTheDocument();
  });
});

describe('HistoryTab — with a school config (shows Absent, Weekly off, and Holiday days too)', () => {
  test('a day with no record and no reason to be off shows as Absent', async () => {
    mockedApi.getAttendanceHistory.mockResolvedValue([]); // nothing recorded at all
    mockedApi.getSchoolConfig.mockResolvedValue(config());
    render(<HistoryTab />);

    // Some day in the fetched range should read "Absent" — the exact date
    // depends on what "today" is, so just confirm the label appears at all.
    expect(await screen.findAllByText('Absent')).not.toHaveLength(0);
  });

  test('a weekly off day is labelled "Weekly off", not "Absent"', async () => {
    mockedApi.getAttendanceHistory.mockResolvedValue([]);
    mockedApi.getSchoolConfig.mockResolvedValue(config({ weeklyOffDays: '0,1,2,3,4,5,6' })); // every day off, isolates the label
    render(<HistoryTab />);

    expect(await screen.findAllByText('Weekly off')).not.toHaveLength(0);
    expect(screen.queryByText('Absent')).not.toBeInTheDocument();
  });

  test('a declared holiday shows its reason, not "Absent"', async () => {
    mockedApi.getAttendanceHistory.mockResolvedValue([]);
    mockedApi.getSchoolConfig.mockResolvedValue(config({ weeklyOffDays: '' })); // isolate from weekly-off
    mockedApi.getHolidays.mockResolvedValue([
      { id: 'h1', schoolId: 's1', date: `${CURRENT_MONTH}-01`, reason: 'Gandhi Jayanti', source: 'principal_emergency' },
    ]);
    render(<HistoryTab />);

    expect(await screen.findByText('Holiday — Gandhi Jayanti')).toBeInTheDocument();
  });

  test('a month before the config existed shows the empty state, not Absent/Weekly-off for every day', async () => {
    mockedApi.getAttendanceHistory.mockResolvedValue([]);
    mockedApi.getSchoolConfig.mockResolvedValue(config({ createdAt: `${CURRENT_MONTH}-01T00:00:00.000Z` }));
    render(<HistoryTab />);

    await userEvent.click(screen.getByRole('button', { name: /previous month/i }));

    expect(await screen.findByText(/no attendance recorded for this month/i)).toBeInTheDocument();
    expect(screen.queryByText('Absent')).not.toBeInTheDocument();
  });

  test('shows a summary line counting only categories that actually occurred', async () => {
    // Pinned to day 20 of the current month (real calendar month, fake
    // day-of-month) — this test's day-03 record, plus the gap-filled
    // Absent days it relies on, only render/count when "today" is genuinely
    // past day 3. Without this, the test silently broke on the 1st or 2nd
    // of any real calendar month it happened to run on.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(`${CURRENT_MONTH}-20T12:00:00.000Z`));

    mockedApi.getAttendanceHistory.mockResolvedValue([
      day({ date: `${CURRENT_MONTH}-01`, status: 'present' }),
      day({ date: `${CURRENT_MONTH}-02`, status: 'present', lateMinutes: 10 }),
      day({ date: `${CURRENT_MONTH}-03`, status: 'absent' }),
    ]);
    mockedApi.getSchoolConfig.mockResolvedValue(config({ weeklyOffDays: '' })); // isolate from weekly-off
    render(<HistoryTab />);

    const summary = await screen.findByText(/2 Present/);
    expect(summary).toHaveTextContent(/2 Present/);
    expect(summary).toHaveTextContent(/1 Late/);
    // Genuinely-absent days (no record, no off-label) fill the rest of the
    // month, so the summary's Absent count includes both the explicit one
    // and the filled-in ones — just confirm it's a real, non-zero count.
    expect(summary).toHaveTextContent(/\d+ Absent/);
    expect(summary).not.toHaveTextContent(/On leave|On duty|Half day/);

    vi.useRealTimers();
  });

  test('a real record still wins over what the day would otherwise be labelled', async () => {
    mockedApi.getAttendanceHistory.mockResolvedValue([day({ date: `${CURRENT_MONTH}-01` })]);
    mockedApi.getSchoolConfig.mockResolvedValue(config({ weeklyOffDays: '0,1,2,3,4,5,6' })); // every day "off"
    render(<HistoryTab />);

    // The 1st has a real record, so it shows Present, not "Weekly off".
    expect(await screen.findByText('Present')).toBeInTheDocument();
  });
});
