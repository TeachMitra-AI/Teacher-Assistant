import { expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AttendanceCorrectionForm from './AttendanceCorrectionForm';
import * as attendanceApi from '../../lib/teacherAttendanceApi';
import type { TeacherAttendanceDetailDto } from '../../types';

vi.mock('../../lib/teacherAttendanceApi', () => ({
  reviewAttendance: vi.fn(),
}));

const mockedApi = vi.mocked(attendanceApi);

function entry(overrides: Partial<TeacherAttendanceDetailDto> = {}): TeacherAttendanceDetailDto {
  return {
    id: 'att1',
    date: '2026-08-05',
    checkInAt: '2026-08-05T03:30:00.000Z',
    checkOutAt: '2026-08-05T10:30:00.000Z',
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

beforeEach(() => {
  vi.clearAllMocks();
});

test('defaults to Approve for an ordinary day, and Correct check-out time for a missing checkout — Approve is not offered there', async () => {
  const onResolved = vi.fn();
  render(<AttendanceCorrectionForm entry={entry({ status: 'pending_regularization', checkOutAt: null })} onResolved={onResolved} onCancel={vi.fn()} />);

  const select = screen.getByLabelText('Action') as HTMLSelectElement;
  expect(select.value).toBe('correct_checkout');
  expect(screen.queryByRole('option', { name: 'Approve' })).not.toBeInTheDocument();
});

test('submit is disabled until a reason is entered', async () => {
  render(<AttendanceCorrectionForm entry={entry()} onResolved={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();

  await userEvent.type(screen.getByLabelText('Reason (required)'), 'Confirmed with the teacher.');
  expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
});

test('marking on leave also requires a category before submit is enabled', async () => {
  render(<AttendanceCorrectionForm entry={entry()} onResolved={vi.fn()} onCancel={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText('Action'), 'mark_on_leave');
  await userEvent.type(screen.getByLabelText('Reason (required)'), 'Applied for leave.');
  expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();

  await userEvent.type(screen.getByLabelText('Leave / duty category'), 'Casual Leave');
  expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
});

test('submitting calls reviewAttendance with the chosen action and reason, then reports resolution', async () => {
  mockedApi.reviewAttendance.mockResolvedValue(entry({ status: 'present' }));
  const onResolved = vi.fn();
  render(<AttendanceCorrectionForm entry={entry()} onResolved={onResolved} onCancel={vi.fn()} />);

  await userEvent.type(screen.getByLabelText('Reason (required)'), 'Confirmed with the teacher.');
  await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

  await waitFor(() => expect(mockedApi.reviewAttendance).toHaveBeenCalledWith('att1', expect.objectContaining({
    action: 'approve',
    reason: 'Confirmed with the teacher.',
  })));
  await waitFor(() => expect(onResolved).toHaveBeenCalledWith('att1'));
});

test('a failed submission shows the error and does not report resolution', async () => {
  mockedApi.reviewAttendance.mockRejectedValue(new Error('boom'));
  const onResolved = vi.fn();
  render(<AttendanceCorrectionForm entry={entry()} onResolved={onResolved} onCancel={vi.fn()} />);

  await userEvent.type(screen.getByLabelText('Reason (required)'), 'Confirmed with the teacher.');
  await userEvent.click(screen.getByRole('button', { name: 'Submit' }));

  expect(await screen.findByText('Could not submit this correction.')).toBeInTheDocument();
  expect(onResolved).not.toHaveBeenCalled();
});

test('Cancel calls onCancel without submitting', async () => {
  const onCancel = vi.fn();
  render(<AttendanceCorrectionForm entry={entry()} onResolved={vi.fn()} onCancel={onCancel} />);
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalled();
  expect(mockedApi.reviewAttendance).not.toHaveBeenCalled();
});
