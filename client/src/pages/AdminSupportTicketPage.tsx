import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import TopBar from '../components/TopBar';
import { useToast } from '../components/Toast';
import { usePreferences } from '../hooks/usePreferences';
import { getSupportTicket, updateSupportTicketStatus, addSupportTicketNote } from '../lib/adminSupport';
import { ApiError } from '../api';
import type { SupportTicketDetail, SupportTicketStatus } from '../types';

const STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: 'Open', triaged: 'Triaged', resolved: 'Resolved', wont_fix: "Won't fix",
};
const STATUSES = Object.keys(STATUS_LABELS) as SupportTicketStatus[];
const TYPE_LABELS = { bug: 'Bug', feedback: 'Feedback' } as const;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

// Known, human-labeled context keys — anything else in the JSON blob (a
// future field added without a UI change, see the design doc's §4 rationale)
// falls back into the raw-context toggle below rather than being dropped.
const CONTEXT_LABELS: Record<string, string> = {
  route: 'Route', buildId: 'Build', userAgent: 'Browser', viewport: 'Viewport',
  theme: 'Theme', language: 'Language', requestId: 'Request ID',
  grade: 'Grade', subject: 'Subject', classroomType: 'Classroom type',
};

export default function AdminSupportTicketPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { show } = useToast();

  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [noteBody, setNoteBody] = useState('');
  const [submittingNote, setSubmittingNote] = useState(false);
  const [showRawContext, setShowRawContext] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!id) return;
    setLoading(true);
    setError('');
    getSupportTicket(id)
      .then((t) => { if (!cancelled) setTicket(t); })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError && err.status === 404 ? 'This ticket no longer exists.' : 'Could not load this ticket.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  async function handleStatusChange(status: SupportTicketStatus) {
    if (!ticket || status === ticket.status) return;
    setUpdatingStatus(true);
    try {
      await updateSupportTicketStatus(ticket.id, status);
      setTicket((t) => (t ? { ...t, status } : t));
      show('Status updated', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not update status', 'error');
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleAddNote(e: FormEvent) {
    e.preventDefault();
    if (!ticket || noteBody.trim().length === 0) return;
    setSubmittingNote(true);
    try {
      const note = await addSupportTicketNote(ticket.id, noteBody.trim());
      setTicket((t) => (t ? { ...t, notes: [...t.notes, note] } : t));
      setNoteBody('');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not add note', 'error');
    } finally {
      setSubmittingNote(false);
    }
  }

  const knownContextEntries = ticket?.context
    ? Object.entries(ticket.context).filter(([key]) => CONTEXT_LABELS[key])
    : [];

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="admin-main ticket-detail-main">
        <button type="button" className="btn-text ticket-back" onClick={() => navigate('/admin/support')}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to Support Inbox
        </button>

        {loading && <div className="response-loading"><div className="spinner" /><p>Loading ticket…</p></div>}
        {!loading && error && <p className="auth-error">{error}</p>}

        {!loading && !error && ticket && (
          <>
            <div className="ticket-detail-head">
              <span className={`type-tag type-${ticket.type}`}>{TYPE_LABELS[ticket.type]}</span>
              <h1 className="ticket-detail-title">Ticket #{ticket.id.slice(-8)}</h1>
              <span className={`status-pill status-${ticket.status}`}>{STATUS_LABELS[ticket.status]}</span>
              <div className="ticket-status-actions">
                {STATUSES.filter((s) => s !== ticket.status).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="btn-text ticket-status-btn"
                    disabled={updatingStatus}
                    onClick={() => handleStatusChange(s)}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>

            <div className="ticket-detail-grid">
              <div className="ticket-detail-main-col">
                <section className="settings-card">
                  <h2>Description</h2>
                  {ticket.description ? <p className="ticket-description">{ticket.description}</p> : <p className="settings-hint">No description provided.</p>}
                </section>

                <section className="settings-card">
                  <h2>Auto-captured context</h2>
                  {knownContextEntries.length === 0 && !ticket.context && (
                    <p className="settings-hint">Nothing was captured for this ticket.</p>
                  )}
                  {knownContextEntries.length > 0 && (
                    <dl className="ticket-kv">
                      {knownContextEntries.map(([key, value]) => (
                        <div className="ticket-kv-row" key={key}>
                          <dt>{CONTEXT_LABELS[key]}</dt>
                          <dd>{value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {ticket.context && (
                    <>
                      <button type="button" className="btn-text ticket-raw-toggle" onClick={() => setShowRawContext((v) => !v)}>
                        {showRawContext ? 'Hide raw context' : 'Show raw context'}
                      </button>
                      {showRawContext && <pre className="ticket-raw-context">{JSON.stringify(ticket.context, null, 2)}</pre>}
                    </>
                  )}
                </section>

                <section className="settings-card">
                  <h2>Internal notes</h2>
                  <p className="settings-hint">Never visible to the teacher who filed this ticket.</p>
                  {ticket.notes.length === 0 && <p className="settings-hint">No notes yet.</p>}
                  <div className="ticket-notes">
                    {ticket.notes.map((note) => (
                      <div className="ticket-note" key={note.id}>
                        <span className="ticket-note-avatar" aria-hidden="true">
                          {note.author.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                        </span>
                        <div className="ticket-note-body">
                          <p>{note.body}</p>
                          <span className="ticket-note-meta">{note.author.name} · {formatDateTime(note.createdAt)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <form onSubmit={handleAddNote} className="ticket-note-form">
                    <textarea
                      className="text-input"
                      rows={3}
                      maxLength={2000}
                      placeholder="Add a note…"
                      value={noteBody}
                      onChange={(e) => setNoteBody(e.target.value)}
                    />
                    <button className="btn-primary" type="submit" disabled={submittingNote || noteBody.trim().length === 0}>
                      {submittingNote ? 'Sending…' : 'Add note'}
                    </button>
                  </form>
                </section>
              </div>

              <div className="ticket-detail-side-col">
                <section className="settings-card">
                  <h2>Reported by</h2>
                  {ticket.user ? (
                    <p className="ticket-description">
                      {ticket.user.name}<br />
                      <span className="settings-hint">{ticket.user.email} · {ticket.user.role}</span><br />
                      {ticket.school && <span className="settings-hint">{ticket.school.name} ({ticket.school.code})</span>}
                    </p>
                  ) : (
                    <p className="settings-hint">No reporter on file.</p>
                  )}
                </section>

                <section className="settings-card">
                  <h2>Timestamps</h2>
                  <dl className="ticket-kv">
                    <div className="ticket-kv-row"><dt>Created</dt><dd>{formatDateTime(ticket.createdAt)}</dd></div>
                    <div className="ticket-kv-row"><dt>Updated</dt><dd>{formatDateTime(ticket.updatedAt)}</dd></div>
                  </dl>
                </section>

                {/* Future-ready placeholders — Phase 3, not built yet (see
                    docs/help-support-architecture.md's Phase 2 section). */}
                <p className="ticket-placeholder">Assigned to: — (planned)</p>
                <p className="ticket-placeholder">Attachments: none (planned)</p>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
