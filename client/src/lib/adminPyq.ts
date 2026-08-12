// Typed client for PYQ admin ingestion + review (Phases 2-4). Thin wrappers
// over api(), the same shape as lib/adminSupport.ts — role enforcement
// (super_admin only) happens server-side; nothing here can widen what the
// caller is allowed to see or do.
import { api, ApiError, getToken } from '../api';
import { API_BASE } from '../config';
import type { Paged } from './admin';
import type {
  PyqBoard, PyqPaper, PyqPaperDetail, PyqQuestion, PyqQuestionEdits, PyqPaperStatus, PyqExamType, PyqClassLevel,
  PyqCluster, PyqClusterStatus,
} from '../types';

// Mirrors lib/adminSupport.ts's own listParams exactly — kept as its own
// copy rather than a shared import, the same "small per-file leaf helpers
// stay duplicated" precedent the server side of this feature already
// documents (routes/adminPyq.js's own header).
function listParams(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    if (key === 'page' && value === 1) continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export async function listPyqBoards(): Promise<PyqBoard[]> {
  const data = await api<{ boards: PyqBoard[] }>('/admin/pyq/boards');
  return data.boards;
}

export interface PyqPaperQuery {
  page?: number;
  limit?: number;
  q?: string;
  status?: PyqPaperStatus | '';
  boardId?: string;
  subjectId?: string;
}

export async function listPyqPapers(query: PyqPaperQuery = {}): Promise<Paged<PyqPaper>> {
  const page = query.page ?? 1;
  const qs = listParams({
    page, limit: query.limit, q: query.q, status: query.status, boardId: query.boardId, subjectId: query.subjectId,
  });
  const data = await api<{ papers: PyqPaper[]; total?: number; page?: number; limit?: number }>(`/admin/pyq/papers${qs}`);
  return {
    items: data.papers,
    total: typeof data.total === 'number' ? data.total : data.papers.length,
    page: typeof data.page === 'number' ? data.page : page,
    limit: typeof data.limit === 'number' ? data.limit : data.papers.length,
  };
}

export async function getPyqPaper(id: string): Promise<PyqPaperDetail> {
  return api<PyqPaperDetail>(`/admin/pyq/papers/${id}`);
}

export interface PyqUploadFields {
  boardId: string;
  subjectId: string;
  classLevel: PyqClassLevel;
  year: number;
  examType: PyqExamType;
  setLabel: string;
  language: string;
  file: File;
}

export async function uploadPyqPaper(fields: PyqUploadFields): Promise<PyqPaper> {
  const formData = new FormData();
  formData.set('boardId', fields.boardId);
  formData.set('subjectId', fields.subjectId);
  formData.set('classLevel', fields.classLevel);
  formData.set('year', String(fields.year));
  formData.set('examType', fields.examType);
  formData.set('setLabel', fields.setLabel);
  formData.set('language', fields.language);
  formData.set('file', fields.file);
  const data = await api<{ paper: PyqPaper }>('/admin/pyq/papers', { method: 'POST', body: formData });
  return data.paper;
}

export interface PyqExtractResult {
  pageNumber: number;
  status: 'done';
}

/** Triggers extraction of the next pending page (omit `page`) or a specific page (retry/re-extract). */
export async function extractPyqPage(paperId: string, page?: number): Promise<PyqExtractResult> {
  return api<PyqExtractResult>(`/admin/pyq/papers/${paperId}/extract`, { method: 'POST', body: page ? { page } : {} });
}

export interface PyqClassifyResult {
  pageNumber: number;
  status: 'done';
  classifiedCount: number;
  unclassifiedCount: number;
}

/** Phase 5. Triggers chapter/topic classification of the next page with anything still needing it (omit `page`), or a specific page. */
export async function classifyPyqPage(paperId: string, page?: number): Promise<PyqClassifyResult> {
  return api<PyqClassifyResult>(`/admin/pyq/papers/${paperId}/classify`, { method: 'POST', body: page ? { page } : {} });
}

export interface PyqQuestionQuery {
  reviewStatus?: string;
}

export async function listPyqQuestions(paperId: string, query: PyqQuestionQuery = {}): Promise<PyqQuestion[]> {
  const qs = listParams({ reviewStatus: query.reviewStatus });
  const data = await api<{ questions: PyqQuestion[] }>(`/admin/pyq/papers/${paperId}/questions${qs}`);
  return data.questions;
}

export async function patchPyqQuestion(id: string, edits: PyqQuestionEdits): Promise<PyqQuestion> {
  const data = await api<{ question: PyqQuestion }>(`/admin/pyq/questions/${id}`, { method: 'PATCH', body: edits });
  return data.question;
}

export async function approvePyqQuestion(id: string): Promise<PyqQuestion['reviewStatus']> {
  const data = await api<{ id: string; reviewStatus: PyqQuestion['reviewStatus'] }>(`/admin/pyq/questions/${id}/approve`, { method: 'POST' });
  return data.reviewStatus;
}

export async function rejectPyqQuestion(id: string): Promise<PyqQuestion['reviewStatus']> {
  const data = await api<{ id: string; reviewStatus: PyqQuestion['reviewStatus'] }>(`/admin/pyq/questions/${id}/reject`, { method: 'POST' });
  return data.reviewStatus;
}

/**
 * Fetches the source PDF as an authenticated blob and returns an object URL
 * for it, so it can be embedded in a native <iframe>/<object> viewer (§15:
 * "no new PDF-rendering dependency"). Necessary because GET .../source stays
 * PRIVATE and role-gated exactly as Phase 2 built it (§13: never a public
 * URL) — a plain <iframe src="…/source"> cannot attach the Authorization
 * header a private route requires, unlike routes/avatar.js's DELIBERATELY
 * public picture route. Fetching once and handing the viewer a blob: URL
 * keeps the endpoint's real access control intact while still using only
 * the browser's native PDF viewer — no pdf.js/react-pdf dependency added.
 *
 * Caller owns the returned URL's lifetime: revoke it with
 * URL.revokeObjectURL() when the viewer unmounts or the paper changes, or it
 * leaks for the life of the tab.
 */
export async function fetchPyqSourcePdfUrl(paperId: string): Promise<string> {
  const token = getToken();
  const res = await fetch(`${API_BASE}/admin/pyq/papers/${paperId}/source`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let message = `Could not load the source PDF (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // Non-JSON error body — keep the generic message above.
    }
    throw new ApiError(message, res.status);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/**
 * Phase 7. Flips ExamPaper.status to 'published' once every question on the
 * paper has reached a terminal reviewStatus (approved or rejected). Safe to
 * call repeatedly on an already-published paper (returns the same result,
 * not an error). A 409 NOT_READY ApiError names how many questions still
 * need review, or that the paper has no extracted questions yet.
 */
export async function publishPyqPaper(id: string): Promise<PyqPaperStatus> {
  const data = await api<{ id: string; status: PyqPaperStatus }>(`/admin/pyq/papers/${id}/publish`, { method: 'POST' });
  return data.status;
}

/** Appends the browser-native PDF viewer's page-jump fragment (§15's own "client-side concern" for per-page navigation). */
export function withPdfPageFragment(objectUrl: string, pageNumber: number | null | undefined): string {
  if (!pageNumber || pageNumber < 1) return objectUrl;
  return `${objectUrl}#page=${pageNumber}`;
}

/**
 * Diffs an edited question draft against its original, returning ONLY the
 * changed, editable fields as a PyqQuestionEdits PATCH body — or null if
 * nothing changed (callers should treat that as "nothing to save", not send
 * an empty PATCH, which the server rejects with 400 INVALID_FIELDS).
 *
 * Pure and independently testable (see adminPyq.test.ts) — this is the
 * "frontend correction-flow" logic Phase 4 needs verified, kept as a plain
 * function rather than buried in the review page's component state so it
 * can be tested without rendering anything (this project's client test
 * runner is deliberately pure-logic-only — see vitest.config.ts).
 *
 * `type`/`options` travel together: whenever the type changes, options is
 * always included in the diff (even if unedited) so the server's mcq
 * exactly-4-options check always sees the options the reviewer intends for
 * the NEW type, never a stale set left over from the previous type.
 */
export function buildQuestionPatch(original: PyqQuestion, draft: PyqQuestionDraft): PyqQuestionEdits | null {
  const edits: PyqQuestionEdits = {};

  const questionNumber = draft.questionNumber.trim();
  if (questionNumber !== original.questionNumber) edits.questionNumber = questionNumber;

  const text = draft.text.trim();
  if (text !== original.text) edits.text = text;

  const marks = Number(draft.marks);
  if (Number.isFinite(marks) && marks !== original.marks) edits.marks = marks;

  const correctAnswer = draft.correctAnswer.trim();
  if (correctAnswer !== (original.correctAnswer ?? '')) edits.correctAnswer = correctAnswer;

  const difficulty = draft.difficulty === '' ? null : draft.difficulty;
  if (difficulty !== original.difficulty) edits.difficulty = difficulty;

  if (draft.hasDiagram !== original.hasDiagram) edits.hasDiagram = draft.hasDiagram;
  if (draft.hasTable !== original.hasTable) edits.hasTable = draft.hasTable;
  if (draft.requiresGroupSelection !== original.requiresGroupSelection) edits.requiresGroupSelection = draft.requiresGroupSelection;

  const trimmedOptions = draft.options.map((o) => o.trim());
  const originalOptions = original.options ?? [];
  const optionsChanged =
    trimmedOptions.length !== originalOptions.length || trimmedOptions.some((o, i) => o !== originalOptions[i]);

  if (draft.type !== original.type) {
    edits.type = draft.type;
    // Always travels with a type change — see the function doc above.
    edits.options = draft.type === 'mcq' ? trimmedOptions : [];
  } else if (draft.type === 'mcq' && optionsChanged) {
    edits.options = trimmedOptions;
  }

  // Phase 5. chapterId: '' in the draft means "no chapter" — sent as null
  // (never omitted) whenever it differs from the original, so clearing a
  // chapter is a real edit, not a no-op.
  const chapterId = draft.chapterId === '' ? null : draft.chapterId;
  if (chapterId !== original.chapterId) edits.chapterId = chapterId;

  const originalTopicIds = original.topics.map((t) => t.id).slice().sort();
  const draftTopicIds = draft.topicIds.slice().sort();
  const topicsChanged =
    draftTopicIds.length !== originalTopicIds.length || draftTopicIds.some((id, i) => id !== originalTopicIds[i]);
  if (topicsChanged) edits.topicIds = draft.topicIds;

  return Object.keys(edits).length > 0 ? edits : null;
}

/** Editable-field form state for the review page — always-string inputs, converted/validated on save. */
export interface PyqQuestionDraft {
  questionNumber: string;
  type: PyqQuestion['type'];
  text: string;
  options: string[];
  marks: number | string;
  correctAnswer: string;
  difficulty: NonNullable<PyqQuestion['difficulty']> | '';
  hasDiagram: boolean;
  hasTable: boolean;
  requiresGroupSelection: boolean;
  // Phase 5. '' means "no chapter" (matches a <select> with an empty option).
  chapterId: string;
  topicIds: string[];
}

/** Builds a fresh, editable draft from a loaded question — the review page's per-question form reset point. */
export function draftFromQuestion(question: PyqQuestion): PyqQuestionDraft {
  return {
    questionNumber: question.questionNumber,
    type: question.type,
    text: question.text,
    options: question.options && question.options.length > 0 ? question.options : ['', '', '', ''],
    marks: question.marks,
    correctAnswer: question.correctAnswer ?? '',
    difficulty: question.difficulty ?? '',
    hasDiagram: question.hasDiagram,
    hasTable: question.hasTable,
    requiresGroupSelection: question.requiresGroupSelection,
    chapterId: question.chapterId ?? '',
    topicIds: question.topics.map((t) => t.id),
  };
}

export const PYQ_QUESTION_TYPE_LABELS: Record<PyqQuestion['type'], string> = {
  mcq: 'Multiple choice',
  very_short_answer: 'Very short answer',
  short_answer: 'Short answer',
  long_answer: 'Long answer',
  case_study: 'Case study',
};

export const PYQ_REVIEW_STATUS_LABELS: Record<PyqQuestion['reviewStatus'], string> = {
  extracted: 'Needs review',
  reviewed: 'Edited',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const PYQ_PAPER_STATUS_LABELS: Record<PyqPaperStatus, string> = {
  uploaded: 'Uploaded',
  extracting: 'Extracting',
  needs_review: 'Needs review',
  published: 'Published',
  archived: 'Archived',
  extraction_failed: 'Extraction failed',
};

// ---- Phase 6: cluster review -------------------------------------------

export const PYQ_CLUSTER_STATUS_LABELS: Record<PyqClusterStatus, string> = {
  proposed: 'Needs review',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
};

export const PYQ_CLUSTER_METHOD_LABELS: Record<PyqCluster['method'], string> = {
  exact: 'Exact match',
  lexical: 'Similar wording',
  semantic: 'Similar meaning (AI)',
};

export interface PyqClusterQuery {
  status?: PyqClusterStatus | '';
  chapterId?: string;
}

export async function listPyqClusters(query: PyqClusterQuery = {}): Promise<PyqCluster[]> {
  const qs = listParams({ status: query.status, chapterId: query.chapterId });
  const data = await api<{ clusters: PyqCluster[] }>(`/admin/pyq/clusters${qs}`);
  return data.clusters;
}

export async function confirmPyqCluster(id: string): Promise<PyqClusterStatus> {
  const data = await api<{ id: string; status: PyqClusterStatus }>(`/admin/pyq/clusters/${id}/confirm`, { method: 'POST' });
  return data.status;
}

export async function rejectPyqCluster(id: string): Promise<PyqClusterStatus> {
  const data = await api<{ id: string; status: PyqClusterStatus }>(`/admin/pyq/clusters/${id}/reject`, { method: 'POST' });
  return data.status;
}
