import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import { AdminSupportTicketScreen } from '../AdminSupportTicketScreen';
import { ApiError } from '../../../../api/client';

jest.mock('../../../../api/adminSupport', () => ({
  getSupportTicket: jest.fn(),
  updateSupportTicketStatus: jest.fn(),
  addSupportTicketNote: jest.fn(),
}));
const { getSupportTicket, updateSupportTicketStatus, addSupportTicketNote } = jest.requireMock('../../../../api/adminSupport') as {
  getSupportTicket: jest.Mock; updateSupportTicketStatus: jest.Mock; addSupportTicketNote: jest.Mock;
};

const TICKET = {
  id: 'ticket-abc12345', type: 'bug' as const, category: 'crash', description: 'App crashed on save',
  status: 'open' as const, createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-29T00:00:00Z',
  user: { id: 'u1', name: 'Jane Doe', email: 'jane@x.com', role: 'teacher' as const },
  school: { id: 's1', name: 'Rampur High', code: 'RAMPUR03' },
  context: { theme: 'dark', language: 'en' },
  notes: [],
};

function renderScreen() {
  return render(
    <ThemeProvider>
      <AdminSupportTicketScreen
        navigation={{} as never}
        route={{ key: 't', name: 'AdminSupportTicket', params: { id: 'ticket-abc12345' } } as never}
      />
    </ThemeProvider>
  );
}

describe('AdminSupportTicketScreen', () => {
  beforeEach(() => {
    getSupportTicket.mockReset();
    updateSupportTicketStatus.mockReset();
    addSupportTicketNote.mockReset();
  });

  it('shows the ticket description and known context after loading', async () => {
    getSupportTicket.mockResolvedValue(TICKET);
    await act(async () => { renderScreen(); });

    await waitFor(() => expect(screen.getByText('App crashed on save')).toBeTruthy());
    expect(screen.getByText('dark')).toBeTruthy();
    expect(getSupportTicket).toHaveBeenCalledWith('ticket-abc12345');
  });

  it('shows a friendly message for a missing ticket', async () => {
    getSupportTicket.mockRejectedValue(new ApiError('Not found', 404));
    await act(async () => { renderScreen(); });

    expect(await screen.findByText('This ticket no longer exists.')).toBeTruthy();
  });

  it('changes status when a status button is pressed', async () => {
    getSupportTicket.mockResolvedValue(TICKET);
    updateSupportTicketStatus.mockResolvedValue(undefined);
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByText('App crashed on save')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('ticket-status-resolved'));

    await waitFor(() => expect(updateSupportTicketStatus).toHaveBeenCalledWith('ticket-abc12345', 'resolved'));
    // Wait for the full chain to settle (setTicket, then setUpdatingStatus in
    // `finally`) before the test ends — otherwise those state updates land
    // after this test's act() scope closes and bleed a warning into
    // whichever test runs next. The 'resolved' button itself disappearing
    // (status buttons render every OTHER status) is proof the update applied.
    await waitFor(() => expect(screen.queryByTestId('ticket-status-resolved')).toBeNull());
  });

  it('adds a note and appends it to the thread', async () => {
    getSupportTicket.mockResolvedValue(TICKET);
    addSupportTicketNote.mockResolvedValue({ id: 'n1', body: 'Looking into it', createdAt: '2026-08-29T01:00:00Z', author: { id: 'a1', name: 'Admin', email: 'admin@x.com' } });
    await act(async () => { renderScreen(); });
    await waitFor(() => expect(screen.getByText('App crashed on save')).toBeTruthy());

    await fireEvent.changeText(screen.getByLabelText('Add a note'), 'Looking into it');
    await fireEvent.press(screen.getByTestId('ticket-add-note'));

    await waitFor(() => expect(addSupportTicketNote).toHaveBeenCalledWith('ticket-abc12345', 'Looking into it'));
    expect(await screen.findByText('Looking into it')).toBeTruthy();
  });
});
