// AttendancePage — the tab-switching shell only. CheckInTab/HistoryTab/
// ActivityLogTab are stubbed out here (they have their own test files);
// this file only checks that the right tab renders for the URL + role,
// mirrors how ClassroomPage's own tab-via-query-param pattern works (no
// ClassroomPage.test.tsx precedent exists yet, so this follows
// ResourceWorkspace.test.tsx's MemoryRouter shape instead).
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AttendancePage from './AttendancePage';

vi.mock('../components/TopBar', () => ({ default: () => null }));
vi.mock('../components/attendance/CheckInTab', () => ({ default: () => <div>Check-in tab content</div> }));
vi.mock('../components/attendance/HistoryTab', () => ({ default: () => <div>History tab content</div> }));
vi.mock('../components/attendance/ActivityLogTab', () => ({ default: () => <div>Activity Log tab content</div> }));
vi.mock('../components/attendance/ReportsTab', () => ({ default: () => <div>Reports tab content</div> }));
vi.mock('../components/attendance/SettingsTab', () => ({ default: () => <div>Settings tab content</div> }));

let mockRole: 'teacher' | 'school_admin' = 'teacher';
vi.mock('../auth', () => ({ useAuth: () => ({ user: { role: mockRole } }) }));

function renderPage(initialPath = '/attendance') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/attendance" element={<AttendancePage preferences={{} as never} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AttendancePage', () => {
  test('defaults to the Check In tab with no ?tab= param', () => {
    mockRole = 'teacher';
    renderPage('/attendance');
    expect(screen.getByText('Check-in tab content')).toBeInTheDocument();
    expect(screen.queryByText('History tab content')).not.toBeInTheDocument();
  });

  test('?tab=history renders the History tab directly', () => {
    mockRole = 'teacher';
    renderPage('/attendance?tab=history');
    expect(screen.getByText('History tab content')).toBeInTheDocument();
    expect(screen.queryByText('Check-in tab content')).not.toBeInTheDocument();
  });

  test('an unrecognized ?tab= value falls back to Check In, not a blank page', () => {
    mockRole = 'teacher';
    renderPage('/attendance?tab=not-a-real-tab');
    expect(screen.getByText('Check-in tab content')).toBeInTheDocument();
  });

  test('clicking the History tab switches the content', async () => {
    mockRole = 'teacher';
    renderPage('/attendance');
    await userEvent.click(screen.getByRole('button', { name: /history/i }));

    expect(await screen.findByText('History tab content')).toBeInTheDocument();
    expect(screen.queryByText('Check-in tab content')).not.toBeInTheDocument();
  });

  test('a plain teacher never sees the Activity Log tab, even via a direct ?tab=activity link', () => {
    mockRole = 'teacher';
    renderPage('/attendance?tab=activity');

    expect(screen.queryByRole('button', { name: /activity log/i })).not.toBeInTheDocument();
    expect(screen.getByText('Check-in tab content')).toBeInTheDocument();
    expect(screen.queryByText('Activity Log tab content')).not.toBeInTheDocument();
  });

  test('a school_admin sees the Activity Log tab and can open it', async () => {
    mockRole = 'school_admin';
    renderPage('/attendance');

    expect(screen.getByRole('button', { name: /activity log/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /activity log/i }));
    expect(await screen.findByText('Activity Log tab content')).toBeInTheDocument();
  });

  test('a school_admin can reach Activity Log directly via ?tab=activity', () => {
    mockRole = 'school_admin';
    renderPage('/attendance?tab=activity');
    expect(screen.getByText('Activity Log tab content')).toBeInTheDocument();
  });

  test('a plain teacher never sees the Settings tab, even via a direct ?tab=settings link', () => {
    mockRole = 'teacher';
    renderPage('/attendance?tab=settings');

    expect(screen.queryByRole('button', { name: /^settings$/i })).not.toBeInTheDocument();
    expect(screen.getByText('Check-in tab content')).toBeInTheDocument();
    expect(screen.queryByText('Settings tab content')).not.toBeInTheDocument();
  });

  test('a school_admin sees and can open the Settings tab', async () => {
    mockRole = 'school_admin';
    renderPage('/attendance');

    await userEvent.click(screen.getByRole('button', { name: /^settings$/i }));
    expect(await screen.findByText('Settings tab content')).toBeInTheDocument();
  });

  test('a plain teacher never sees the Reports tab, even via a direct ?tab=reports link', () => {
    mockRole = 'teacher';
    renderPage('/attendance?tab=reports');

    expect(screen.queryByRole('button', { name: /^reports$/i })).not.toBeInTheDocument();
    expect(screen.getByText('Check-in tab content')).toBeInTheDocument();
    expect(screen.queryByText('Reports tab content')).not.toBeInTheDocument();
  });

  test('a school_admin sees and can open the Reports tab', async () => {
    mockRole = 'school_admin';
    renderPage('/attendance');

    await userEvent.click(screen.getByRole('button', { name: /^reports$/i }));
    expect(await screen.findByText('Reports tab content')).toBeInTheDocument();
  });
});
