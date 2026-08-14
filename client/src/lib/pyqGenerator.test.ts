import { describe, expect, test } from 'vitest';
import {
  PYQ_FORM_DEFAULTS,
  findBoard,
  classLevelsForBoard,
  subjectsForBoardAndClass,
  findSubject,
  defaultYearRange,
  validatePyqForm,
  buildGeneratePyqInput,
  defaultPyqTitle,
  type PyqFormState,
} from './pyqGenerator';
import type { PyqTaxonomyBoard } from '../types';

// Two boards, mirroring the real MVP taxonomy shape (§14): CBSE offers Class
// 10 Mathematics AND Class 9 Science (two different subjects/classLevels
// under one board, exercising the Board -> Class -> Subject derivation
// properly rather than a corpus that happens to have only one class), Bihar
// Board offers only Class 10 Mathematics.
const BOARDS: PyqTaxonomyBoard[] = [
  {
    id: 'board-cbse',
    name: 'CBSE',
    code: 'CBSE',
    subjects: [
      { id: 'subj-cbse-10-math', name: 'Mathematics', classLevel: '10', yearRange: [2015, 2024] },
      { id: 'subj-cbse-9-sci', name: 'Science', classLevel: '9', yearRange: [2018, 2023] },
    ],
  },
  {
    id: 'board-bseb',
    name: 'Bihar Board',
    code: 'BSEB',
    subjects: [
      { id: 'subj-bseb-10-math', name: 'Mathematics', classLevel: '10', yearRange: [2016, 2022] },
    ],
  },
];

function validState(overrides: Partial<PyqFormState> = {}): PyqFormState {
  return {
    boardId: 'board-cbse',
    classLevel: '10',
    subjectId: 'subj-cbse-10-math',
    yearFrom: 2015,
    yearTo: 2024,
    totalMarks: 80,
    questionCount: 20,
    questionType: '',
    prioritizeRecurring: false,
    ...overrides,
  };
}

describe('findBoard', () => {
  test('finds a board by id', () => {
    expect(findBoard(BOARDS, 'board-bseb')?.name).toBe('Bihar Board');
  });

  test('returns undefined for an unknown id', () => {
    expect(findBoard(BOARDS, 'does-not-exist')).toBeUndefined();
  });
});

describe('classLevelsForBoard', () => {
  test('returns the distinct class levels a board offers, in fixed 9/10/11/12 order', () => {
    expect(classLevelsForBoard(BOARDS, 'board-cbse')).toEqual(['9', '10']);
  });

  test('a board with only one class level offers exactly that one', () => {
    expect(classLevelsForBoard(BOARDS, 'board-bseb')).toEqual(['10']);
  });

  test('an unknown board offers no class levels', () => {
    expect(classLevelsForBoard(BOARDS, 'nope')).toEqual([]);
  });
});

describe('subjectsForBoardAndClass', () => {
  test('returns only the subjects matching BOTH the board and the class level', () => {
    const subjects = subjectsForBoardAndClass(BOARDS, 'board-cbse', '10');
    expect(subjects.map((s) => s.id)).toEqual(['subj-cbse-10-math']);
  });

  test('a different class level under the same board returns a different subject list', () => {
    const subjects = subjectsForBoardAndClass(BOARDS, 'board-cbse', '9');
    expect(subjects.map((s) => s.id)).toEqual(['subj-cbse-9-sci']);
  });

  test('a class level the board does not offer returns an empty list — never leaks a wrong-board subject', () => {
    expect(subjectsForBoardAndClass(BOARDS, 'board-bseb', '9')).toEqual([]);
  });

  test('an empty classLevel (nothing chosen yet) returns an empty list, not every subject', () => {
    expect(subjectsForBoardAndClass(BOARDS, 'board-cbse', '')).toEqual([]);
  });
});

describe('findSubject', () => {
  test('finds a subject scoped to its own board', () => {
    expect(findSubject(BOARDS, 'board-cbse', 'subj-cbse-10-math')?.name).toBe('Mathematics');
  });

  test('the SAME subject id under a different board is not found — board scoping is real, not a global lookup', () => {
    expect(findSubject(BOARDS, 'board-bseb', 'subj-cbse-10-math')).toBeUndefined();
  });
});

describe('defaultYearRange', () => {
  test('mirrors the subject\'s own published yearRange exactly', () => {
    const subject = findSubject(BOARDS, 'board-cbse', 'subj-cbse-10-math')!;
    expect(defaultYearRange(subject)).toEqual({ yearFrom: 2015, yearTo: 2024 });
  });
});

describe('validatePyqForm', () => {
  test('a fully valid form returns null', () => {
    expect(validatePyqForm(validState())).toBeNull();
  });

  test('missing board is caught first, before any other missing field', () => {
    expect(validatePyqForm(validState({ boardId: '', classLevel: '', subjectId: '' }))).toBe('Please select a board.');
  });

  test('missing class', () => {
    expect(validatePyqForm(validState({ classLevel: '' }))).toBe('Please select a class.');
  });

  test('missing subject', () => {
    expect(validatePyqForm(validState({ subjectId: '' }))).toBe('Please select a subject.');
  });

  test('missing year range', () => {
    expect(validatePyqForm(validState({ yearFrom: '' }))).toBe('Please choose a year range.');
    expect(validatePyqForm(validState({ yearTo: '' }))).toBe('Please choose a year range.');
  });

  test('yearFrom after yearTo', () => {
    expect(validatePyqForm(validState({ yearFrom: 2024, yearTo: 2015 }))).toBe('The start year must not be after the end year.');
  });

  test('yearFrom equal to yearTo is valid (a single-year request)', () => {
    expect(validatePyqForm(validState({ yearFrom: 2020, yearTo: 2020 }))).toBeNull();
  });

  test('missing or non-positive total marks', () => {
    expect(validatePyqForm(validState({ totalMarks: '' }))).toBe('Please enter the total marks for the paper.');
    expect(validatePyqForm(validState({ totalMarks: 0 }))).toBe('Please enter the total marks for the paper.');
  });

  test('missing or non-positive question count', () => {
    expect(validatePyqForm(validState({ questionCount: '' }))).toBe('Please enter the number of questions.');
    expect(validatePyqForm(validState({ questionCount: 0 }))).toBe('Please enter the number of questions.');
  });

  test('an optional questionType does not affect validity either way', () => {
    expect(validatePyqForm(validState({ questionType: 'mcq' }))).toBeNull();
    expect(validatePyqForm(validState({ questionType: '' }))).toBeNull();
  });
});

describe('buildGeneratePyqInput', () => {
  test('builds the exact Phase 8 request shape from a valid form, WITHOUT a questionType filter when none was chosen', () => {
    const input = buildGeneratePyqInput(validState());
    expect(input).toEqual({
      boardId: 'board-cbse',
      classLevel: '10',
      subjectId: 'subj-cbse-10-math',
      yearFrom: 2015,
      yearTo: 2024,
      totalMarks: 80,
      questionCount: 20,
      prioritizeRecurring: false,
    });
    expect(input).not.toHaveProperty('questionType');
    expect(input).not.toHaveProperty('language');
    // No mode/typeMix field ever — the confirmed Phase 8 API-contract decision.
    expect(input).not.toHaveProperty('mode');
    expect(input).not.toHaveProperty('typeMix');
  });

  test('includes questionType only when one was actually chosen', () => {
    const input = buildGeneratePyqInput(validState({ questionType: 'mcq' }));
    expect(input.questionType).toBe('mcq');
  });

  test('includes language only when a non-empty value is passed', () => {
    expect(buildGeneratePyqInput(validState(), 'hi').language).toBe('hi');
    expect(buildGeneratePyqInput(validState(), '')).not.toHaveProperty('language');
    expect(buildGeneratePyqInput(validState())).not.toHaveProperty('language');
  });

  test('coerces numeric fields even when the form state held them as strings from an empty input', () => {
    // Not a state validatePyqForm would ever pass through in practice
    // (empty means invalid), but this pins that Number(...) coercion, not
    // string concatenation, is what feeds the request.
    const input = buildGeneratePyqInput(validState({ totalMarks: 45, questionCount: 12 }));
    expect(input.totalMarks).toBe(45);
    expect(input.questionCount).toBe(12);
    expect(typeof input.totalMarks).toBe('number');
    expect(typeof input.questionCount).toBe('number');
  });
});

describe('defaultPyqTitle', () => {
  test('matches the shape of the server\'s own renderPyqMarkdown title exactly', () => {
    expect(defaultPyqTitle('CBSE', 'Mathematics', '10')).toBe('Mathematics — Previous Year Questions (CBSE, Class 10)');
  });

  test('is truncated to 200 characters, same bound as the Library title field', () => {
    const longSubject = 'A'.repeat(250);
    expect(defaultPyqTitle('CBSE', longSubject, '10').length).toBe(200);
  });
});

describe('PYQ_FORM_DEFAULTS', () => {
  test('starts with no board/class/subject/year chosen, but sensible marks/count defaults', () => {
    expect(PYQ_FORM_DEFAULTS.boardId).toBe('');
    expect(PYQ_FORM_DEFAULTS.classLevel).toBe('');
    expect(PYQ_FORM_DEFAULTS.subjectId).toBe('');
    expect(PYQ_FORM_DEFAULTS.yearFrom).toBe('');
    expect(PYQ_FORM_DEFAULTS.yearTo).toBe('');
    expect(typeof PYQ_FORM_DEFAULTS.totalMarks).toBe('number');
    expect(typeof PYQ_FORM_DEFAULTS.questionCount).toBe('number');
    expect(PYQ_FORM_DEFAULTS.prioritizeRecurring).toBe(false);
  });

  test('the defaults alone are correctly reported as invalid (board/class/subject/year still required)', () => {
    expect(validatePyqForm(PYQ_FORM_DEFAULTS)).toBe('Please select a board.');
  });
});
