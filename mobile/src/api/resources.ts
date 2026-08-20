// Ported from client/src/lib/resources.ts (docs/mobile-app-plan.md §9) —
// identical logic, only the import paths changed. Ownership is enforced
// server-side from the auth token — nothing here sends a userId.
import { api } from './client';
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
export type QuestionType = 'mcq' | 'true_false' | 'short_answer' | 'mixed';

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
  error: string | null;
}

export async function generateAssessmentSet(
  input: GenerateSetInput
): Promise<{ results: GenerateSetResult[]; requestId: string }> {
  return api('/resources/generate-set', { method: 'POST', body: input });
}

// --- Lesson Plan (Classroom Mode P6) ---
// A separate endpoint, not a fourth assessment format: a lesson plan has no
// questions and no answer key. Must match generateLessonPlanSchema in
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
