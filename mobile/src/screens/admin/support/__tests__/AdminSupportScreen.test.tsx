import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../../theme/ThemeContext';
import { AdminSupportScreen } from '../AdminSupportScreen';

jest.mock('../../../../api/adminSupport', () => ({
  listSupportTickets: jest.fn(),
  getSupportTicketStats: jest.fn(),
}));
jest.mock('../../../../api/admin', () => ({
  listAdminSchools: jest.fn(),
}));
const { listSupportTickets, getSupportTicketStats } = jest.requireMock('../../../../api/adminSupport') as {
  listSupportTickets: jest.Mock; getSupportTicketStats: jest.Mock;
};
const { listAdminSchools } = jest.requireMock('../../../../api/admin') as { listAdminSchools: jest.Mock };

const TICKET = {
  id: 'ticket-abc12345', type: 'bug' as const, category: 'crash', description: 'App crashed on save',
  status: 'open' as const, createdAt: '2026-08-29T00:00:00Z', updatedAt: '2026-08-29T00:00:00Z',
  user: { id: 'u1', name: 'Jane Doe', email: 'jane@x.com', role: 'teacher' as const },
  school: { id: 's1', name: 'Rampur High', code: 'RAMPUR03' },
};

function renderScreen(navigation = { navigate: jest.fn() }) {
  render(
    <SafeAreaProvider>
      <ThemeProvider>
        <AdminSupportScreen navigation={navigation as never} />
      </ThemeProvider>
    </SafeAreaProvider>
  );
  return navigation;
}

describe('AdminSupportScreen', () => {
  beforeEach(() => {
    listSupportTickets.mockReset();
    getSupportTicketStats.mockReset();
    listAdminSchools.mockReset();
    listAdminSchools.mockResolvedValue({ items: [], total: 0, page: 1, limit: 100 });
  });

  it('shows the KPI strip and the ticket list', async () => {
    getSupportTicketStats.mockResolvedValue({ open: 3, today: 1, bugs: 2, feedback: 1 });
    listSupportTickets.mockResolvedValue({ items: [TICKET], total: 1, page: 1, limit: 25 });
    await act(async () => { renderScreen(); });

    await waitFor(() => expect(screen.getByText('App crashed on save')).toBeTruthy());
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('2 : 1')).toBeTruthy();
  });

  it('navigates to the ticket detail screen on tap', async () => {
    getSupportTicketStats.mockResolvedValue({ open: 0, today: 0, bugs: 0, feedback: 0 });
    listSupportTickets.mockResolvedValue({ items: [TICKET], total: 1, page: 1, limit: 25 });
    const navigation = { navigate: jest.fn() };
    await act(async () => { renderScreen(navigation); });

    await waitFor(() => expect(screen.getByTestId('support-ticket-ticket-abc12345')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('support-ticket-ticket-abc12345'));

    expect(navigation.navigate).toHaveBeenCalledWith('AdminSupportTicket', { id: 'ticket-abc12345' });
  });

  it('shows an empty state when there are no tickets', async () => {
    getSupportTicketStats.mockResolvedValue({ open: 0, today: 0, bugs: 0, feedback: 0 });
    listSupportTickets.mockResolvedValue({ items: [], total: 0, page: 1, limit: 25 });
    await act(async () => { renderScreen(); });

    // usePagedList's filterKey is a pipe-joined string of all six filters
    // (mirrors AdminSupportPage.tsx's own usePagedList call exactly), which
    // is never the empty string — so isFiltering is always true here, and
    // "No tickets yet." (the zero-filters copy) is unreachable by design,
    // same as on web.
    expect(await screen.findByText('No tickets match your search or filters.')).toBeTruthy();
  });
});
