// Typed client for the My Library resource API: thin wrappers over api(). Ownership is enforced server-side from the token;
// nothing here sends a userId.
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
  /** Only resources saved from this query/turn; Classroom Mode uses it to see which artifacts are already saved. */
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

// Fields the workspace can edit. All optional (PATCH), but the server requires at least one.
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

// AI workspace action ids the server understands (server/src/routes/resources.js). The *_ assessment actions are only
// surfaced for quizzes and worksheets.
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
  // Present only for the four assessment-only actions on a resource whose structured.questions is native (schemaVersion 2).
  // Applying such a suggestion must update both `suggestion` and this field so structured.questions can't go stale
  // (docs/generator-v2-plan.md).
  structured?: string;
  requestId: string;
}

// Asks the server for a suggested revision. The key stays server-side and the suggestion is never persisted; the client
// decides whether to Apply. `targetGrade` is only used by 'adapt_grade'.
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
// Must match FORMATS in server/src/actions/schemas/generateAssessment.js, the runtime authority (pinned by a drift test).
export type AssessmentFormat = 'quiz' | 'worksheet' | 'exit_ticket' | 'homework';
export type Difficulty = 'easy' | 'medium' | 'hard';
// 'descriptive'/'fill_blank'/'match' are the structured question types (docs/generator-v2-plan.md), gated server-side by
// STRUCTURED_QUESTIONS_ENABLED; 'mixed' is a request-only modifier.
export type QuestionType =
  | 'mcq' | 'true_false' | 'short_answer' | 'descriptive' | 'fill_blank' | 'match' | 'mixed';

// A teacher can tick several specific types. The server accepts a bare QuestionType (what a single selection sends) or a
// non-empty array; 'mixed' can't appear alongside another type.
export type QuestionTypeSelection = QuestionType | QuestionType[];

// --- Structured Question Model (Generator v2) ---
// One typed union per question, mirroring questionSchema in server/src/lib/assessmentSchema.js (a flat shape with
// always-present, empty-when-N/A fields; docs/generator-v2-plan.md). `id` is client-only, used to key a reorderable
// list without relying on array index. (De)serialization and validation live in lib/structuredQuestions.ts.
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

// Shape stored in Resource.structured once a resource has native structured questions, alongside the flat generator
// config. `schemaVersion: 2` is the only marker of "structured" anywhere; its absence means legacy markdown-only,
// permanently (docs/generator-v2-plan.md).
export interface StructuredAssessmentDocument {
  schemaVersion: 2;
  instructions: string;
  questions: Question[];
  format?: AssessmentFormat;
  topic?: string;
  grade?: string;
  subject?: string;
  difficulty?: Difficulty;
  questionType?: QuestionTypeSelection;
  questionCount?: number;
  // Opaque here: ResourceWorkspace/GeneratorPage own the ExamPaperMeta type; this module only round-trips it.
  examMeta?: unknown;
}

export interface GenerateAssessmentInput {
  format: AssessmentFormat;
  grade?: string;
  subject?: string;
  topic: string;
  difficulty: Difficulty;
  questionType: QuestionTypeSelection;
  questionCount: number;
  language?: string;
  instructions?: string;
}

export interface GenerateAssessmentResult {
  content: string;
  // Structured Question Model: present only when the result validated as {instructions, questions[]}, as a JSON string
  // to pass straight into createResource/updateResource's `structured`. Absent for older callers; never required.
  structured?: string;
  requestId: string;
}

// Asks the server to generate a quiz/worksheet. The key stays server-side and nothing is persisted; the teacher saves
// explicitly with createResource (type "assessment").
export async function generateAssessment(input: GenerateAssessmentInput): Promise<GenerateAssessmentResult> {
  return api<GenerateAssessmentResult>('/resources/generate', { method: 'POST', body: input });
}

// --- Batched assessment generation (Classroom Mode) ---
// One call for several question-shaped artifacts instead of one each (7 Gemini calls per question against a 20/min free
// tier throttled teachers; batching makes it 4). Must match generateAssessmentSetSchema in
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

// Per-artifact outcome. `content` and `error` are exclusive; the server returns whatever succeeded, so one failure
// doesn't cost the rest of the set.
export interface GenerateSetResult {
  format: AssessmentFormat;
  content: string | null;
  // Same as GenerateAssessmentResult.structured, per succeeded artifact.
  structured: string | null;
  error: string | null;
}

export async function generateAssessmentSet(
  input: GenerateSetInput
): Promise<{ results: GenerateSetResult[]; requestId: string }> {
  return api('/resources/generate-set', { method: 'POST', body: input });
}

// --- Lesson Plan (Classroom Mode) ---
// A separate endpoint, not a fourth assessment format: a plan has no questions or answer key
// (server/src/lib/lessonPlanSchema.js). Must match generateLessonPlanSchema in server/src/actions/schemas/generateLessonPlan.js.
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

// Same contract as generateAssessment: nothing persisted; the teacher saves with createResource (type "lesson_plan").
export async function generateLessonPlan(
  input: GenerateLessonPlanInput
): Promise<GenerateAssessmentResult> {
  return api<GenerateAssessmentResult>('/resources/generate-lesson-plan', { method: 'POST', body: input });
}
