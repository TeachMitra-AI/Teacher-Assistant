import { describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DemoBookingWidget } from './DemoBookingWidget';
import * as scheduleDemoApi from '../lib/scheduleDemo';
import type { DemoBooking, DemoBookingConfig } from '../lib/scheduleDemo';

vi.mock('../lib/scheduleDemo', async () => {
  const actual = await vi.importActual<typeof import('../lib/scheduleDemo')>('../lib/scheduleDemo');
  return {
    ...actual,
    getDemoBookingConfig: vi.fn(),
    getDemoBookingSlots: vi.fn(),
    createDemoBooking: vi.fn(),
  };
});

const mockedApi = vi.mocked(scheduleDemoApi);

const CONFIG: DemoBookingConfig = {
  timezone: 'Asia/Kolkata',
  workDays: [1, 2, 3, 4, 5, 6, 7], // every day bookable, so the test never depends on which day it runs
  startTime: '10:00',
  endTime: '17:00',
  slotMinutes: 30,
  lookaheadDays: 21,
};

function booking(overrides: Partial<DemoBooking> = {}): DemoBooking {
  return {
    id: 'booking-1',
    name: 'Asha Verma',
    organization: 'Green Valley School',
    role: 'school_admin',
    date: '2026-10-05',
    startTime: '10:00',
    dateLabel: 'Monday, 5 October 2026',
    timeLabel: '10:00 AM IST',
    durationMinutes: 30,
    status: 'confirmed',
    ...overrides,
  };
}

describe('DemoBookingWidget', () => {
  test('walks through date, time, details, confirm, and shows the success screen', async () => {
    mockedApi.getDemoBookingConfig.mockResolvedValue(CONFIG);
    mockedApi.getDemoBookingSlots.mockResolvedValue(['10:00', '10:30', '11:00']);
    mockedApi.createDemoBooking.mockResolvedValue({
      booking: booking(),
      manageUrl: 'https://www.sarastech.co.in/schedule-demo/manage?id=booking-1&token=abc',
    });

    const user = userEvent.setup();
    render(<DemoBookingWidget />);

    // Step 1: pick a date.
    const dateGroup = await screen.findByRole('group', { name: /choose a date/i });
    const [firstDateChip] = within(dateGroup).getAllByRole('button');
    await user.click(firstDateChip);

    // Step 2: pick a time.
    const timeChip = await screen.findByRole('button', { name: /10:00 AM/ });
    await user.click(timeChip);

    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 3: fill in details.
    await user.type(await screen.findByLabelText(/full name/i), 'Asha Verma');
    await user.type(screen.getByLabelText(/work email/i), 'asha@example.com');
    await user.type(screen.getByLabelText(/school \/ organization/i), 'Green Valley School');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 4: confirm.
    expect(await screen.findByText(/review & confirm/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirm booking/i }));

    // Step 5: success.
    expect(await screen.findByText(/you.re booked/i)).toBeInTheDocument();
    expect(screen.getByText(/monday, 5 october 2026/i)).toBeInTheDocument();
    expect(mockedApi.createDemoBooking).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Asha Verma', email: 'asha@example.com', organization: 'Green Valley School' })
    );
  });

  test('shows a friendly message when availability fails to load', async () => {
    mockedApi.getDemoBookingConfig.mockRejectedValue(new Error('network error'));
    render(<DemoBookingWidget />);
    await waitFor(() => {
      expect(screen.getByText(/not available right now/i)).toBeInTheDocument();
    });
  });
});
