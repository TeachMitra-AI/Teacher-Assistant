// Logic for AdminSupportTicketScreen — native port of
// AdminSupportTicketPage.tsx's state (fetch, status change, add note).
import { useCallback, useEffect, useState } from 'react';
import { getSupportTicket, updateSupportTicketStatus, addSupportTicketNote } from '../../../api/adminSupport';
import { ApiError } from '../../../api/client';
import type { SupportTicketDetail, SupportTicketStatus } from '../../../types';

export function useAdminSupportTicketScreen(id: string) {
  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [submittingNote, setSubmittingNote] = useState(false);
  const [noteError, setNoteError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const t = await getSupportTicket(id);
      setTicket(t);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? 'This ticket no longer exists.' : 'Could not load this ticket.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function changeStatus(status: SupportTicketStatus) {
    if (!ticket || status === ticket.status) return;
    setUpdatingStatus(true);
    try {
      await updateSupportTicketStatus(ticket.id, status);
      setTicket((t) => (t ? { ...t, status } : t));
    } catch {
      // Toast-equivalent not available inline here; the status simply stays
      // unchanged and the admin can retry — matches the row not being
      // patched until the request actually succeeds.
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function addNote() {
    if (!ticket || noteBody.trim().length === 0) return;
    setNoteError('');
    setSubmittingNote(true);
    try {
      const note = await addSupportTicketNote(ticket.id, noteBody.trim());
      setTicket((t) => (t ? { ...t, notes: [...t.notes, note] } : t));
      setNoteBody('');
    } catch (err) {
      setNoteError(err instanceof ApiError ? err.message : 'Could not add note');
    } finally {
      setSubmittingNote(false);
    }
  }

  return { ticket, loading, error, updatingStatus, changeStatus, noteBody, setNoteBody, submittingNote, noteError, addNote };
}
