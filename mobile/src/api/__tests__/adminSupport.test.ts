import {
  listSupportTickets, getSupportTicketStats, getSupportTicket, updateSupportTicketStatus, addSupportTicketNote,
} from '../adminSupport';

jest.mock('../client', () => ({ api: jest.fn() }));
const { api } = jest.requireMock('../client') as { api: jest.Mock };

describe('adminSupport api', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('listSupportTickets builds a query string, omitting empty filters and page=1', async () => {
    api.mockResolvedValueOnce({ tickets: [], total: 0, page: 1, limit: 25 });
    await listSupportTickets({ page: 1, status: 'open', type: '', schoolId: 's1' });
    expect(api).toHaveBeenCalledWith('/admin/support/tickets?status=open&schoolId=s1');
  });

  it('listSupportTickets falls back to tickets.length when the server omits total/page/limit', async () => {
    api.mockResolvedValueOnce({ tickets: [{ id: 't1' }] });
    const result = await listSupportTickets({ page: 3 });
    expect(result).toEqual({ items: [{ id: 't1' }], total: 1, page: 3, limit: 1 });
  });

  it('getSupportTicketStats calls the stats endpoint', async () => {
    const stats = { open: 2, today: 1, bugs: 1, feedback: 1 };
    api.mockResolvedValueOnce(stats);
    const result = await getSupportTicketStats();
    expect(api).toHaveBeenCalledWith('/admin/support/tickets/stats');
    expect(result).toBe(stats);
  });

  it('getSupportTicket unwraps the ticket', async () => {
    const ticket = { id: 't1', notes: [] };
    api.mockResolvedValueOnce({ ticket });
    const result = await getSupportTicket('t1');
    expect(api).toHaveBeenCalledWith('/admin/support/tickets/t1');
    expect(result).toBe(ticket);
  });

  it('updateSupportTicketStatus PATCHes the new status', async () => {
    api.mockResolvedValueOnce(undefined);
    await updateSupportTicketStatus('t1', 'resolved');
    expect(api).toHaveBeenCalledWith('/admin/support/tickets/t1/status', { method: 'PATCH', body: { status: 'resolved' } });
  });

  it('addSupportTicketNote posts the note body and unwraps the note', async () => {
    const note = { id: 'n1', body: 'Looking into it', createdAt: '2026-08-29T00:00:00Z', author: { id: 'a1', name: 'Admin', email: 'a@x.com' } };
    api.mockResolvedValueOnce({ note });
    const result = await addSupportTicketNote('t1', 'Looking into it');
    expect(api).toHaveBeenCalledWith('/admin/support/tickets/t1/notes', { method: 'POST', body: { body: 'Looking into it' } });
    expect(result).toBe(note);
  });
});
