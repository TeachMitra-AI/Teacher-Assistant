import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportsTab from './ReportsTab';
import { ApiError } from '../../api';
import * as attendanceApi from '../../lib/teacherAttendanceApi';
import { currentMonthString } from '../../lib/classroomDate';
import type {
  SchoolHistoryPage,
  SchoolHistoryTeacherSummary,
  SchoolAttendanceConfigDto,
  TeacherAttendanceDetailPage,
  TeacherAttendanceDetailDto,
  TeacherAttendanceSummary,
} from '../../types';

vi.mock('../../lib/teacherAttendanceApi', () => ({
  getSchoolHistory: vi.fn(),
  getTeacherAttendanceDetail: vi.fn(),
  getSchoolConfig: vi.fn(),
  getHolidays: vi.fn(),
  getTodaySummary: vi.fn(),
  downloadSchoolAttendanceReport: vi.fn(),
}));

// AttendanceCorrectionForm has its own detailed test file — stubbed here so
// this file only exercises whether ReportsTab hands it the right entry and
// reacts to onResolved/onCancel, not the form's own internals.
vi.mock('./AttendanceCorrectionForm', () => ({
  default: ({ entry, onResolved, onCancel }: { entry: { id: string }; onResolved: (id: string) => void; onCancel: () => void }) => (
    <div>
      <span>Correction form for {entry.id}</span>
      <button type="button" onClick={() => onResolved(entry.id)}>Resolve {entry.id}</button>
      <button type="button" onClick={onCancel}>Cancel {entry.id}</button>
    </div>
  ),
}));

const mockedApi = vi.mocked(attendanceApi);
const CURRENT_MONTH = currentMonthString();

function summary(overrides: Partial<TeacherAttendanceSummary> = {}): TeacherAttendanceSummary {
  return {
    present: 0,
    absent: 0,
    late: 0,
    half_day: 0,
    on_leave: 0,
    on_duty: 0,
    flagged_review: 0,
    pending_regularization: 0,
    ...overrides,
  };
}

function teacherSummary(overrides: Partial<SchoolHistoryTeacherSummary> = {}): SchoolHistoryTeacherSummary {
  return {
    id: 't1',
    name: 'Rahul Sharma',
    email: 'rahul@example.com',
    summary: summary(),
    ...overrides,
  };
}

function listPage(teachers: SchoolHistoryTeacherSummary[], overrides: Partial<SchoolHistoryPage> = {}): SchoolHistoryPage {
  return { month: CURRENT_MONTH, page: 1, pageSize: 25, total: teachers.length, teachers, ...overrides };
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
    createdAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function detailRecord(overrides: Partial<TeacherAttendanceDetailDto> = {}): TeacherAttendanceDetailDto {
  return {
    id: 'att1',
    date: `${CURRENT_MONTH}-01`,
    checkInAt: `${CURRENT_MONTH}-01T03:30:00.000Z`,
    checkOutAt: `${CURRENT_MONTH}-01T10:30:00.000Z`,
    status: 'present',
    lateMinutes: 0,
    earlyDepartureMinutes: null,
    workingMinutes: 420,
    shortfallMinutes: null,
    leaveOrDutyCategory: null,
    leaveOrDutyReason: null,
    reviewReason: null,
    checkInLat: 26.9,
    checkInLon: 80.9,
    checkInAccuracyMeters: 10,
    checkInDistanceMeters: 63,
    checkInDeviceId: 'device1',
    checkOutLat: 26.9,
    checkOutLon: 80.9,
    checkOutAccuracyMeters: 10,
    checkOutDistanceMeters: 58,
    checkOutDeviceId: 'device1',
    ...overrides,
  };
}

function detailPage(
  teacher: { id: string; name: string; email: string; createdAt?: string },
  records: TeacherAttendanceDetailDto[]
): TeacherAttendanceDetailPage {
  return {
    month: CURRENT_MONTH,
    teacher: { createdAt: '2020-01-01T00:00:00.000Z', ...teacher },
    records,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.getSchoolConfig.mockResolvedValue(config());
  mockedApi.getHolidays.mockResolvedValue([]);
  mockedApi.getTodaySummary.mockResolvedValue({
    date: CURRENT_MONTH + '-01',
    nonWorkingDay: null,
    present: 0,
    late: 0,
    missingCheckout: 0,
    absent: 0,
  });
});

describe('ReportsTab', () => {
  test('shows one row per teacher, with their present/absent counts', async () => {
    mockedApi.getSchoolHistory.mockResolvedValue(
      listPage([
        teacherSummary({ id: 't1', name: 'Rahul Sharma' }),
        teacherSummary({ id: 't2', name: 'Priya Nair' }),
      ])
    );
    render(<ReportsTab />);

    expect(await screen.findByText('Rahul Sharma')).toBeInTheDocument();
    expect(screen.getByText('Priya Nair')).toBeInTheDocument();
  });

  test('two teachers sharing a display name are told apart by their email', async () => {
    mockedApi.getSchoolHistory.mockResolvedValue(
      listPage([
        teacherSummary({ id: 't1', name: 'Demo Teacher', email: 'old-legacy@invalid.local' }),
        teacherSummary({ id: 't2', name: 'Demo Teacher', email: 'teacher@example.com' }),
      ])
    );
    render(<ReportsTab />);

    expect(await screen.findByText('old-legacy@invalid.local')).toBeInTheDocument();
    expect(screen.getByText('teacher@example.com')).toBeInTheDocument();
  });

  test('a load failure shows the error banner', async () => {
    mockedApi.getSchoolHistory.mockRejectedValue(new ApiError('Could not load the school report.', 500));
    render(<ReportsTab />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the school report.');
  });

  test('typing a search re-queries the server with the search text', async () => {
    mockedApi.getSchoolHistory.mockResolvedValue(listPage([teacherSummary({ id: 't1', name: 'Rahul Sharma' })]));
    render(<ReportsTab />);
    await screen.findByText('Rahul Sharma');

    mockedApi.getSchoolHistory.mockResolvedValue(listPage([teacherSummary({ id: 't2', name: 'Priya Nair' })]));
    await userEvent.type(screen.getByLabelText(/search by teacher name/i), 'priya');

    await waitFor(
      () => expect(mockedApi.getSchoolHistory).toHaveBeenCalledWith(CURRENT_MONTH, expect.objectContaining({ search: 'priya' })),
      { timeout: 2000 }
    );
    expect(await screen.findByText('Priya Nair')).toBeInTheDocument();
  });

  test('"Only teachers needing a look" hides a teacher with nothing flagged', async () => {
    mockedApi.getSchoolHistory.mockResolvedValue(
      listPage([teacherSummary({ id: 't1', name: 'Rahul Sharma', summary: summary() })])
    );
    render(<ReportsTab />);
    await screen.findByText('Rahul Sharma');

    await userEvent.click(screen.getByRole('button', { name: /needs a look/i }));

    expect(screen.queryByText('Rahul Sharma')).not.toBeInTheDocument();
    expect(screen.getByText('No teachers need a look right now.')).toBeInTheDocument();
  });

  test('clicking a teacher row replaces the table with their day-by-day detail view, with a way back', async () => {
    mockedApi.getSchoolHistory.mockResolvedValue(listPage([teacherSummary({ id: 't1', name: 'Rahul Sharma' })]));
    mockedApi.getTeacherAttendanceDetail.mockResolvedValue(
      detailPage({ id: 't1', name: 'Rahul Sharma', email: 'rahul@example.com' }, [detailRecord()])
    );
    render(<ReportsTab />);
    await screen.findByText('Rahul Sharma');

    // Collapsed: no per-day detail list rendered at all yet.
    expect(document.querySelector('.attendance-history-list')).not.toBeInTheDocument();

    await userEvent.click(screen.getByText('Rahul Sharma'));

    expect(mockedApi.getTeacherAttendanceDetail).toHaveBeenCalledWith('t1', CURRENT_MONTH);
    const list = await screen.findByRole('list');
    expect(document.querySelector('.attendance-history-list')).toBe(list);
    expect(within(list).getByText('Present')).toBeInTheDocument(); // the checked-in-and-out day's detail line

    // The table itself is gone while in detail view, not just covered up.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /back to all teachers/i }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(document.querySelector('.attendance-history-list')).not.toBeInTheDocument();
  });

  test('a day with a real record has a "Correct" action that opens the correction form on demand', async () => {
    mockedApi.getSchoolHistory.mockResolvedValue(listPage([teacherSummary({ id: 't1', name: 'Rahul Sharma' })]));
    mockedApi.getTeacherAttendanceDetail.mockResolvedValue(
      detailPage({ id: 't1', name: 'Rahul Sharma', email: 'rahul@example.com' }, [detailRecord({ id: 'att1' })])
    );
    render(<ReportsTab />);
    await screen.findByText('Rahul Sharma');
    await userEvent.click(screen.getByText('Rahul Sharma'));
    await screen.findByRole('list');

    // Not shown until asked for — this isn't a queue that forces an action.
    expect(screen.queryByText('Correction form for att1')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /correct/i }));
    expect(await screen.findByText('Correction form for att1')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel att1' }));
    expect(screen.queryByText('Correction form for att1')).not.toBeInTheDocument();
  });

  test('resolving a correction reloads both the detail view and the teacher list', async () => {
    mockedApi.getSchoolHistory.mockResolvedValue(listPage([teacherSummary({ id: 't1', name: 'Rahul Sharma' })]));
    mockedApi.getTeacherAttendanceDetail.mockResolvedValue(
      detailPage({ id: 't1', name: 'Rahul Sharma', email: 'rahul@example.com' }, [detailRecord({ id: 'att1' })])
    );
    render(<ReportsTab />);
    await screen.findByText('Rahul Sharma');
    await userEvent.click(screen.getByText('Rahul Sharma'));
    await screen.findByRole('list');
    await userEvent.click(screen.getByRole('button', { name: /correct/i }));
    await screen.findByText('Correction form for att1');

    await userEvent.click(screen.getByRole('button', { name: 'Resolve att1' }));

    await waitFor(() => expect(mockedApi.getSchoolHistory).toHaveBeenCalledTimes(2)); // initial + reload
    // getTeacherAttendanceDetail is also called once per trend month
    // (6x) on open and again on resolve — filter down to just the calls
    // for the current month (the actual detail view) rather than a raw
    // total, which the trend fetch would otherwise make brittle.
    await waitFor(() => {
      const detailCalls = mockedApi.getTeacherAttendanceDetail.mock.calls.filter(([, m]) => m === CURRENT_MONTH);
      expect(detailCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  test('pagination shows the right range and Next fetches the next page', async () => {
    mockedApi.getSchoolHistory.mockResolvedValue(
      listPage([teacherSummary({ id: 't1', name: 'Rahul Sharma' })], { total: 30, page: 1, pageSize: 25 })
    );
    render(<ReportsTab />);
    await screen.findByText('Rahul Sharma');

    expect(screen.getByText(/showing 1.*25.*of 30/i)).toBeInTheDocument();

    mockedApi.getSchoolHistory.mockResolvedValue(
      listPage([teacherSummary({ id: 't2', name: 'Priya Nair' })], { total: 30, page: 2, pageSize: 25 })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() =>
      expect(mockedApi.getSchoolHistory).toHaveBeenLastCalledWith(CURRENT_MONTH, expect.objectContaining({ page: 2 }))
    );
    expect(await screen.findByText('Priya Nair')).toBeInTheDocument();
  });

  test('Download Excel calls the download helper for the current month', async () => {
    mockedApi.getSchoolHistory.mockResolvedValue(listPage([teacherSummary()]));
    mockedApi.downloadSchoolAttendanceReport.mockResolvedValue(undefined);
    render(<ReportsTab />);
    await screen.findByText('Rahul Sharma');

    await userEvent.click(screen.getByRole('button', { name: /download excel/i }));

    await waitFor(() => expect(mockedApi.downloadSchoolAttendanceReport).toHaveBeenCalledWith(CURRENT_MONTH));
  });

  test('a download failure shows its own error', async () => {
    mockedApi.getSchoolHistory.mockResolvedValue(listPage([teacherSummary()]));
    mockedApi.downloadSchoolAttendanceReport.mockRejectedValue(new ApiError('Could not download the report.', 500));
    render(<ReportsTab />);
    await screen.findByText('Rahul Sharma');

    await userEvent.click(screen.getByRole('button', { name: /download excel/i }));

    expect(await screen.findByText('Could not download the report.')).toBeInTheDocument();
  });
});
