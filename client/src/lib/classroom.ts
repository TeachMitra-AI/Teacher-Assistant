// Classroom Mode — what the client can actually build, and how it labels it.
// See docs/classroom-mode.md.
import type { ClassroomArtifact, ClassroomPlan } from '../types';
import type { AssessmentFormat, Difficulty, GenerateAssessmentInput, QuestionType } from './resources';

// ---- Which artifacts can be generated TODAY --------------------------------
//
// The planner (server/src/lib/classroomPlan.js) deliberately offers all five
// artifacts from the start: what a teacher's question NEEDS is a separate
// question from what we have built. This constant is the second half of that
// split — the filter that turns "what would help" into "what we can make".
//
// P4/P5/P6 ship by adding an entry here plus its generation config below.
// Nothing about the planner, the request, or the card UI changes.
export const BUILDABLE_ARTIFACTS: ClassroomArtifact[] = ['worksheet', 'quiz', 'exit_ticket'];

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

/** Title for a saved artifact — same shape the Generator produces. */
export function artifactTitle(artifact: ClassroomArtifact, plan: ClassroomPlan): string {
  const label = ARTIFACT_META[artifact].label;
  const topic = plan.topic.trim() || 'Untitled';
  const grade = plan.grade.trim() ? ` (${plan.grade.trim()})` : '';
  return `${label}: ${topic}${grade}`.slice(0, 200);
}
