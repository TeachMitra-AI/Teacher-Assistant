// Finding #6: a load failure must offer a "Try again" action that re-runs
// the same load, clears the error, and shows the successful result.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportsPanel from './ReportsPanel';
import { ApiError } from '../../api';
import * as classroomApi from '../../lib/classroomApi';
import type { ClassFeeStatus } from '../../types';

vi.mock('../Toast', () => ({ useToast: () => ({ show: vi.fn() }) }));

vi.mock('../../lib/classroomApi', async (importOriginal) => {
  const actual = await importOriginal<typeof classroomApi>();
  return { ...actual, getFeeStatus: vi.fn(), downloadFeesReport: vi.fn() };
});

const mockedApi = vi.mocked(classroomApi);

function feeStatus(overrides: Partial<ClassFeeStatus> = {}): ClassFeeStatus {
  return {
    period: '2026-09', totalStudents: 10, paid: 6, partial: 2, pending: 2,
    feeAmount: 500, totalCollected: 3000, totalExpected: 5000, totalPending: 2000,
    perStudent: [],
    ...overrides,
  };
}

describe('ReportsPanel — load failure retry', () => {
  test('a load failure shows a "Try again" button; clicking it re-loads and clears the error on success', async () => {
    mockedApi.getFeeStatus.mockRejectedValueOnce(new ApiError('Could not load the fee report.', 500));
    render(<ReportsPanel classId="c1" className="7th Grade" />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load the fee report.');
    expect(mockedApi.getFeeStatus).toHaveBeenCalledTimes(1);

    mockedApi.getFeeStatus.mockResolvedValueOnce(feeStatus({ totalExpected: 9999 }));
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByText('₹9999')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mockedApi.getFeeStatus).toHaveBeenCalledTimes(2);
  });
});
