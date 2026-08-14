// Pure PYQ-mode form logic for GeneratorPage.tsx — Phase 9
// (docs/pyq-implementation-plan.md §15). Mirrors assistant/generatorPrefill.ts's
// own shape: every DOM/React-free decision the page needs (taxonomy
// derivation, validation, request building) lives here as a plain function,
// so it is fully unit-testable without rendering anything. This project has
// no @testing-library/react and no precedent for rendering a page component
// in a test (confirmed against Phase 4-7's own admin PYQ pages, none of
// which are component-tested) — extracting logic this way is how Phase 9
// gets real test coverage without introducing new test infrastructure.
import type { PyqClassLevel, PyqQuestionType, PyqTaxonomyBoard, PyqTaxonomySubject } from '../types';
import type { GeneratePyqInput } from './resources';
import { PYQ_TOTAL_MARKS_DEFAULT, PYQ_QUESTION_COUNT_DEFAULT } from '../config';

/** The PYQ half of the generator form's state — everything handleGenerate needs to validate and submit. */
export interface PyqFormState {
  boardId: string;
  classLevel: string;
  subjectId: string;
  yearFrom: number | '';
  yearTo: number | '';
  totalMarks: number | '';
  questionCount: number | '';
  questionType: PyqQuestionType | '';
  prioritizeRecurring: boolean;
}

export const PYQ_FORM_DEFAULTS: PyqFormState = {
  boardId: '',
  classLevel: '',
  subjectId: '',
  yearFrom: '',
  yearTo: '',
  totalMarks: PYQ_TOTAL_MARKS_DEFAULT,
  questionCount: PYQ_QUESTION_COUNT_DEFAULT,
  questionType: '',
  prioritizeRecurring: false,
};

export function findBoard(boards: PyqTaxonomyBoard[], boardId: string): PyqTaxonomyBoard | undefined {
  return boards.find((b) => b.id === boardId);
}

/** Distinct class levels offered by one board, in the fixed PYQ_CLASS_LEVELS order (never alphabetic/insertion order). */
const CLASS_LEVEL_ORDER: PyqClassLevel[] = ['9', '10', '11', '12'];

export function classLevelsForBoard(boards: PyqTaxonomyBoard[], boardId: string): PyqClassLevel[] {
  const board = findBoard(boards, boardId);
  if (!board) return [];
  const present = new Set(board.subjects.map((s) => s.classLevel));
  return CLASS_LEVEL_ORDER.filter((c) => present.has(c));
}

export function subjectsForBoardAndClass(boards: PyqTaxonomyBoard[], boardId: string, classLevel: string): PyqTaxonomySubject[] {
  const board = findBoard(boards, boardId);
  if (!board || !classLevel) return [];
  return board.subjects.filter((s) => s.classLevel === classLevel);
}

export function findSubject(boards: PyqTaxonomyBoard[], boardId: string, subjectId: string): PyqTaxonomySubject | undefined {
  const board = findBoard(boards, boardId);
  return board?.subjects.find((s) => s.id === subjectId);
}

/** A freshly-selected subject's own published year range — a sensible starting yearFrom/yearTo, never invented. */
export function defaultYearRange(subject: PyqTaxonomySubject): { yearFrom: number; yearTo: number } {
  return { yearFrom: subject.yearRange[0], yearTo: subject.yearRange[1] };
}

/**
 * Every required PYQ field, checked in the same "first missing thing wins"
 * order a teacher fills the form top-to-bottom — mirrors handleGenerate's
 * own `if (!topic.trim())` early-validation shape for AI mode. Returns null
 * when the form is ready to submit.
 */
export function validatePyqForm(state: PyqFormState): string | null {
  if (!state.boardId) return 'Please select a board.';
  if (!state.classLevel) return 'Please select a class.';
  if (!state.subjectId) return 'Please select a subject.';
  if (state.yearFrom === '' || state.yearTo === '') return 'Please choose a year range.';
  if (Number(state.yearFrom) > Number(state.yearTo)) return 'The start year must not be after the end year.';
  if (state.totalMarks === '' || Number(state.totalMarks) < 1) return 'Please enter the total marks for the paper.';
  if (state.questionCount === '' || Number(state.questionCount) < 1) return 'Please enter the number of questions.';
  return null;
}

/**
 * Builds the exact generate-pyq request body. Only ever call this after
 * validatePyqForm(state) === null — it trusts the caller the same way
 * handleGenerate's own `input` object trusts `topic.trim()` having already
 * been checked non-empty.
 */
export function buildGeneratePyqInput(state: PyqFormState, language?: string): GeneratePyqInput {
  return {
    boardId: state.boardId,
    classLevel: state.classLevel as PyqClassLevel,
    subjectId: state.subjectId,
    yearFrom: Number(state.yearFrom),
    yearTo: Number(state.yearTo),
    totalMarks: Number(state.totalMarks),
    questionCount: Number(state.questionCount),
    ...(state.questionType ? { questionType: state.questionType } : {}),
    prioritizeRecurring: state.prioritizeRecurring,
    ...(language ? { language } : {}),
  };
}

/** Mirrors the title the server's own renderPyqMarkdown puts in the content's "# " heading, so the Library title matches what's inside the document. */
export function defaultPyqTitle(boardName: string, subjectName: string, classLevel: string): string {
  return `${subjectName} — Previous Year Questions (${boardName}, Class ${classLevel})`.slice(0, 200);
}
