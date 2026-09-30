// Helpers for quiz/worksheet assessments. Answer-key separation is structural: the generator emits the key as the last
// Markdown section under a canonical heading ("## Answer Key" / "## Teacher Answer Key"), and we split on it so the student
// print renders only the questions and the key never enters that print DOM.

// Matches an answer-key heading at any level, case-insensitively, tolerating "Teacher Answer Key" and "Answer Keys". Anchored to
// line start so it doesn't match mid-sentence.
const ANSWER_KEY_HEADING = /^\s{0,3}#{1,6}\s*(?:teacher(?:'s)?\s+)?answer\s*keys?\b.*$/im;

export interface SplitAssessment {
  /** Student-facing content: everything before the answer-key heading. */
  questions: string;
  /** The answer-key section (heading + body), or '' if none was found. */
  answerKey: string;
  /** Whether a recognizable answer-key section is present. */
  hasAnswerKey: boolean;
}

// Matches the generator's preamble: a leading "# Title" plus "**Grade:** ..."-style metadata lines, up to the first "##".
// The exam letterhead (components/ExamHeader.tsx) already shows this, so printing it too repeated it. Hand-edited content
// that no longer has this shape is returned unchanged; stripping is display-only and never guesses.
const GENERATED_PREAMBLE = /^\s*# [^\n]+\n(?:\s*\n|\*\*[^\n]+\n)*(?=\s{0,3}##\s)/;

/** Strips the generated title/metadata preamble for display beside the letterhead. Stored content is untouched, since the server's AI-assist parser relies on the preamble. */
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
