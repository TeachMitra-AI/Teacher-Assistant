// Structured Question Model (Generator v2) — pure domain logic over the
// `Question`/`StructuredAssessmentDocument` types in ./resources.
//
// This module is the client-side mirror of server/src/lib/assessmentSchema.js
// and the structured-question handling in server/src/routes/resources.js
// (see docs/generator-v2-plan.md). It deliberately does NOT talk to the
// network — GeneratorPage.tsx/ResourceWorkspace.tsx own the API calls and use
// these functions to translate between the wire/storage shape (a flat object
// with every field present, empty when not applicable — the server's own
// convention) and a friendlier discriminated union for the editor UI.
//
// Validation here is a UX nicety only (an inline error before a network round
// trip) — the server's Zod schema is always the final authority, exactly
// like every other form in this app.
import { QUESTION_TYPES } from '../config';
import type {
  DescriptiveQuestion,
  FillBlankQuestion,
  MatchPair,
  MatchQuestion,
  McqQuestion,
  Question,
  QuestionType,
  ShortAnswerQuestion,
  StructuredAssessmentDocument,
  TrueFalseQuestion,
} from './resources';

// The picker vocabulary for an INDIVIDUAL question's type. 'mixed' is a
// generation-REQUEST modifier only (server/src/actions/schemas/
// generateAssessment.js's own comment) — no single question is ever "mixed".
export const EDITABLE_QUESTION_TYPES = QUESTION_TYPES.filter((q) => q.value !== 'mixed');

// Mirrors server/src/lib/assessmentSchema.js's bounds exactly — keep both in
// sync, same "change together" discipline as every other shared vocabulary in
// this app (see config.ts's own comments on QUESTION_TYPES/ASSESSMENT_FORMATS).
export const MIN_MATCH_PAIRS = 3;
export const MAX_MATCH_PAIRS = 8;
export const MAX_MODEL_ANSWER = 2000;
export const BLANK_MARKER_RE = /_{3,}/;

function makeQuestionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** A fresh, empty question of the given type, ready to drop into an editor list. */
export function createEmptyQuestion(type: QuestionType): Question {
  const id = makeQuestionId();
  switch (type) {
    case 'mcq':
      return { id, type: 'mcq', text: '', options: ['', '', '', ''], correctOptionIndex: 0 };
    case 'true_false':
      return { id, type: 'true_false', text: '', correctAnswer: 'True' };
    case 'descriptive':
      return { id, type: 'descriptive', text: '', modelAnswer: '' };
    case 'fill_blank':
      return { id, type: 'fill_blank', text: '', correctAnswer: '' };
    case 'match':
      return {
        id,
        type: 'match',
        text: '',
        pairs: [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }],
      };
    case 'short_answer':
    case 'mixed': // never a real question type; falls back like an unrecognized value would
    default:
      return { id, type: 'short_answer', text: '', correctAnswer: '' };
  }
}

/**
 * Parses one raw question object (from a generate response or a saved
 * resource's `structured.questions`) into the typed union. Tolerant of
 * missing/malformed fields — never throws, since it may be reading a
 * hand-edited or older payload; falls back to sensible empty values.
 */
export function fromWireQuestion(raw: unknown): Question {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const id = typeof r.id === 'string' && r.id ? r.id : makeQuestionId();
  const text = typeof r.text === 'string' ? r.text : '';
  const type = typeof r.type === 'string' ? r.type : 'short_answer';

  if (type === 'mcq') {
    const rawOptions = Array.isArray(r.options) ? r.options.map((o) => (typeof o === 'string' ? o : '')) : [];
    const options = [...rawOptions];
    while (options.length < 4) options.push('');
    const correctOptionIndex = typeof r.correctOptionIndex === 'number' && r.correctOptionIndex >= 0 && r.correctOptionIndex <= 3
      ? r.correctOptionIndex
      : 0;
    return { id, type: 'mcq', text, options: options.slice(0, 4), correctOptionIndex };
  }
  if (type === 'true_false') {
    const norm = typeof r.correctAnswer === 'string' && r.correctAnswer.trim().toLowerCase() === 'false' ? 'False' : 'True';
    return { id, type: 'true_false', text, correctAnswer: norm };
  }
  if (type === 'descriptive') {
    return { id, type: 'descriptive', text, modelAnswer: typeof r.modelAnswer === 'string' ? r.modelAnswer : '' };
  }
  if (type === 'fill_blank') {
    return { id, type: 'fill_blank', text, correctAnswer: typeof r.correctAnswer === 'string' ? r.correctAnswer : '' };
  }
  if (type === 'match') {
    const rawPairs = Array.isArray(r.pairs) ? r.pairs : [];
    const pairs: MatchPair[] = rawPairs.map((p) => {
      const pr = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
      return { left: typeof pr.left === 'string' ? pr.left : '', right: typeof pr.right === 'string' ? pr.right : '' };
    });
    return {
      id,
      type: 'match',
      text,
      pairs: pairs.length > 0 ? pairs : [{ left: '', right: '' }, { left: '', right: '' }, { left: '', right: '' }],
    };
  }
  // short_answer, and any unrecognized/legacy type, falls back to short_answer.
  return { id, type: 'short_answer', text, correctAnswer: typeof r.correctAnswer === 'string' ? r.correctAnswer : '' };
}

/**
 * Inverse of fromWireQuestion — the flat shape the server's schema expects
 * (every field present, empty/-1 when not applicable), matching
 * server/src/lib/assessmentSchema.js's questionSchema exactly. `id` is kept
 * (the server ignores unknown keys when validating, but stores the raw JSON
 * string as-is, so it survives — see routes/resources.js's toDto/create/
 * update handlers) so the editor keeps stable list keys across a save+reload.
 */
export function toWireQuestion(q: Question): Record<string, unknown> {
  const base = {
    id: q.id,
    type: q.type,
    text: q.text,
    options: [] as string[],
    correctOptionIndex: -1,
    correctAnswer: '',
    modelAnswer: '',
    pairs: [] as MatchPair[],
  };
  switch (q.type) {
    case 'mcq':
      return { ...base, options: q.options, correctOptionIndex: q.correctOptionIndex };
    case 'true_false':
    case 'short_answer':
    case 'fill_blank':
      return { ...base, correctAnswer: q.correctAnswer };
    case 'descriptive':
      return { ...base, modelAnswer: q.modelAnswer };
    case 'match':
      return { ...base, pairs: q.pairs };
    default:
      return base;
  }
}

/**
 * Parses `Resource.structured` (a JSON string) into a
 * StructuredAssessmentDocument, or null for anything that isn't
 * `schemaVersion: 2` with a `questions` array — mirrors the server's
 * `tryReadStructuredQuestions` (routes/resources.js) exactly, so client and
 * server always agree on what counts as "this resource has structured
 * questions". A legacy resource (no schemaVersion, or a malformed/missing
 * `structured`) always returns null here — the caller falls back to the
 * flat markdown editor, unchanged (see docs/generator-v2-plan.md §5/§6).
 */
export function parseStructuredDocument(structuredStr: string | null | undefined): StructuredAssessmentDocument | null {
  if (!structuredStr) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(structuredStr);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.schemaVersion !== 2 || !Array.isArray(r.questions)) return null;

  return {
    schemaVersion: 2,
    instructions: typeof r.instructions === 'string' ? r.instructions : '',
    questions: r.questions.map(fromWireQuestion),
    format: typeof r.format === 'string' ? (r.format as StructuredAssessmentDocument['format']) : undefined,
    topic: typeof r.topic === 'string' ? r.topic : undefined,
    grade: typeof r.grade === 'string' ? r.grade : undefined,
    subject: typeof r.subject === 'string' ? r.subject : undefined,
    difficulty: typeof r.difficulty === 'string' ? (r.difficulty as StructuredAssessmentDocument['difficulty']) : undefined,
    questionType: typeof r.questionType === 'string' ? (r.questionType as QuestionType) : undefined,
    questionCount: typeof r.questionCount === 'number' ? r.questionCount : undefined,
    examMeta: r.examMeta,
  };
}

/**
 * Builds the `structured` JSON string to send on save/edit — the same shape
 * parseStructuredDocument reads back. The server re-renders `content` from
 * this itself (docs/generator-v2-plan.md §2c) — the client never computes
 * the printable Markdown from a structured document.
 */
export function buildStructuredPayload(doc: Omit<StructuredAssessmentDocument, 'schemaVersion'>): string {
  return JSON.stringify({ ...doc, schemaVersion: 2, questions: doc.questions.map(toWireQuestion) });
}

/** One question's validation error, or null if it's ready to save. */
export function validateQuestion(q: Question): string | null {
  if (!q.text.trim()) return 'Question text is required.';

  if (q.type === 'mcq') {
    if (q.options.length !== 4 || q.options.some((o) => !o.trim())) return 'All 4 options are required.';
    if (q.correctOptionIndex < 0 || q.correctOptionIndex > 3) return 'Select the correct option.';
    return null;
  }
  if (q.type === 'short_answer') {
    return q.correctAnswer.trim() ? null : 'A correct answer is required.';
  }
  if (q.type === 'descriptive') {
    if (!q.modelAnswer.trim()) return 'A model answer is required.';
    if (q.modelAnswer.length > MAX_MODEL_ANSWER) return `Model answer must be ${MAX_MODEL_ANSWER} characters or fewer.`;
    return null;
  }
  if (q.type === 'fill_blank') {
    if (!BLANK_MARKER_RE.test(q.text)) return 'The question text must contain a blank, written as three or more underscores (___).';
    return q.correctAnswer.trim() ? null : 'The answer for the blank is required.';
  }
  if (q.type === 'match') {
    if (q.pairs.length < MIN_MATCH_PAIRS || q.pairs.length > MAX_MATCH_PAIRS) {
      return `Match questions need between ${MIN_MATCH_PAIRS} and ${MAX_MATCH_PAIRS} pairs.`;
    }
    if (q.pairs.some((p) => !p.left.trim() || !p.right.trim())) return 'Every pair needs both a left and right value.';
    const leftValues = q.pairs.map((p) => p.left.trim().toLowerCase());
    if (new Set(leftValues).size !== leftValues.length) return 'Left-hand values must be unique.';
    return null;
  }
  // true_false always has a valid correctAnswer (toggle, never free text).
  return null;
}

/** Validates every question, returning a map of question id -> error message (only for invalid questions; empty object means the whole list is save-ready). */
export function validateQuestions(questions: Question[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const q of questions) {
    const err = validateQuestion(q);
    if (err) errors[q.id] = err;
  }
  return errors;
}

// Re-exported so callers only need one import for the common pair.
export type { DescriptiveQuestion, FillBlankQuestion, MatchQuestion, McqQuestion, ShortAnswerQuestion, TrueFalseQuestion };
