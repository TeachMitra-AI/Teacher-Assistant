import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import TopBar from '../components/TopBar';
import AdminTabs from '../components/AdminTabs';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { usePreferences } from '../hooks/usePreferences';
import {
  listPyqClusters, confirmPyqCluster, rejectPyqCluster, listPyqBoards,
  PYQ_CLUSTER_STATUS_LABELS, PYQ_CLUSTER_METHOD_LABELS,
} from '../lib/adminPyq';
import { ApiError } from '../api';
import type { PyqCluster, PyqClusterStatus, PyqChapter } from '../types';

const STATUSES = Object.keys(PYQ_CLUSTER_STATUS_LABELS) as PyqClusterStatus[];

// Phase 6 file list names this "a second, simpler paged confirm/reject
// table" — but the MVP corpus (Phase 0: 2 boards x 1 class x 1 subject x 10
// years) never produces enough clusters to need real pagination, matching
// GET /clusters' own no-pagination design (routes/adminPyq.js). A plain
// filtered list is the honest shape for this scale.
export default function AdminPyqClusterReviewPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const navigate = useNavigate();
  const { show } = useToast();

  const [clusters, setClusters] = useState<PyqCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [statusFilter, setStatusFilter] = useState<PyqClusterStatus | ''>('proposed');
  const [chapterFilter, setChapterFilter] = useState('');

  // Chapter picker, populated from the same taxonomy endpoint the review
  // page already uses — flattened across every board/subject.
  const [chapters, setChapters] = useState<Array<PyqChapter & { boardName: string; subjectName: string }>>([]);
  useEffect(() => {
    let cancelled = false;
    listPyqBoards()
      .then((boards) => {
        if (cancelled) return;
        const flat = boards.flatMap((b) =>
          b.subjects.flatMap((s) => s.chapters.map((c) => ({ ...c, boardName: b.name, subjectName: s.name })))
        );
        setChapters(flat);
      })
      .catch(() => { /* the chapter FILTER is a convenience; its own failure shouldn't block the cluster list below */ });
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listPyqClusters({ status: statusFilter, chapterId: chapterFilter });
      setClusters(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load clusters.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, chapterFilter]);

  useEffect(() => { void load(); }, [load]);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);

  async function handleConfirm(cluster: PyqCluster) {
    setDecidingId(cluster.id);
    try {
      await confirmPyqCluster(cluster.id);
      show('Cluster confirmed', 'success');
      await load();
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not confirm this cluster.', 'error');
    } finally {
      setDecidingId(null);
    }
  }

  async function handleReject() {
    if (!confirmRejectId) return;
    const id = confirmRejectId;
    setConfirmRejectId(null);
    setDecidingId(id);
    try {
      await rejectPyqCluster(id);
      show('Cluster rejected', 'success');
      await load();
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not reject this cluster.', 'error');
    } finally {
      setDecidingId(null);
    }
  }

  const counts = useMemo(() => {
    const out: Record<PyqClusterStatus, number> = { proposed: 0, confirmed: 0, rejected: 0 };
    for (const c of clusters) out[c.status] += 1;
    return out;
  }, [clusters]);

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="admin-main pyq-main">
        <button type="button" className="btn-text ticket-back" onClick={() => navigate('/admin/pyq')}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to PYQ Ingestion
        </button>

        <h1 className="admin-title">PYQ Cluster Review</h1>
        <AdminTabs />
        <p className="settings-hint">
          Each row below is a machine-PROPOSED group of questions the system believes are the same recurring question
          (exact match, similar wording, or similar meaning). Nothing here affects a teacher-visible recurrence count
          until you confirm it — a proposal is never trusted un-reviewed.
        </p>

        <section className="manage-section">
          <div className="table-controls">
            <div className="table-filters">
              <label className="table-filter">
                <span>Status</span>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PyqClusterStatus | '')} aria-label="Filter by status">
                  <option value="">All statuses</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{PYQ_CLUSTER_STATUS_LABELS[s]}</option>)}
                </select>
              </label>
              <label className="table-filter">
                <span>Chapter</span>
                <select value={chapterFilter} onChange={(e) => setChapterFilter(e.target.value)} aria-label="Filter by chapter">
                  <option value="">All chapters</option>
                  {chapters.map((c) => (
                    <option key={c.id} value={c.id}>{c.boardName} — {c.subjectName} — {c.name}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {!loading && !error && (
            <p className="settings-hint">{counts.proposed} needing review, {counts.confirmed} confirmed, {counts.rejected} rejected (of {clusters.length} shown)</p>
          )}

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Chapter</th><th>Method</th><th>Members</th><th>Recurrence</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} className="table-empty">Loading…</td></tr>}
                {!loading && error && <tr><td colSpan={6} className="table-empty">{error}</td></tr>}
                {!loading && !error && clusters.length === 0 && (
                  <tr><td colSpan={6} className="table-empty">No clusters match this filter. Run the clustering batch script to propose new ones.</td></tr>
                )}
                {!loading && !error && clusters.flatMap((c) => {
                  const rows = [
                    <tr key={c.id}>
                      <td>{c.chapter ? `${c.chapter.subject?.board.name ?? ''} — ${c.chapter.name}` : '—'}</td>
                      <td>{PYQ_CLUSTER_METHOD_LABELS[c.method]}</td>
                      <td>
                        <button type="button" className="btn-text" onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                          {c.members.length} {expandedId === c.id ? '▲' : '▼'}
                        </button>
                      </td>
                      <td>{c.recurrence.count} occurrence{c.recurrence.count === 1 ? '' : 's'} ({c.recurrence.years.join(', ') || '—'})</td>
                      <td><span className={`status-pill status-${c.status}`}>{PYQ_CLUSTER_STATUS_LABELS[c.status]}</span></td>
                      <td className="pyq-row-actions">
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={c.status !== 'proposed' || decidingId === c.id}
                          onClick={() => handleConfirm(c)}
                        >
                          {decidingId === c.id ? 'Working…' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          disabled={c.status === 'rejected' || decidingId === c.id}
                          onClick={() => setConfirmRejectId(c.id)}
                        >
                          Reject
                        </button>
                      </td>
                    </tr>,
                  ];
                  if (expandedId === c.id) {
                    rows.push(
                      <tr key={`${c.id}-detail`}>
                        <td colSpan={6}>
                          <ul className="pyq-cluster-members">
                            {c.members.map((m) => (
                              <li key={m.questionId}>
                                <strong>{m.year}</strong> — Q{m.questionNumber}
                                {m.questionId === c.referenceQuestionId ? ' (reference)' : ''}
                                {m.similarity != null ? ` — ${Math.round(m.similarity * 100)}% similar` : ''}: {m.text}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    );
                  }
                  return rows;
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <ConfirmDialog
        open={confirmRejectId !== null}
        title="Reject this cluster?"
        body="A rejected cluster is excluded from future automatic matching — a new question will never silently re-join it. You can still confirm it later if this was a mistake."
        confirmLabel="Reject"
        tone="danger"
        busy={decidingId === confirmRejectId}
        onConfirm={handleReject}
        onCancel={() => setConfirmRejectId(null)}
      />
    </div>
  );
}
