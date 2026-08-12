import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, FileText } from 'lucide-react';
import TopBar from '../components/TopBar';
import AdminTabs from '../components/AdminTabs';
import TablePager from '../components/TablePager';
import { usePagedList } from '../hooks/usePagedList';
import { usePreferences } from '../hooks/usePreferences';
import { useToast } from '../components/Toast';
import {
  listPyqBoards, listPyqPapers, uploadPyqPaper, extractPyqPage, classifyPyqPage, publishPyqPaper, PYQ_PAPER_STATUS_LABELS,
} from '../lib/adminPyq';
import { ApiError } from '../api';
import { LANGUAGES } from '../config';
import type { PyqBoard, PyqExamType, PyqPaper, PyqPaperStatus } from '../types';

const EXAM_TYPE_LABELS: Record<PyqExamType, string> = {
  annual: 'Annual', compartment: 'Compartment / Re-exam', pre_board: 'Pre-board',
};
const EXAM_TYPES = Object.keys(EXAM_TYPE_LABELS) as PyqExamType[];
const STATUSES = Object.keys(PYQ_PAPER_STATUS_LABELS) as PyqPaperStatus[];

const CURRENT_YEAR = new Date().getFullYear();

export default function AdminPyqIngestionPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const navigate = useNavigate();
  const { show } = useToast();

  const [boards, setBoards] = useState<PyqBoard[]>([]);
  const [boardsError, setBoardsError] = useState('');
  useEffect(() => {
    let cancelled = false;
    listPyqBoards()
      .then((b) => { if (!cancelled) setBoards(b); })
      .catch((err) => { if (!cancelled) setBoardsError(err instanceof ApiError ? err.message : 'Could not load boards.'); });
    return () => { cancelled = true; };
  }, []);

  const [statusFilter, setStatusFilter] = useState<PyqPaperStatus | ''>('');
  const [boardFilter, setBoardFilter] = useState('');

  const fetchPapers = useCallback(
    ({ page, limit, q }: { page: number; limit: number; q: string }) =>
      listPyqPapers({ page, limit, q, status: statusFilter, boardId: boardFilter }),
    [statusFilter, boardFilter]
  );
  const papers = usePagedList<PyqPaper>(fetchPapers, `${statusFilter}|${boardFilter}`);

  // ---- Upload form -----------------------------------------------------
  const [uploadBoardId, setUploadBoardId] = useState('');
  const [uploadSubjectId, setUploadSubjectId] = useState('');
  const [year, setYear] = useState('');
  const [examType, setExamType] = useState<PyqExamType>('annual');
  const [setLabel, setSetLabel] = useState('');
  const [language, setLanguage] = useState('en');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedBoard = boards.find((b) => b.id === uploadBoardId) || null;
  const selectedSubject = selectedBoard?.subjects.find((s) => s.id === uploadSubjectId) || null;

  function handleBoardChange(id: string) {
    setUploadBoardId(id);
    setUploadSubjectId(''); // subject list depends on board — stale selection would silently point at the wrong board
  }

  async function handleUpload(e: FormEvent) {
    e.preventDefault();
    setUploadError('');
    if (!selectedSubject || !file) return;
    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum < 1950 || yearNum > CURRENT_YEAR) {
      setUploadError(`Year must be between 1950 and ${CURRENT_YEAR}.`);
      return;
    }

    setUploading(true);
    try {
      await uploadPyqPaper({
        boardId: uploadBoardId,
        subjectId: uploadSubjectId,
        classLevel: selectedSubject.classLevel,
        year: yearNum,
        examType,
        setLabel: setLabel.trim(),
        language,
        file,
      });
      show('Paper uploaded', 'success');
      setYear('');
      setSetLabel('');
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await papers.refetch();
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Could not upload this paper.');
    } finally {
      setUploading(false);
    }
  }

  // ---- Extract-next-page action, per paper row --------------------------
  const [extractingId, setExtractingId] = useState<string | null>(null);

  async function handleExtractNext(paper: PyqPaper) {
    setExtractingId(paper.id);
    try {
      const result = await extractPyqPage(paper.id);
      show(`Extracted page ${result.pageNumber}`, 'success');
      await papers.refetch();
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not extract the next page.', 'error');
    } finally {
      setExtractingId(null);
    }
  }

  // ---- Classify-next-page action, per paper row (Phase 5) ----------------
  const [classifyingId, setClassifyingId] = useState<string | null>(null);

  async function handleClassifyNext(paper: PyqPaper) {
    setClassifyingId(paper.id);
    try {
      const result = await classifyPyqPage(paper.id);
      show(`Classified page ${result.pageNumber} (${result.classifiedCount} of ${result.classifiedCount + result.unclassifiedCount})`, 'success');
      await papers.refetch();
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not classify the next page.', 'error');
    } finally {
      setClassifyingId(null);
    }
  }

  // ---- Publish action, per paper row (Phase 7) ---------------------------
  const [publishingId, setPublishingId] = useState<string | null>(null);

  async function handlePublish(paper: PyqPaper) {
    setPublishingId(paper.id);
    try {
      await publishPyqPaper(paper.id);
      show('Paper published', 'success');
      await papers.refetch();
    } catch (err) {
      show(err instanceof ApiError ? err.message : 'Could not publish this paper.', 'error');
    } finally {
      setPublishingId(null);
    }
  }

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      <main className="admin-main pyq-main">
        <h1 className="admin-title">PYQ Ingestion</h1>
        <AdminTabs />

        <button type="button" className="btn-text pyq-cluster-link" onClick={() => navigate('/admin/pyq/clusters')}>
          Review proposed duplicate clusters
        </button>

        <section className="settings-card">
          <h2>Upload a source paper</h2>
          <p className="settings-hint">
            Board, class, subject, year, set/series, and language are set here — never guessed from the file. Each
            upload becomes its own paper record; sets/series of the same year are separate uploads (see the setLabel field).
          </p>
          {boardsError && <p className="auth-error">{boardsError}</p>}
          {!boardsError && boards.length === 0 && (
            <p className="settings-hint">No boards are seeded yet. A super_admin must seed at least one Board and Subject before papers can be uploaded.</p>
          )}
          {boards.length > 0 && (
            <form className="pyq-upload-form" onSubmit={handleUpload}>
              <div className="settings-grid">
                <label>
                  <span className="field-label">Board</span>
                  <select className="text-input" value={uploadBoardId} onChange={(e) => handleBoardChange(e.target.value)} required>
                    <option value="">Choose a board…</option>
                    {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
                <label>
                  <span className="field-label">Subject</span>
                  <select
                    className="text-input"
                    value={uploadSubjectId}
                    onChange={(e) => setUploadSubjectId(e.target.value)}
                    disabled={!selectedBoard}
                    required
                  >
                    <option value="">{selectedBoard ? 'Choose a subject…' : 'Choose a board first'}</option>
                    {selectedBoard?.subjects.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} — Class {s.classLevel}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="field-label">Year</span>
                  <input
                    className="text-input"
                    type="number"
                    min={1950}
                    max={CURRENT_YEAR}
                    value={year}
                    onChange={(e) => setYear(e.target.value)}
                    required
                  />
                </label>
                <label>
                  <span className="field-label">Exam type</span>
                  <select className="text-input" value={examType} onChange={(e) => setExamType(e.target.value as PyqExamType)}>
                    {EXAM_TYPES.map((t) => <option key={t} value={t}>{EXAM_TYPE_LABELS[t]}</option>)}
                  </select>
                </label>
                <label>
                  <span className="field-label">Set / series (optional)</span>
                  <input
                    className="text-input"
                    type="text"
                    maxLength={50}
                    placeholder='e.g. "Set 1", "65/1/1"'
                    value={setLabel}
                    onChange={(e) => setSetLabel(e.target.value)}
                  />
                </label>
                <label>
                  <span className="field-label">Language</span>
                  <select className="text-input" value={language} onChange={(e) => setLanguage(e.target.value)}>
                    {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </label>
              </div>

              <label className="field-label" htmlFor="pyq-upload-file">Source PDF</label>
              <input
                id="pyq-upload-file"
                ref={fileInputRef}
                className="text-input"
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                required
              />

              {uploadError && <p className="auth-error">{uploadError}</p>}

              <button type="submit" className="btn-primary pyq-upload-submit" disabled={uploading || !file}>
                <UploadCloud size={16} aria-hidden="true" /> {uploading ? 'Uploading…' : 'Upload paper'}
              </button>
            </form>
          )}
        </section>

        <section className="manage-section">
          <div className="table-controls">
            <div className="library-search">
              <FileText size={16} aria-hidden="true" />
              <input
                type="search"
                value={papers.search}
                onChange={(e) => papers.setSearch(e.target.value)}
                placeholder="Search board or subject"
                aria-label="Search papers"
              />
            </div>
            <div className="table-filters">
              <label className="table-filter">
                <span>Status</span>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as PyqPaperStatus | '')} aria-label="Filter by status">
                  <option value="">All statuses</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{PYQ_PAPER_STATUS_LABELS[s]}</option>)}
                </select>
              </label>
              <label className="table-filter">
                <span>Board</span>
                <select value={boardFilter} onChange={(e) => setBoardFilter(e.target.value)} aria-label="Filter by board">
                  <option value="">All boards</option>
                  {boards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </label>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Board</th><th>Subject</th><th>Class</th><th>Year</th><th>Set</th><th>Status</th><th>Pages</th><th></th>
                </tr>
              </thead>
              <tbody>
                {papers.loading && <tr><td colSpan={8} className="table-empty">Loading…</td></tr>}
                {!papers.loading && papers.error && <tr><td colSpan={8} className="table-empty">{papers.error}</td></tr>}
                {!papers.loading && !papers.error && papers.items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="table-empty">
                      {papers.isFiltering ? 'No papers match your search or filters.' : 'No papers uploaded yet — use the form above to add one.'}
                    </td>
                  </tr>
                )}
                {!papers.loading && !papers.error && papers.items.map((p) => (
                  <tr key={p.id}>
                    <td>{p.board.name}</td>
                    <td>{p.subject.name}</td>
                    <td>{p.classLevel}</td>
                    <td>{p.year}</td>
                    <td>{p.setLabel || '—'}</td>
                    <td><span className={`status-pill status-${p.status}`}>{PYQ_PAPER_STATUS_LABELS[p.status]}</span></td>
                    <td>{p.sourceDocument?.pageCount ?? '—'}</td>
                    <td className="pyq-row-actions">
                      {(p.status === 'uploaded' || p.status === 'extracting') && (
                        <button
                          type="button"
                          className="btn-text"
                          disabled={extractingId === p.id}
                          onClick={() => handleExtractNext(p)}
                        >
                          {extractingId === p.id ? 'Extracting…' : 'Extract next page'}
                        </button>
                      )}
                      {(p.status === 'extracting' || p.status === 'needs_review') && (
                        <button
                          type="button"
                          className="btn-text"
                          disabled={classifyingId === p.id}
                          onClick={() => handleClassifyNext(p)}
                        >
                          {classifyingId === p.id ? 'Classifying…' : 'Classify next page'}
                        </button>
                      )}
                      <button type="button" className="btn-text" onClick={() => navigate(`/admin/pyq/${p.id}`)}>
                        Review
                      </button>
                      {p.status === 'needs_review' && (
                        <button
                          type="button"
                          className="btn-text"
                          disabled={publishingId === p.id}
                          onClick={() => handlePublish(p)}
                        >
                          {publishingId === p.id ? 'Publishing…' : 'Publish'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <TablePager
            noun={{ one: 'paper', many: 'papers' }}
            page={papers.page}
            totalPages={papers.totalPages}
            total={papers.total}
            rangeStart={papers.rangeStart}
            rangeEnd={papers.rangeEnd}
            hasPrev={papers.hasPrev}
            hasNext={papers.hasNext}
            onPageChange={papers.setPage}
            busy={papers.loading}
          />
        </section>
      </main>
    </div>
  );
}
