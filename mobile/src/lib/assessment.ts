// Ported verbatim from client/src/lib/assessment.ts (docs/mobile-app-plan.md
// §9) — pure string logic, only the import path differs (none, here).
//
// Answer-key separation is deliberately structural, not visual: the generator
// emits the answer key as the LAST Markdown section under a canonical heading
// ("## Answer Key" for quizzes, "## Teacher Answer Key" for worksheets). We
// split on that heading so a student export can render ONLY the questions
// half — the answer key is never inserted into the student document, so it
// cannot leak.

// Matches an answer-key heading at any Markdown heading level, case-insensitive,
// tolerating "Teacher Answer Key" and "Answer Keys". Anchored to the start of a
// line so it never matches the phrase mid-sentence inside a question.
const ANSWER_KEY_HEADING = /^\s{0,3}#{1,6}\s*(?:teacher(?:'s)?\s+)?answer\s*keys?\b.*$/im;

export interface SplitAssessment {
  /** Student-facing content: everything before the answer-key heading. */
  questions: string;
  /** The answer-key section (heading + body), or '' if none was found. */
  answerKey: string;
  /** Whether a recognizable answer-key section is present. */
  hasAnswerKey: boolean;
}

// Matches the generator's own document preamble: a leading "# Title" line
// followed by the "**Grade:** ..."-style metadata lines (and blank lines), up
// to but not including the first "##" section heading. On an exam paper this
// information lives in the letterhead (ExamHeader) — showing the preamble too
// would print the title and metadata twice. Content the teacher has
// hand-edited away from this exact shape is returned unchanged — stripping is
// display-only and must never guess.
const GENERATED_PREAMBLE = /^\s*# [^\n]+\n(?:\s*\n|\*\*[^\n]+\n)*(?=\s{0,3}##\s)/;

/**
 * Removes the generated title/metadata preamble from an assessment's Markdown
 * for display alongside the exam-paper letterhead (which already presents the
 * same information). The stored content is never modified.
 */
export function stripAssessmentPreamble(markdown: string): string {
  const text = markdown ?? '';
  return text.replace(GENERATED_PREAMBLE, '');
}

export function splitAnswerKey(markdown: string): SplitAssessment {
  const text = markdown ?? '';
  const match = ANSWER_KEY_HEADING.exec(text);
  if (!match || match.index === undefined) {
    return { questions: text, answerKey: '', hasAnswerKey: false };
  }
  const questions = text.slice(0, match.index).trimEnd();
  const answerKey = text.slice(match.index).trim();
  return { questions, answerKey, hasAnswerKey: answerKey.length > 0 };
}
