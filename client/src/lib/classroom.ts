// Classroom Mode: what the client can build and how it labels it (docs/classroom-mode.md).
import { api } from '../api';
import type { ClassroomArtifact, ClassroomPlan, LibraryResource } from '../types';
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
} from './resources';

// ---- Which artifacts can be generated today ----
// The planner (server/src/lib/classroomPlan.js) offers all five artifacts; this is the filter for what we can actually
// make. Shipping another artifact means adding an entry here and its generation config below.
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

// Per-artifact generation settings; only buildable artifacts appear. Counts differ on purpose (a worksheet, quiz and exit
// ticket aren't the same size), so not everything defaults to QUESTION_COUNT_DEFAULT.
const GENERATION_CONFIG: Partial<Record<ClassroomArtifact, {
  format: AssessmentFormat;
  questionCount: number;
  questionType: QuestionType;
  difficulty: Difficulty;
}>> = {
  worksheet: { format: 'worksheet', questionCount: 8, questionType: 'mixed', difficulty: 'medium' },
  quiz: { format: 'quiz', questionCount: 10, questionType: 'mcq', difficulty: 'medium' },
  // Three easy MCQs: an exit ticket is answered in the last two minutes, so it must be quick to answer and to scan.
  // Easy on purpose; it checks whether the core idea landed. 3 is also the server's MIN_QUESTIONS.
  exit_ticket: { format: 'exit_ticket', questionCount: 3, questionType: 'mcq', difficulty: 'easy' },
  // Fewer than the worksheet and not harder: homework is done alone with nobody to ask, so a long or hard set gets copied.
  // `mixed` avoids eight identical drill sums; `medium` matches the worksheet since it consolidates today's lesson.
  homework: { format: 'homework', questionCount: 6, questionType: 'mixed', difficulty: 'medium' },
};

// The artifacts we'll attempt for a plan, in the planner's order. One we can't build yet is dropped silently, so a
// teacher never sees a card that can't finish.
export function buildableFrom(plan: ClassroomPlan): ClassroomArtifact[] {
  return plan.artifacts.filter((a) => BUILDABLE_ARTIFACTS.includes(a));
}

// Turns one planned artifact into a generation request. Topic, grade, subject and language come from the server's merged
// plan, so the Context Bar's precedence is already applied.
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

// Request for a lesson plan. Separate from generationInputFor since a plan has no difficulty, question count or type.
// `duration` and `classroomType` use server defaults: the planner doesn't infer them yet, and guessing "multi_grade"
// would build a plan for a classroom the teacher doesn't have.
export function lessonPlanInputFor(plan: ClassroomPlan): GenerateLessonPlanInput {
  return {
    topic: plan.topic,
    grade: plan.grade || undefined,
    subject: plan.subject || undefined,
    language: plan.language,
  };
}

// Generates one artifact from whichever endpoint it needs, so useClassroomQueue (concurrency, cancellation, per-card
// state) never learns lesson plans go elsewhere. Returns null for an artifact that can't be built, like generationInputFor.
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

// Builds the batched request for every question-shaped artifact in a plan. Shared fields are sent once and per-artifact
// settings ride in `items` (the token saving), mirroring GENERATION_CONFIG. Returns null if nothing is batchable, so
// the caller skips a request the server would reject.
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

// Which artifact a batched result belongs to. Format and artifact kind are currently the same string; asserting it here
// means a future artifact with a different format fails loudly instead of filling the wrong card.
export function artifactForFormat(format: AssessmentFormat): ClassroomArtifact | null {
  const match = (Object.keys(GENERATION_CONFIG) as ClassroomArtifact[]).find(
    (artifact) => GENERATION_CONFIG[artifact]?.format === format
  );
  return match ?? null;
}

// Title for a saved artifact, same shape as the Generator's.
export function artifactTitle(artifact: ClassroomArtifact, plan: ClassroomPlan): string {
  const label = ARTIFACT_META[artifact].label;
  const topic = plan.topic.trim() || 'Untitled';
  const grade = plan.grade.trim() ? ` (${plan.grade.trim()})` : '';
  return `${label}: ${topic}${grade}`.slice(0, 200);
}

// ---- Persisting a turn's generated artifacts ----
// Nothing auto-saves to the Library; Save is what puts a document there. This keeps the chat turn itself intact so
// reopening it shows what was made. Stored per turn by artifact kind, and never listed in the history query
// (see server/src/routes/queries.js).

/** artifact kind -> rendered Markdown. */
export type StoredArtifacts = Partial<Record<ClassroomArtifact, string>>;

export async function loadStoredArtifacts(queryId: string): Promise<StoredArtifacts> {
  const data = await api<{ artifacts: StoredArtifacts }>(`/queries/${queryId}/classroom-artifacts`);
  return data.artifacts || {};
}

export async function storeArtifacts(queryId: string, artifacts: StoredArtifacts): Promise<void> {
  await api(`/queries/${queryId}/classroom-artifacts`, { method: 'PUT', body: { artifacts } });
}

// ---- Which of a set's artifacts are already in the Library ----
// A card's "Saved" state used to live only in component state, so reopening a turn offered to save the same quiz again
// (nothing on the server de-dupes). It's derived from the Library instead of stored twice, so deleting the quiz makes the
// card offer to save it again. The link is the `structured` blob written on save ({ format, topic, source: 'classroom_mode' })
// plus `sourceQueryId`; older resources don't match and just show as unsaved.

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
      // Not JSON, so not one of ours.
      continue;
    }
    if (meta?.source !== 'classroom_mode') continue;
    const format = meta.format as ClassroomArtifact | undefined;
    if (!format || !(format in ARTIFACT_META)) continue;
    // Newest first; keep the first match so a card saved twice points at the latest copy.
    if (!out[format]) out[format] = r.id;
  }
  return out;
}

/** The saved ids for one turn, or an empty map when the turn was never saved. */
export async function loadSavedArtifactIds(queryId: string): Promise<SavedArtifactIds> {
  const resources = await listResources({ sourceQueryId: queryId });
  return savedArtifactIds(resources);
}
