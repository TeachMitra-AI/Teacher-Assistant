import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsTab from './SettingsTab';
import { ApiError } from '../../api';
import * as attendanceApi from '../../lib/teacherAttendanceApi';
import type { SchoolAttendanceConfigDto, SchoolHolidayDto } from '../../types';

const showToast = vi.fn();
vi.mock('../Toast', () => ({ useToast: () => ({ show: showToast }) }));

vi.mock('../../lib/teacherAttendanceApi', () => ({
  getSchoolConfig: vi.fn(),
  updateSchoolConfig: vi.fn(),
  getHolidays: vi.fn(),
  createHoliday: vi.fn(),
  updateHoliday: vi.fn(),
  deleteHoliday: vi.fn(),
}));

vi.mock('../../lib/geolocation', () => ({ requestCurrentPosition: vi.fn() }));

const mockedApi = vi.mocked(attendanceApi);

const CONFIG: SchoolAttendanceConfigDto = {
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
};

const HOLIDAY: SchoolHolidayDto = { id: 'h1', schoolId: 's1', date: '2026-10-02', reason: 'Gandhi Jayanti', source: 'principal_emergency' };

beforeEach(() => {
  vi.clearAllMocks();
  mockedApi.getHolidays.mockResolvedValue([]);
});

describe('SettingsTab', () => {
  test('no existing config shows the setup hint and defaults, not a blank form', async () => {
    mockedApi.getSchoolConfig.mockResolvedValue(null);
    render(<SettingsTab />);

    expect(await screen.findByText(/isn't set up for your school yet/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/school opens/i)).toHaveValue('09:00');
    expect(screen.getByLabelText(/check-in distance/i)).toHaveValue(180);
  });

  test('an existing config pre-fills the form with its real values', async () => {
    mockedApi.getSchoolConfig.mockResolvedValue(CONFIG);
    render(<SettingsTab />);

    expect(await screen.findByLabelText(/latitude/i)).toHaveValue(26.9);
    expect(screen.queryByText(/isn't set up for your school yet/i)).not.toBeInTheDocument();
  });

  test('the repeat-pattern threshold and window are editable, not just read from the database', async () => {
    mockedApi.getSchoolConfig.mockResolvedValue(CONFIG); // repeatPatternThreshold: 3, repeatPatternWindowDays: 30
    mockedApi.updateSchoolConfig.mockResolvedValue(CONFIG);
    render(<SettingsTab />);

    const thresholdInput = await screen.findByLabelText(/flag a repeated pattern after/i);
    expect(thresholdInput).toHaveValue(3);
    const windowInput = screen.getByLabelText(/repeat-pattern window/i);
    expect(windowInput).toHaveValue(30);

    await userEvent.clear(thresholdInput);
    await userEvent.type(thresholdInput, '5');
    await userEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() =>
      expect(mockedApi.updateSchoolConfig).toHaveBeenCalledWith(expect.objectContaining({ repeatPatternThreshold: 5 }))
    );
  });

  test('saving sends only the editable fields, not id/schoolId/createdAt back to the server', async () => {
    mockedApi.getSchoolConfig.mockResolvedValue(CONFIG);
    mockedApi.updateSchoolConfig.mockResolvedValue(CONFIG);
    render(<SettingsTab />);

    await screen.findByLabelText(/latitude/i);
    await userEvent.click(screen.getByRole('button', { name: /save settings/i }));

    // CONFIG (what GET returns) has id/schoolId/createdAt on it, same as the
    // real server response — PUT's schema is `.strict()` and rejects those,
    // so the form must never round-trip them back on Save.
    await waitFor(() =>
      expect(mockedApi.updateSchoolConfig).toHaveBeenCalledWith(
        expect.not.objectContaining({ id: expect.anything() })
      )
    );
    const sent = mockedApi.updateSchoolConfig.mock.calls[0][0];
    expect(sent).not.toHaveProperty('id');
    expect(sent).not.toHaveProperty('schoolId');
    expect(sent).not.toHaveProperty('createdAt');
    expect(sent.openTime).toBe(CONFIG.openTime);
    expect(showToast).toHaveBeenCalledWith('Attendance settings saved.', 'success');
  });

  test('a save failure shows the error banner', async () => {
    mockedApi.getSchoolConfig.mockResolvedValue(CONFIG);
    mockedApi.updateSchoolConfig.mockRejectedValue(new ApiError('Closing time must be after opening time.', 400));
    render(<SettingsTab />);

    await screen.findByLabelText(/latitude/i);
    await userEvent.click(screen.getByRole('button', { name: /save settings/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Closing time must be after opening time.');
  });

  test('"Use my location" fills the coordinate fields', async () => {
    mockedApi.getSchoolConfig.mockResolvedValue(null);
    const geolocation = await import('../../lib/geolocation');
    vi.mocked(geolocation.requestCurrentPosition).mockResolvedValue({
      coords: { latitude: 12.34, longitude: 56.78 },
    } as GeolocationPosition);

    render(<SettingsTab />);
    await userEvent.click(await screen.findByRole('button', { name: /use my location/i }));

    expect(await screen.findByLabelText(/latitude/i)).toHaveValue(12.34);
    expect(screen.getByLabelText(/longitude/i)).toHaveValue(56.78);
  });

  test('holidays: shows the empty state, then adding one appends it to the list', async () => {
    mockedApi.getSchoolConfig.mockResolvedValue(CONFIG);
    mockedApi.createHoliday.mockResolvedValue(HOLIDAY);
    render(<SettingsTab />);

    expect(await screen.findByText(/no holidays added yet/i)).toBeInTheDocument();

    const addButton = screen.getByRole('button', { name: /add holiday/i });
    expect(addButton).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/holiday date/i), '2026-10-02');
    await userEvent.type(screen.getByPlaceholderText(/reason/i), 'Gandhi Jayanti');
    expect(addButton).not.toBeDisabled();

    await userEvent.click(addButton);

    expect(await screen.findByText('Gandhi Jayanti')).toBeInTheDocument();
    expect(mockedApi.createHoliday).toHaveBeenCalledWith({ date: '2026-10-02', reason: 'Gandhi Jayanti' });
  });

  test('a duplicate-holiday failure shows its own error, separate from the settings error', async () => {
    mockedApi.getSchoolConfig.mockResolvedValue(CONFIG);
    mockedApi.createHoliday.mockRejectedValue(new ApiError('A holiday already exists for that date.', 409));
    render(<SettingsTab />);

    await userEvent.type(await screen.findByLabelText(/holiday date/i), '2026-10-02');
    await userEvent.type(screen.getByPlaceholderText(/reason/i), 'Duplicate');
    await userEvent.click(screen.getByRole('button', { name: /add holiday/i }));

    expect(await screen.findByText('A holiday already exists for that date.')).toBeInTheDocument();
  });

  test('editing a holiday fixes a typo and saves it', async () => {
    mockedApi.getSchoolConfig.mockResolvedValue(CONFIG);
    mockedApi.getHolidays.mockResolvedValue([HOLIDAY]);
    mockedApi.updateHoliday.mockResolvedValue({ ...HOLIDAY, reason: 'Gandhi Jayanti (fixed)' });
    render(<SettingsTab />);

    await userEvent.click(await screen.findByRole('button', { name: /edit gandhi jayanti/i }));
    const reasonInput = screen.getByLabelText(/edit holiday reason/i);
    await userEvent.clear(reasonInput);
    await userEvent.type(reasonInput, 'Gandhi Jayanti (fixed)');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(mockedApi.updateHoliday).toHaveBeenCalledWith('h1', { date: '2026-10-02', reason: 'Gandhi Jayanti (fixed)' })
    );
    expect(await screen.findByText('Gandhi Jayanti (fixed)')).toBeInTheDocument();
  });

  test('deleting a holiday asks for confirmation, then removes it from the list', async () => {
    mockedApi.getSchoolConfig.mockResolvedValue(CONFIG);
    mockedApi.getHolidays.mockResolvedValue([HOLIDAY]);
    mockedApi.deleteHoliday.mockResolvedValue(undefined);
    render(<SettingsTab />);

    await userEvent.click(await screen.findByRole('button', { name: /delete gandhi jayanti/i }));
    expect(screen.getByText(/delete this holiday/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(mockedApi.deleteHoliday).toHaveBeenCalledWith('h1'));
    expect(screen.queryByText('Gandhi Jayanti')).not.toBeInTheDocument();
  });

  test('canceling the delete confirmation keeps the holiday', async () => {
    mockedApi.getSchoolConfig.mockResolvedValue(CONFIG);
    mockedApi.getHolidays.mockResolvedValue([HOLIDAY]);
    render(<SettingsTab />);

    await userEvent.click(await screen.findByRole('button', { name: /delete gandhi jayanti/i }));
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(mockedApi.deleteHoliday).not.toHaveBeenCalled();
    expect(screen.getByText('Gandhi Jayanti')).toBeInTheDocument();
  });
});

describe('SettingsTab — weekly off days', () => {
  test('defaults to Sunday checked, no other day', async () => {
    mockedApi.getSchoolConfig.mockResolvedValue(null);
    render(<SettingsTab />);

    await screen.findByText(/isn't set up for your school yet/i);
    expect(screen.getByRole('checkbox', { name: 'Sun' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Mon' })).not.toBeChecked();
  });

  test('toggling a day updates the value sent on save', async () => {
    mockedApi.getSchoolConfig.mockResolvedValue(CONFIG);
    mockedApi.updateSchoolConfig.mockResolvedValue(CONFIG);
    render(<SettingsTab />);

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sat' }));
    await userEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() =>
      expect(mockedApi.updateSchoolConfig).toHaveBeenCalledWith(expect.objectContaining({ weeklyOffDays: '0,6' }))
    );
  });

  test('unchecking the only selected day sends an empty string, not an error', async () => {
    mockedApi.getSchoolConfig.mockResolvedValue(CONFIG); // weeklyOffDays: '0'
    mockedApi.updateSchoolConfig.mockResolvedValue(CONFIG);
    render(<SettingsTab />);

    await userEvent.click(await screen.findByRole('checkbox', { name: 'Sun' }));
    await userEvent.click(screen.getByRole('button', { name: /save settings/i }));

    await waitFor(() =>
      expect(mockedApi.updateSchoolConfig).toHaveBeenCalledWith(expect.objectContaining({ weeklyOffDays: '' }))
    );
  });
});
