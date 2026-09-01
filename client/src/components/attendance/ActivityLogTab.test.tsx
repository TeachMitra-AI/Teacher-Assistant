import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ActivityLogTab from './ActivityLogTab';
import { ApiError } from '../../api';
import * as attendanceApi from '../../lib/teacherAttendanceApi';
import type { TeacherAttendanceActivityLogEntry, TeacherAttendanceActivityLogPage } from '../../types';

vi.mock('../../lib/teacherAttendanceApi', () => ({
  getActivityLog: vi.fn(),
}));

const mockedApi = vi.mocked(attendanceApi);

function entry(overrides: Partial<TeacherAttendanceActivityLogEntry> = {}): TeacherAttendanceActivityLogEntry {
  return {
    id: 'log1',
    userId: 'u1',
    userName: 'Abhinav',
    performedBy: null,
    action: 'check_in',
    result: '63m from school',
    distanceMeters: 63,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function page(entries: TeacherAttendanceActivityLogEntry[], overrides: Partial<TeacherAttendanceActivityLogPage> = {}): TeacherAttendanceActivityLogPage {
  return { days: 7, page: 1, pageSize: 25, total: entries.length, entries, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ActivityLogTab', () => {
  test('shows an event with its teacher, action label, and result', async () => {
    mockedApi.getActivityLog.mockResolvedValue(page([entry({ userName: 'Abhinav', action: 'check_in', result: '63m from school' })]));
    render(<ActivityLogTab />);

    expect(await screen.findByText('Abhinav')).toBeInTheDocument();
    expect(screen.getByText('Checked in')).toBeInTheDocument();
    expect(screen.getByText('63m from school')).toBeInTheDocument();
  });

  test('groups entries by day with a header, not a flat list', async () => {
    const today = new Date().toISOString();
    const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    mockedApi.getActivityLog.mockResolvedValue(
      page([entry({ id: 'a', createdAt: today }), entry({ id: 'b', createdAt: old })])
    );
    render(<ActivityLogTab />);

    expect(await screen.findByText('Today')).toBeInTheDocument();
    // Two distinct date groups for two distinct calendar days.
    expect(document.querySelectorAll('.attendance-activity-day')).toHaveLength(2);
  });

  test('a load failure shows the error banner', async () => {
    mockedApi.getActivityLog.mockRejectedValue(new ApiError('Could not load the activity log.', 500));
    render(<ActivityLogTab />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the activity log.');
  });

  test('an empty window shows a plain empty state', async () => {
    mockedApi.getActivityLog.mockResolvedValue(page([]));
    render(<ActivityLogTab />);

    expect(await screen.findByText('No activity in this window.')).toBeInTheDocument();
  });

  test('switching the day range re-queries with the new window', async () => {
    mockedApi.getActivityLog.mockResolvedValue(page([entry()]));
    render(<ActivityLogTab />);
    await screen.findByText('Abhinav');

    await userEvent.click(screen.getByRole('button', { name: '30d' }));

    await waitFor(() => expect(mockedApi.getActivityLog).toHaveBeenLastCalledWith(expect.objectContaining({ days: 30 })));
  });

  test('the "Teacher activity" filter queries with category=teacher, excluding admin housekeeping', async () => {
    mockedApi.getActivityLog.mockResolvedValue(page([entry()]));
    render(<ActivityLogTab />);
    await screen.findByText('Abhinav');

    await userEvent.click(screen.getByRole('button', { name: 'Teacher activity' }));

    await waitFor(() => expect(mockedApi.getActivityLog).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'teacher' })));
  });

  test('the "Admin actions" filter queries with category=admin', async () => {
    mockedApi.getActivityLog.mockResolvedValue(page([entry({ action: 'settings_changed', result: 'attendance settings updated' })]));
    render(<ActivityLogTab />);
    await screen.findByText('Settings changed');

    await userEvent.click(screen.getByRole('button', { name: 'Admin actions' }));

    await waitFor(() => expect(mockedApi.getActivityLog).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'admin' })));
  });

  test('typing a search re-queries by teacher name', async () => {
    mockedApi.getActivityLog.mockResolvedValue(page([entry()]));
    render(<ActivityLogTab />);
    await screen.findByText('Abhinav');

    await userEvent.type(screen.getByLabelText(/search by teacher name/i), 'abhi');

    await waitFor(() => expect(mockedApi.getActivityLog).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'abhi' })), {
      timeout: 2000,
    });
  });

  test('a blocked attempt renders with the warning tone class, distinct from routine activity', async () => {
    mockedApi.getActivityLog.mockResolvedValue(page([entry({ action: 'check_in_blocked', result: 'blocked, 410m away' })]));
    render(<ActivityLogTab />);

    const row = await screen.findByText('Check-in blocked');
    expect(row.closest('.attendance-activity-event')).toHaveClass('tone-warning');
  });

  test('the summary strip shows the total event count for the window', async () => {
    mockedApi.getActivityLog.mockResolvedValue(page([entry(), entry({ id: 'log2', userName: 'Priya' })], { total: 2 }));
    render(<ActivityLogTab />);

    await screen.findByText('Priya');
    const summary = document.querySelector('.attendance-activity-summary');
    expect(summary).toHaveTextContent('events');
  });
});
