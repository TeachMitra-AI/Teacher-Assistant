// Native port of client/src/lib/classroom.ts — Classroom Mode: what the
// client can actually build, and how it labels it. See docs/classroom-mode.md.
// Identical logic to the web version; only the import paths differ (the
// mobile api/resources.ts and api/client.ts already carry the same
// generateAssessment/generateAssessmentSet/generateLessonPlan/listResources/
// api contract the web lib built on).
import { api } from '../api/client';
import {
  generateAssessment,
  generateLessonPlan,
  listResources,
  type AssessmentFormat,
  type Difficulty,
  type GenerateAssessmentInput,
  type GenerateAssessmentResult,
  type GenerateLessonPlanInput,
  type GenerateSetInput,
  type QuestionType,
} from '../api/resources';
import type { ClassroomArtifact, ClassroomPlan, LibraryResource } from '../types';

// ---- Which artifacts can be generated TODAY --------------------------------
export const BUILDABLE_ARTIFACTS: ClassroomArtifact[] = [
  'lesson_plan', 'worksheet', 'quiz', 'homework', 'exit_ticket',
];

export const ARTIFACT_META: Record<ClassroomArtifact, { label: string; hint: string }> = {
  lesson_plan: { label: 'Lesson Plan', hint: 'A plan for teaching this in class' },
  worksheet: { label: 'Worksheet', hint: 'Practice questions for class, with an answer key' },
  quiz: { label: 'Quiz', hint: 'Questions that check understanding' },
  homework: { label: 'Homework', hint: 'Practice to do at home' },
  exit_ticket: { label: 'Exit Ticket', hint: 'A quick end-of-lesson check' },
};

// Per-artifact generation settings — mirrors the web's GENERATION_CONFIG
// exactly (counts/types/difficulty are the runtime authority's client half;
// see that file's comment for why they differ per artifact).
const GENERATION_CONFIG: Partial<Record<ClassroomArtifact, {
  format: AssessmentFormat;
  questionCount: number;
  questionType: QuestionType;
  difficulty: Difficulty;
}>> = {
  worksheet: { format: 'worksheet', questionCount: 8, questionType: 'mixed', difficulty: 'medium' },
  quiz: { format: 'quiz', questionCount: 10, questionType: 'mcq', difficulty: 'medium' },
  exit_ticket: { format: 'exit_ticket', questionCount: 3, questionType: 'mcq', difficulty: 'easy' },
  homework: { format: 'homework', questionCount: 6, questionType: 'mixed', difficulty: 'medium' },
};

/**
 * The artifacts we will actually attempt for a plan, in the planner's order.
 * An artifact the planner proposed but we cannot build yet is dropped silently.
 */
export function buildableFrom(plan: ClassroomPlan): ClassroomArtifact[] {
  return plan.artifacts.filter((a) => BUILDABLE_ARTIFACTS.includes(a));
}

/** Turn one planned artifact into a generation request. */
export function generationInputFor(
  artifact: ClassroomArtifact,
  plan: ClassroomPlan
): GenerateAssessmentInput | null {
  const config = GENERATION_CONFIG[artifact];
  if (!config) return null;
  return {
    format: config.format,
    topic: plan.topic,
    grade: plan.grade || undefined,
    subject: plan.subject || undefined,
    language: plan.language,
    difficulty: config.difficulty,
    questionType: config.questionType,
    questionCount: config.questionCount,
  };
}

/** Build the request for a lesson plan — not an assessment, no difficulty/count/type. */
export function lessonPlanInputFor(plan: ClassroomPlan): GenerateLessonPlanInput {
  return {
    topic: plan.topic,
    grade: plan.grade || undefined,
    subject: plan.subject || undefined,
    language: plan.language,
  };
}

/**
 * Generate one artifact, whichever endpoint it needs. Returns null for an
 * artifact that cannot be built, matching generationInputFor's contract.
 */
export function generateArtifact(
  artifact: ClassroomArtifact,
  plan: ClassroomPlan
): Promise<GenerateAssessmentResult> | null {
  if (artifact === 'lesson_plan') {
    return generateLessonPlan(lessonPlanInputFor(plan));
  }
  const input = generationInputFor(artifact, plan);
  return input ? generateAssessment(input) : null;
}

/**
 * Build the batched request for every question-shaped artifact in a plan —
 * one call for several artifacts instead of one call each (D10/2026-08-07).
 */
export function assessmentSetInputFor(plan: ClassroomPlan): GenerateSetInput | null {
  const items = buildableFrom(plan)
    .filter((a): a is Exclude<ClassroomArtifact, 'lesson_plan'> => a !== 'lesson_plan')
    .map((artifact) => {
      const config = GENERATION_CONFIG[artifact]!;
      return {
        format: config.format,
        difficulty: config.difficulty,
        questionType: config.questionType,
        questionCount: config.questionCount,
      };
    });

  if (items.length === 0) return null;

  return {
    topic: plan.topic,
    grade: plan.grade || undefined,
    subject: plan.subject || undefined,
    language: plan.language,
    items,
  };
}

/** Which artifact a batched result belongs to. */
export function artifactForFormat(format: AssessmentFormat): ClassroomArtifact | null {
  const match = (Object.keys(GENERATION_CONFIG) as ClassroomArtifact[]).find(
    (artifact) => GENERATION_CONFIG[artifact]?.format === format
  );
  return match ?? null;
}

/** Title for a saved artifact — same shape the Generator produces. */
export function artifactTitle(artifact: ClassroomArtifact, plan: ClassroomPlan): string {
  const label = ARTIFACT_META[artifact].label;
  const topic = plan.topic.trim() || 'Untitled';
  const grade = plan.grade.trim() ? ` (${plan.grade.trim()})` : '';
  return `${label}: ${topic}${grade}`.slice(0, 200);
}

// ---- Persisting a turn's generated artifacts (D25) --------------------------

/** artifact kind -> rendered Markdown. */
export type StoredArtifacts = Partial<Record<ClassroomArtifact, string>>;

export async function loadStoredArtifacts(queryId: string): Promise<StoredArtifacts> {
  const data = await api<{ artifacts: StoredArtifacts }>(`/queries/${queryId}/classroom-artifacts`);
  return data.artifacts || {};
}

export async function storeArtifacts(queryId: string, artifacts: StoredArtifacts): Promise<void> {
  await api(`/queries/${queryId}/classroom-artifacts`, { method: 'PUT', body: { artifacts } });
}

// ---- Which of a set's artifacts are already in the Library -----------------

/** artifact kind -> id of the Library resource it was saved as. */
export type SavedArtifactIds = Partial<Record<ClassroomArtifact, string>>;

export function savedArtifactIds(resources: LibraryResource[]): SavedArtifactIds {
  const out: SavedArtifactIds = {};
  for (const r of resources) {
    if (!r.structured) continue;
    let meta: { format?: string; source?: string };
    try {
      meta = JSON.parse(r.structured);
    } catch {
      continue;
    }
    if (meta?.source !== 'classroom_mode') continue;
    const format = meta.format as ClassroomArtifact | undefined;
    if (!format || !(format in ARTIFACT_META)) continue;
    if (!out[format]) out[format] = r.id;
  }
  return out;
}

/** The saved ids for one turn, or an empty map when the turn was never saved. */
export async function loadSavedArtifactIds(queryId: string): Promise<SavedArtifactIds> {
  const resources = await listResources({ sourceQueryId: queryId });
  return savedArtifactIds(resources);
}
