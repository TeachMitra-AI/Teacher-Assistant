// Typed client for the My Library resource API. Thin wrappers over api() so
// pages/components don't hand-build request shapes. Ownership is enforced
// server-side from the auth token — nothing here sends a userId.
import { api } from '../api';
import type { LibraryResource, ResourceType } from '../types';

export interface CreateResourceInput {
  type: ResourceType;
  title: string;
  grade?: string;
  subject?: string;
  language?: string;
  content?: string;
  structured?: string;
  sourceQueryId?: string;
}

export interface ListResourcesParams {
  type?: ResourceType | '';
  q?: string;
  /** Only resources saved from this query/turn. Used by Classroom Mode to tell
   *  which of a set's artifacts are already in the library. */
  sourceQueryId?: string;
}

export async function listResources(params: ListResourcesParams = {}): Promise<LibraryResource[]> {
  const search = new URLSearchParams();
  if (params.type) search.set('type', params.type);
  if (params.q) search.set('q', params.q);
  if (params.sourceQueryId) search.set('sourceQueryId', params.sourceQueryId);
  const qs = search.toString();
  const data = await api<{ resources: LibraryResource[] }>(`/resources${qs ? `?${qs}` : ''}`);
  return data.resources;
}

export async function getResource(id: string): Promise<LibraryResource> {
  const data = await api<{ resource: LibraryResource }>(`/resources/${id}`);
  return data.resource;
}

export async function createResource(input: CreateResourceInput): Promise<LibraryResource> {
  const data = await api<{ resource: LibraryResource }>('/resources', { method: 'POST', body: input });
  return data.resource;
}

// Fields the workspace can edit. Every field is optional (PATCH semantics) but
// the server requires at least one. Ownership is enforced server-side from the
// token — nothing here sends a userId.
export interface UpdateResourceInput {
  type?: ResourceType;
  title?: string;
  grade?: string;
  subject?: string;
  language?: string;
  content?: string;
  structured?: string;
}

export async function updateResource(id: string, input: UpdateResourceInput): Promise<LibraryResource> {
  const data = await api<{ resource: LibraryResource }>(`/resources/${id}`, { method: 'PATCH', body: input });
  return data.resource;
}

// AI workspace action ids the server understands (see server/src/routes/resources.js).
// Generic actions apply to any resource; the *_ assessment actions are surfaced
// only for assessments (quizzes / worksheets) in the workspace.
export type AiActionId =
  | 'simplify'
  | 'add_activities'
  | 'add_assessment'
  | 'adapt_grade'
  | 'make_easier'
  | 'make_harder'
  | 'more_questions'
  | 'simplify_wording';

export interface AiActionResult {
  suggestion: string;
  // Structured Question Model (Generator v2) — present only for the 4
  // assessment-only actions (make_easier/make_harder/more_questions/
  // simplify_wording) on a resource whose structured.questions is already
  // native (schemaVersion 2). Applying a suggestion for such a resource
  // should update BOTH `suggestion` (display) and this field (the editor's
  // source of truth) together, so structured.questions can never go stale
  // relative to what's shown — see docs/generator-v2-plan.md §2f.
  structured?: string;
  requestId: string;
}

// Ask the server to generate a suggested revision for a resource. The server
// keeps the AI key server-side and never persists the suggestion — the client
// decides whether to Apply it. `targetGrade` is only used by 'adapt_grade'.
export async function runAiAction(
  id: string,
  action: AiActionId,
  options: { targetGrade?: string } = {}
): Promise<AiActionResult> {
  return api<AiActionResult>(`/resources/${id}/ai-action`, {
    method: 'POST',
    body: { action, ...(options.targetGrade ? { targetGrade: options.targetGrade } : {}) },
  });
}

export async function deleteResource(id: string): Promise<void> {
  await api(`/resources/${id}`, { method: 'DELETE' });
}

// --- Quiz / Worksheet Generator ---
// Must match FORMATS in server/src/actions/schemas/generateAssessment.js — the
// runtime authority. Pinned by the pair-B drift test in
// server/test/assistant/contractDrift.test.js via ASSESSMENT_FORMATS.
export type AssessmentFormat = 'quiz' | 'worksheet' | 'exit_ticket' | 'homework';
export type Difficulty = 'easy' | 'medium' | 'hard';
// 'descriptive'/'fill_blank'/'match' are the Structured Question Model's three
// new types (docs/generator-v2-plan.md), gated server-side by
// STRUCTURED_QUESTIONS_ENABLED; 'mixed' stays a request-only modifier.
export type QuestionType =
  | 'mcq' | 'true_false' | 'short_answer' | 'descriptive' | 'fill_blank' | 'match' | 'mixed';

// --- Structured Question Model (Generator v2) --------------------------------
// One typed union per question, mirroring server/src/lib/assessmentSchema.js's
// questionSchema exactly (which validates a single flat shape with
// always-present-but-empty-when-N/A fields — see docs/generator-v2-plan.md).
// `id` is client-only: never sent to Gemini, never validated server-side
// beyond "the structured JSON round-trips" — it exists purely so the editor
// can key a reorderable/deletable list without relying on array index.
// See client/src/lib/structuredQuestions.ts for the (de)serialization and
// validation logic built on these types.
export interface QuestionBase {
  id: string;
  text: string;
}
export interface McqQuestion extends QuestionBase {
  type: 'mcq';
  options: string[];
  correctOptionIndex: number;
}
export interface TrueFalseQuestion extends QuestionBase {
  type: 'true_false';
  correctAnswer: 'True' | 'False';
}
export interface ShortAnswerQuestion extends QuestionBase {
  type: 'short_answer';
  correctAnswer: string;
}
export interface DescriptiveQuestion extends QuestionBase {
  type: 'descriptive';
  modelAnswer: string;
}
export interface FillBlankQuestion extends QuestionBase {
  type: 'fill_blank';
  correctAnswer: string;
}
export interface MatchPair {
  left: string;
  right: string;
}
export interface MatchQuestion extends QuestionBase {
  type: 'match';
  pairs: MatchPair[];
}
export type Question =
  | McqQuestion
  | TrueFalseQuestion
  | ShortAnswerQuestion
  | DescriptiveQuestion
  | FillBlankQuestion
  | MatchQuestion;

// The shape stored in Resource.structured once a resource has native
// structured questions — additive keys alongside the flat generator config
// this column already carried (format/difficulty/questionType/questionCount/
// topic/examMeta). `schemaVersion: 2`'s presence is the ONLY thing that marks
// a resource as "structured" anywhere in the app, client or server —
// its absence means "legacy, markdown-only", permanently (no backfill,
// no migration path — see docs/generator-v2-plan.md §6).
export interface StructuredAssessmentDocument {
  schemaVersion: 2;
  instructions: string;
  questions: Question[];
  format?: AssessmentFormat;
  topic?: string;
  grade?: string;
  subject?: string;
  difficulty?: Difficulty;
  questionType?: QuestionType;
  questionCount?: number;
  // Opaque here — ResourceWorkspace/GeneratorPage own the real ExamPaperMeta
  // type and merge it back in; this module only needs to round-trip it.
  examMeta?: unknown;
}

export interface GenerateAssessmentInput {
  format: AssessmentFormat;
  grade?: string;
  subject?: string;
  topic: string;
  difficulty: Difficulty;
  questionType: QuestionType;
  questionCount: number;
  language?: string;
  instructions?: string;
}

export interface GenerateAssessmentResult {
  content: string;
  // Structured Question Model (Generator v2) — present only when the request
  // resolved to a document Zod could validate as {instructions, questions[]},
  // as a JSON string ready to pass straight into createResource's/
  // updateResource's own `structured` field. Absent/undefined for any caller
  // that predates this (every one before this shipped) — a pure additive
  // field, never required.
  structured?: string;
  requestId: string;
}

// Ask the server to generate a quiz/worksheet. The Gemini key stays server-side
// and the result is NEVER persisted by this call — the teacher saves it
// explicitly with createResource (type "assessment").
export async function generateAssessment(input: GenerateAssessmentInput): Promise<GenerateAssessmentResult> {
  return api<GenerateAssessmentResult>('/resources/generate', { method: 'POST', body: input });
}

// --- Batched assessment generation (Classroom Mode) ---
// One call for several question-shaped artifacts instead of one call each.
// Classroom Mode cost 7 Gemini calls per question; the free tier allows 20 a
// minute, so three questions throttled a teacher. This takes it to 4.
// Must match generateAssessmentSetSchema in
// server/src/actions/schemas/generateAssessmentSet.js.
export interface GenerateSetItem {
  format: AssessmentFormat;
  difficulty: Difficulty;
  questionType: QuestionType;
  questionCount: number;
}

export interface GenerateSetInput {
  topic: string;
  grade?: string;
  subject?: string;
  language?: string;
  instructions?: string;
  items: GenerateSetItem[];
}

// Per-artifact outcome. `content` and `error` are exclusive: the server
// returns whatever succeeded even when one artifact could not be produced, so
// a single failure never costs the teacher the rest of the set.
export interface GenerateSetResult {
  format: AssessmentFormat;
  content: string | null;
  // Structured Question Model (Generator v2) — same shape/meaning as
  // GenerateAssessmentResult.structured, per succeeded artifact.
  structured: string | null;
  error: string | null;
}

export async function generateAssessmentSet(
  input: GenerateSetInput
): Promise<{ results: GenerateSetResult[]; requestId: string }> {
  return api('/resources/generate-set', { method: 'POST', body: input });
}

// --- Lesson Plan (Classroom Mode P6) ---
// A separate endpoint, not a fourth assessment format: a lesson plan has no
// questions and no answer key. See server/src/lib/lessonPlanSchema.js (D21).
// Must match generateLessonPlanSchema in
// server/src/actions/schemas/generateLessonPlan.js.
export type LessonDuration = '30 minutes' | '35 minutes' | '40 minutes' | '45 minutes' | '60 minutes';
export type ClassroomType = 'standard' | 'multi_grade' | 'large_class' | 'mixed_ability';

export interface GenerateLessonPlanInput {
  topic: string;
  grade?: string;
  subject?: string;
  language?: string;
  duration?: LessonDuration;
  classroomType?: ClassroomType;
  instructions?: string;
}

// Same contract as generateAssessment: nothing is persisted by this call — the
// teacher saves it explicitly with createResource (type "lesson_plan").
export async function generateLessonPlan(
  input: GenerateLessonPlanInput
): Promise<GenerateAssessmentResult> {
  return api<GenerateAssessmentResult>('/resources/generate-lesson-plan', { method: 'POST', body: input });
}
