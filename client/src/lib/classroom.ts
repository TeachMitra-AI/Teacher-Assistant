// Classroom Mode — what the client can actually build, and how it labels it.
// See docs/classroom-mode.md.
import { api } from '../api';
import type { ClassroomArtifact, ClassroomPlan } from '../types';
import {
  generateAssessment,
  generateLessonPlan,
  type AssessmentFormat,
  type Difficulty,
  type GenerateAssessmentInput,
  type GenerateAssessmentResult,
  type GenerateLessonPlanInput,
  type GenerateSetInput,
  type QuestionType,
} from './resources';

// ---- Which artifacts can be generated TODAY --------------------------------
//
// The planner (server/src/lib/classroomPlan.js) deliberately offers all five
// artifacts from the start: what a teacher's question NEEDS is a separate
// question from what we have built. This constant is the second half of that
// split — the filter that turns "what would help" into "what we can make".
//
// P4/P5/P6 ship by adding an entry here plus its generation config below.
// Nothing about the planner, the request, or the card UI changes.
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

// Per-artifact generation settings. Only the buildable ones appear; adding a
// row here plus one to BUILDABLE_ARTIFACTS is the whole of "ship a new
// artifact" on the client side.
//
// Counts differ on purpose — a worksheet a class works through is not the same
// size as a quiz, and an exit ticket (P4) will be smaller still. Defaulting all
// of them to QUESTION_COUNT_DEFAULT would produce five documents that are
// suspiciously identical in length.
const GENERATION_CONFIG: Partial<Record<ClassroomArtifact, {
  format: AssessmentFormat;
  questionCount: number;
  questionType: QuestionType;
  difficulty: Difficulty;
}>> = {
  worksheet: { format: 'worksheet', questionCount: 8, questionType: 'mixed', difficulty: 'medium' },
  quiz: { format: 'quiz', questionCount: 10, questionType: 'mcq', difficulty: 'medium' },
  // Three questions, MCQ, easy. An exit ticket is answered in the last two
  // minutes of a lesson by every student in the room — it has to be quick to
  // answer and quick for the teacher to scan. `easy` is deliberate: this checks
  // whether the core idea landed, and a hard question tells the teacher a
  // student found the hard question hard, which they already knew.
  //
  // 3 is also the server's MIN_QUESTIONS, so no bound needed relaxing.
  exit_ticket: { format: 'exit_ticket', questionCount: 3, questionType: 'mcq', difficulty: 'easy' },
  // Fewer questions than the worksheet's 8, and deliberately not harder.
  // Homework is done alone, after school, with nobody to ask — a set long
  // enough to become a chore is one that gets copied from a friend in the
  // morning, and difficulty that needs a hint is difficulty that needs a
  // teacher. `mixed` keeps it from being eight identical drill sums; `medium`
  // matches the worksheet because the point is consolidating what was taught
  // today, not stretching past it.
  homework: { format: 'homework', questionCount: 6, questionType: 'mixed', difficulty: 'medium' },
};

/**
 * The artifacts we will actually attempt for a plan, in the planner's order.
 * An artifact the planner proposed but we cannot build yet is dropped silently
 * — a teacher should never see a card that cannot finish.
 */
export function buildableFrom(plan: ClassroomPlan): ClassroomArtifact[] {
  return plan.artifacts.filter((a) => BUILDABLE_ARTIFACTS.includes(a));
}

/**
 * Turn one planned artifact into a generation request.
 *
 * Everything teacher-derived (topic, grade, subject, language) comes from the
 * merged plan the server produced, so the Context Bar's precedence (D8) is
 * already applied and is not re-decided here.
 */
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

/**
 * Build the request for a lesson plan (P6). Separate from generationInputFor
 * because a lesson plan is not an assessment — no difficulty, no question
 * count, no question type; a duration and a classroom shape instead.
 *
 * `duration` and `classroomType` take the server's defaults for now: the
 * planner does not yet infer either from the teacher's message, and guessing
 * "multi_grade" wrongly produces a plan built around a classroom the teacher
 * does not have. The server validates both, so adding them later is a client
 * change only.
 */
export function lessonPlanInputFor(plan: ClassroomPlan): GenerateLessonPlanInput {
  return {
    topic: plan.topic,
    grade: plan.grade || undefined,
    subject: plan.subject || undefined,
    language: plan.language,
  };
}

/**
 * Generate one artifact, whichever endpoint it needs.
 *
 * This exists so useClassroomQueue never learns that lesson plans go somewhere
 * different — the queue's job is concurrency, cancellation and per-card state,
 * and it was written before there were two endpoints. Adding P6's branch there
 * would have put routing knowledge in three places (the worker, the retry
 * path, and here); this keeps it in one.
 *
 * Returns null for an artifact that cannot be built, matching
 * generationInputFor's contract, so callers keep their existing guard.
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
 * Build the batched request for every question-shaped artifact in a plan.
 *
 * The shared fields (topic, grade, subject, language) are sent ONCE and the
 * per-artifact settings ride along in `items` — which is the whole token
 * saving, and why this mirrors GENERATION_CONFIG rather than re-deciding it.
 *
 * Returns null when the plan contains no batchable artifact, so the caller can
 * skip the request entirely rather than send an empty set the server rejects.
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

/**
 * Which artifact a batched result belongs to.
 *
 * `format` and artifact kind are the same string for every question-shaped
 * artifact — GENERATION_CONFIG maps each one to a format of the same name —
 * but that is a fact worth asserting in one place rather than assuming at
 * every call site, so a future artifact whose format differs from its kind
 * fails here instead of silently filling the wrong card.
 */
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
//
// D11 said nothing auto-saves. That still holds for the LIBRARY — pressing
// Save is what puts a document where a teacher goes looking for it. This is a
// different thing: keeping the chat turn itself intact, so reopening it shows
// what was already made instead of four model calls' worth of nothing.
//
// Stored per turn, keyed by artifact kind, never listed in the history query
// (see server/src/routes/queries.js for why that matters).

/** artifact kind -> rendered Markdown. */
export type StoredArtifacts = Partial<Record<ClassroomArtifact, string>>;

export async function loadStoredArtifacts(queryId: string): Promise<StoredArtifacts> {
  const data = await api<{ artifacts: StoredArtifacts }>(`/queries/${queryId}/classroom-artifacts`);
  return data.artifacts || {};
}

export async function storeArtifacts(queryId: string, artifacts: StoredArtifacts): Promise<void> {
  await api(`/queries/${queryId}/classroom-artifacts`, { method: 'PUT', body: { artifacts } });
}
