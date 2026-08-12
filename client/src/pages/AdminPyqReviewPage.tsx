import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import TopBar from '../components/TopBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { usePreferences } from '../hooks/usePreferences';
import {
  getPyqPaper, listPyqQuestions, patchPyqQuestion, approvePyqQuestion, rejectPyqQuestion,
  fetchPyqSourcePdfUrl, withPdfPageFragment, buildQuestionPatch, draftFromQuestion, listPyqBoards,
  PYQ_QUESTION_TYPE_LABELS, PYQ_REVIEW_STATUS_LABELS, PYQ_PAPER_STATUS_LABELS,
} from '../lib/adminPyq';
import { ApiError } from '../api';
import type { PyqPaperDetail, PyqQuestion, PyqQuestionType, PyqDifficulty, PyqChapter } from '../types';
import type { PyqQuestionDraft } from '../lib/adminPyq';

const QUESTION_TYPES = Object.keys(PYQ_QUESTION_TYPE_LABELS) as PyqQuestionType[];
const LOW_CONFIDENCE_THRESHOLD = 0.7;

export default function AdminPyqReviewPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { paperId } = useParams<{ paperId: string }>();
  const navigate = useNavigate();
  const { show } = useToast();

  const [paper, setPaper] = useState<PyqPaperDetail | null>(null);
  const [questions, setQuestions] = useState<PyqQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Phase 5 — this paper's subject's chapter/topic taxonomy, for the picker
  // below. Loaded from GET /boards (already fetched for the ingestion page's
  // upload form) rather than a new endpoint — same "no new surface area
  // than necessary" discipline the rest of this file follows.
  const [chapters, setChapters] = useState<PyqChapter[]>([]);

  const loadAll = useCallback(async () => {
    if (!paperId) return;
    setLoading(true);
    setError('');
    try {
      const [paperDetail, questionList, boards] = await Promise.all([
        getPyqPaper(paperId), listPyqQuestions(paperId), listPyqBoards(),
      ]);
      setPaper(paperDetail);
      setQuestions(questionList);
      const subject = boards
        .find((b) => b.id === paperDetail.paper.board.id)
        ?.subjects.find((s) => s.id === paperDetail.paper.subject.id);
      setChapters(subject?.chapters ?? []);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? 'This paper no longer exists.' : 'Could not load this paper.');
    } finally {
      setLoading(false);
    }
  }, [paperId]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  // ---- Question selection + draft ---------------------------------------
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    // Land on the first item still needing a decision, or just the first
    // question — never an empty selection once questions exist.
    if (selectedId && questions.some((q) => q.id === selectedId)) return;
    const firstPending = questions.find((q) => q.reviewStatus === 'extracted' || q.reviewStatus === 'reviewed');
    setSelectedId((firstPending || questions[0])?.id ?? null);
  }, [questions, selectedId]);

  const selectedIndex = questions.findIndex((q) => q.id === selectedId);
  const selected = selectedIndex >= 0 ? questions[selectedIndex] : null;

  const [draft, setDraft] = useState<PyqQuestionDraft | null>(null);
  useEffect(() => {
    setDraft(selected ? draftFromQuestion(selected) : null);
  }, [selected]);

  const patch = useMemo(() => (selected && draft ? buildQuestionPatch(selected, draft) : null), [selected, draft]);
  const isDirty = patch !== null;
  const isLocked = selected?.reviewStatus === 'approved' || selected?.reviewStatus === 'rejected';

  // ---- Source PDF ---------------------------------------------------------
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceLoading, setSourceLoading] = useState(true);
  const [sourceError, setSourceError] = useState('');

  useEffect(() => {
    if (!paperId) return;
    let cancelled = false;
    let objectUrl = '';
    setSourceLoading(true);
    setSourceError('');
    fetchPyqSourcePdfUrl(paperId)
      .then((url) => {
        if (cancelled) { URL.revokeObjectURL(url); return; }
        objectUrl = url;
        setSourceUrl(url);
      })
      .catch((err) => { if (!cancelled) setSourceError(err instanceof ApiError ? err.message : 'Could not load the source PDF.'); })
      .finally(() => { if (!cancelled) setSourceLoading(false); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [paperId]);

  const sourceViewUrl = withPdfPageFragment(sourceUrl, selected?.pageNumber);

  // ---- Save / Approve / Reject -------------------------------------------
  const [saving, setSaving] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);

  function applyUpdatedQuestion(updated: PyqQuestion) {
    setQuestions((list) => list.map((q) => (q.id === updated.id ? updated : q)));
  }

  async function handleSave() {
    if (!selected || !patch) return;
    setSaving(true);
    try {
      const updated = await patchPyqQuestion(selected.id, patch);
      applyUpdatedQuestion(updated);
      show('Changes saved', 'success');
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not save changes.', 'error');
    } finally {
      setSaving(false);
    }
  }

  /** Approve/reject both save any pending edit first, so a reviewer never has to click Save then Approve separately. */
  async function saveIfDirty(): Promise<boolean> {
    if (!selected || !patch) return true;
    try {
      const updated = await patchPyqQuestion(selected.id, patch);
      applyUpdatedQuestion(updated);
      return true;
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not save changes before deciding.', 'error');
      return false;
    }
  }

  async function handleApprove() {
    if (!selected) return;
    setDeciding(true);
    try {
      if (!(await saveIfDirty())) return;
      const reviewStatus = await approvePyqQuestion(selected.id);
      setQuestions((list) => list.map((q) => (q.id === selected.id ? { ...q, reviewStatus } : q)));
      show('Question approved', 'success');
      goToNext();
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not approve this question.', 'error');
    } finally {
      setDeciding(false);
    }
  }

  async function handleReject() {
    if (!selected) return;
    setConfirmReject(false);
    setDeciding(true);
    try {
      if (!(await saveIfDirty())) return;
      const reviewStatus = await rejectPyqQuestion(selected.id);
      setQuestions((list) => list.map((q) => (q.id === selected.id ? { ...q, reviewStatus } : q)));
      show('Question rejected', 'success');
      goToNext();
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not reject this question.', 'error');
    } finally {
      setDeciding(false);
    }
  }

  function goToNext() {
    if (selectedIndex >= 0 && selectedIndex < questions.length - 1) setSelectedId(questions[selectedIndex + 1].id);
  }
  function goToPrev() {
    if (selectedIndex > 0) setSelectedId(questions[selectedIndex - 1].id);
  }

  const counts = useMemo(() => {
    const out = { extracted: 0, reviewed: 0, approved: 0, rejected: 0 };
    for (const q of questions) out[q.reviewStatus] += 1;
    return out;
  }, [questions]);
  const decidedCount = counts.approved + counts.rejected;

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="admin-main pyq-review-main">
        <button type="button" className="btn-text ticket-back" onClick={() => navigate('/admin/pyq')}>
          <ArrowLeft size={16} aria-hidden="true" /> Back to PYQ Ingestion
        </button>

        {loading && <div className="response-loading"><div className="spinner" /><p>Loading paper…</p></div>}
        {!loading && error && <p className="auth-error">{error}</p>}

        {!loading && !error && paper && (
          <>
            <div className="pyq-review-head">
              <div>
                <h1 className="pyq-review-title">
                  {paper.paper.board.name} — {paper.paper.subject.name} — Class {paper.paper.classLevel} — {paper.paper.year}
                  {paper.paper.setLabel ? ` (${paper.paper.setLabel})` : ''}
                </h1>
                <p className="settings-hint">
                  This is real historical exam-paper source material — every field below is a transcription of the
                  original page, not AI-generated content. Verify it against the source on the left before deciding.
                </p>
              </div>
              <span className={`status-pill status-${paper.paper.status}`}>{PYQ_PAPER_STATUS_LABELS[paper.paper.status]}</span>
            </div>

            <p className="pyq-review-progress" aria-live="polite">
              {decidedCount} of {questions.length} questions decided — {counts.approved} approved, {counts.rejected} rejected,{' '}
              {counts.extracted + counts.reviewed} remaining
            </p>

            {questions.length === 0 && (
              <p className="table-empty pyq-review-empty">
                No questions have been extracted for this paper yet. Go back to PYQ Ingestion and use "Extract next page".
              </p>
            )}

            {questions.length > 0 && (
              <>
                <div className="pyq-qnav" role="tablist" aria-label="Questions in this paper">
                  <button type="button" className="icon-btn" onClick={goToPrev} disabled={selectedIndex <= 0} aria-label="Previous question">
                    <ChevronLeft size={16} aria-hidden="true" />
                  </button>
                  <div className="pyq-qnav-strip">
                    {questions.map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        role="tab"
                        aria-selected={q.id === selectedId}
                        className={`pyq-qnav-chip status-${q.reviewStatus}${q.id === selectedId ? ' active' : ''}`}
                        onClick={() => setSelectedId(q.id)}
                        title={`Question ${q.questionNumber} — ${PYQ_REVIEW_STATUS_LABELS[q.reviewStatus]}`}
                      >
                        {q.questionNumber}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={goToNext}
                    disabled={selectedIndex < 0 || selectedIndex >= questions.length - 1}
                    aria-label="Next question"
                  >
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                </div>

                {selected && draft && (
                  <div className="pyq-review-grid">
                    <section className="settings-card pyq-source-panel">
                      <h2>Source — Page {selected.pageNumber ?? '—'}</h2>
                      {sourceLoading && <div className="response-loading"><div className="spinner" /><p>Loading source PDF…</p></div>}
                      {!sourceLoading && sourceError && <p className="auth-error">{sourceError}</p>}
                      {!sourceLoading && !sourceError && sourceUrl && (
                        <>
                          {/* Keyed on the page fragment: a browser's embedded PDF plugin does
                              not reliably re-navigate an already-loaded <object> when only its
                              `data` URL's #page= fragment changes (observed live against a real
                              multi-page PDF — the viewer stayed on the previous page's blank
                              frame). Forcing a fresh key remounts the element so the plugin
                              re-initializes at the correct page every time. */}
                          <object key={sourceViewUrl} data={sourceViewUrl} type="application/pdf" className="pyq-source-frame" aria-label="Source PDF page">
                            <p className="settings-hint">
                              Your browser can&apos;t preview PDFs inline.{' '}
                              <a href={sourceViewUrl} target="_blank" rel="noreferrer">Open the source PDF in a new tab</a>.
                            </p>
                          </object>
                          <a href={sourceViewUrl} target="_blank" rel="noreferrer" className="btn-text pyq-source-open">
                            <ExternalLink size={14} aria-hidden="true" /> Open full PDF in a new tab
                          </a>
                        </>
                      )}
                    </section>

                    <section className="settings-card pyq-question-panel">
                      <div className="pyq-question-head">
                        <h2>Question {selected.questionNumber}</h2>
                        <span className={`status-pill status-${selected.reviewStatus}`}>{PYQ_REVIEW_STATUS_LABELS[selected.reviewStatus]}</span>
                        {selected.extractionConfidence != null && selected.extractionConfidence < LOW_CONFIDENCE_THRESHOLD && (
                          <span className="status-pill status-pending" title="Gemini reported low confidence on this page — check carefully against the source.">
                            Low confidence ({Math.round(selected.extractionConfidence * 100)}%)
                          </span>
                        )}
                      </div>

                      <dl className="ticket-kv pyq-provenance">
                        <div className="ticket-kv-row"><dt>Paper</dt><dd>{paper.paper.board.name} {paper.paper.year}</dd></div>
                        <div className="ticket-kv-row"><dt>Page</dt><dd>{selected.pageNumber ?? '—'}</dd></div>
                        <div className="ticket-kv-row"><dt>Language</dt><dd>{selected.language}</dd></div>
                      </dl>

                      {isLocked && (
                        <p className="settings-hint pyq-locked-notice">
                          This question has reached a final decision ({PYQ_REVIEW_STATUS_LABELS[selected.reviewStatus]}) and can no longer be edited.
                          {selected.reviewStatus === 'approved' && ' Reject it to correct a mistaken approval.'}
                        </p>
                      )}

                      <label className="field-label" htmlFor="pyq-q-number">Question number (as printed)</label>
                      <input
                        id="pyq-q-number"
                        className="text-input"
                        value={draft.questionNumber}
                        disabled={isLocked}
                        onChange={(e) => setDraft({ ...draft, questionNumber: e.target.value })}
                      />

                      <label className="field-label" htmlFor="pyq-q-type">Type</label>
                      <select
                        id="pyq-q-type"
                        className="text-input"
                        value={draft.type}
                        disabled={isLocked}
                        onChange={(e) => setDraft({ ...draft, type: e.target.value as PyqQuestionType })}
                      >
                        {QUESTION_TYPES.map((t) => <option key={t} value={t}>{PYQ_QUESTION_TYPE_LABELS[t]}</option>)}
                      </select>

                      <label className="field-label" htmlFor="pyq-q-text">Question text</label>
                      <textarea
                        id="pyq-q-text"
                        className="text-input pyq-question-text"
                        rows={5}
                        value={draft.text}
                        disabled={isLocked}
                        onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                      />

                      {draft.type === 'mcq' && (
                        <>
                          <span className="field-label">Options</span>
                          <div className="pyq-options-grid">
                            {draft.options.map((opt: string, i: number) => (
                              <input
                                key={i}
                                className="text-input"
                                placeholder={`Option ${String.fromCharCode(65 + i)}`}
                                value={opt}
                                disabled={isLocked}
                                onChange={(e) => {
                                  const next = [...draft.options];
                                  next[i] = e.target.value;
                                  setDraft({ ...draft, options: next });
                                }}
                              />
                            ))}
                          </div>
                        </>
                      )}

                      <div className="settings-grid">
                        <label>
                          <span className="field-label">Marks</span>
                          <input
                            className="text-input"
                            type="number"
                            min={1}
                            max={20}
                            value={draft.marks}
                            disabled={isLocked}
                            onChange={(e) => setDraft({ ...draft, marks: e.target.value })}
                          />
                        </label>
                        <label>
                          <span className="field-label">Difficulty</span>
                          <select
                            className="text-input"
                            value={draft.difficulty}
                            disabled={isLocked}
                            onChange={(e) => setDraft({ ...draft, difficulty: e.target.value as PyqDifficulty | '' })}
                          >
                            <option value="">Not marked</option>
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard</option>
                          </select>
                        </label>
                      </div>

                      <label className="field-label" htmlFor="pyq-q-answer">
                        Official answer key text {draft.correctAnswer.trim() ? '(has an official answer)' : '(no official answer on this page — leave blank)'}
                      </label>
                      <textarea
                        id="pyq-q-answer"
                        className="text-input"
                        rows={2}
                        placeholder="Leave blank unless the answer key is actually printed on the source page"
                        value={draft.correctAnswer}
                        disabled={isLocked}
                        onChange={(e) => setDraft({ ...draft, correctAnswer: e.target.value })}
                      />
                      <p className="settings-hint pyq-trust-note">
                        Never fill this in with a computed/guessed answer — an absent answer key is a permanent, honest fact about this question, not something to complete for the UI's sake.
                      </p>

                      <div className="role-access-grid pyq-checkbox-row">
                        <label className="role-access-option">
                          <input type="checkbox" checked={draft.hasDiagram} disabled={isLocked} onChange={(e) => setDraft({ ...draft, hasDiagram: e.target.checked })} />
                          Has diagram/figure
                        </label>
                        <label className="role-access-option">
                          <input type="checkbox" checked={draft.hasTable} disabled={isLocked} onChange={(e) => setDraft({ ...draft, hasTable: e.target.checked })} />
                          Has table
                        </label>
                        <label className="role-access-option">
                          <input type="checkbox" checked={draft.requiresGroupSelection} disabled={isLocked} onChange={(e) => setDraft({ ...draft, requiresGroupSelection: e.target.checked })} />
                          Offers "attempt any one/two of the following"
                        </label>
                      </div>

                      <label className="field-label" htmlFor="pyq-q-chapter">Chapter</label>
                      <select
                        id="pyq-q-chapter"
                        className="text-input"
                        value={draft.chapterId}
                        disabled={isLocked}
                        onChange={(e) => setDraft({ ...draft, chapterId: e.target.value, topicIds: [] })}
                      >
                        <option value="">Not classified</option>
                        {chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>

                      {(() => {
                        const chapterTopics = chapters.find((c) => c.id === draft.chapterId)?.topics ?? [];
                        if (chapterTopics.length === 0) return null;
                        return (
                          <>
                            <span className="field-label">Topics</span>
                            <div className="role-access-grid pyq-checkbox-row">
                              {chapterTopics.map((t) => (
                                <label key={t.id} className="role-access-option">
                                  <input
                                    type="checkbox"
                                    checked={draft.topicIds.includes(t.id)}
                                    disabled={isLocked}
                                    onChange={(e) => setDraft({
                                      ...draft,
                                      topicIds: e.target.checked ? [...draft.topicIds, t.id] : draft.topicIds.filter((id) => id !== t.id),
                                    })}
                                  />
                                  {t.name}
                                </label>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                      {chapters.length === 0 && (
                        <p className="settings-hint">
                          No chapter taxonomy is seeded for this subject yet — run the syllabus seed script (Phase 5) first.
                        </p>
                      )}

                      <details className="pyq-raw-extraction">
                        <summary>Show original Gemini extraction</summary>
                        <pre className="ticket-raw-context">{JSON.stringify(selected.rawExtraction, null, 2)}</pre>
                      </details>

                      <div className="pyq-review-actions">
                        <button type="button" className="btn-text" disabled={!isDirty || isLocked || saving} onClick={handleSave}>
                          {saving ? 'Saving…' : 'Save changes'}
                        </button>
                        <button type="button" className="btn-primary" disabled={isLocked || deciding} onClick={handleApprove}>
                          {deciding ? 'Working…' : 'Approve'}
                        </button>
                        <button type="button" className="btn-danger" disabled={deciding} onClick={() => setConfirmReject(true)}>
                          Reject
                        </button>
                        <button
                          type="button"
                          className="btn-text pyq-skip-next"
                          disabled={selectedIndex < 0 || selectedIndex >= questions.length - 1}
                          onClick={goToNext}
                        >
                          Skip to next <ArrowRight size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </section>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      <ConfirmDialog
        open={confirmReject}
        title="Reject this question?"
        body="A rejected question can no longer be approved — it stays excluded from every future PYQ paper. This is the correct way to reverse a mistaken approval, but reversing a rejection back to approved is not possible from here."
        confirmLabel="Reject"
        tone="danger"
        busy={deciding}
        onConfirm={handleReject}
        onCancel={() => setConfirmReject(false)}
      />
    </div>
  );
}
