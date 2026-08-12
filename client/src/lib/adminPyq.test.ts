import { describe, expect, it } from 'vitest';
import { buildQuestionPatch, draftFromQuestion, withPdfPageFragment } from './adminPyq';
import type { PyqQuestion } from '../types';

function question(overrides: Partial<PyqQuestion> = {}): PyqQuestion {
  return {
    id: 'q1',
    examPaperId: 'p1',
    chapterId: null,
    topics: [],
    boardId: 'b1',
    subjectId: 's1',
    classLevel: '10',
    year: 2020,
    questionNumber: '1',
    parentQuestionId: null,
    requiresGroupSelection: false,
    language: 'en',
    translationOfId: null,
    type: 'short_answer',
    text: 'Original text',
    options: null,
    marks: 2,
    difficulty: null,
    correctAnswer: null,
    hasOfficialAnswer: false,
    pageNumber: 1,
    hasDiagram: false,
    hasTable: false,
    reviewStatus: 'extracted',
    reviewedById: null,
    reviewedAt: null,
    extractionConfidence: 0.9,
    rawExtraction: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('draftFromQuestion', () => {
  it('carries every editable field over unchanged', () => {
    const q = question({ marks: 5, difficulty: 'medium', hasDiagram: true });
    const draft = draftFromQuestion(q);
    expect(draft.questionNumber).toBe('1');
    expect(draft.text).toBe('Original text');
    expect(draft.marks).toBe(5);
    expect(draft.difficulty).toBe('medium');
    expect(draft.hasDiagram).toBe(true);
  });

  it('fills options with 4 blanks when the question has none (non-mcq)', () => {
    const draft = draftFromQuestion(question({ options: null }));
    expect(draft.options).toEqual(['', '', '', '']);
  });

  it('preserves existing mcq options', () => {
    const draft = draftFromQuestion(question({ type: 'mcq', options: ['A', 'B', 'C', 'D'] }));
    expect(draft.options).toEqual(['A', 'B', 'C', 'D']);
  });

  it('maps a null difficulty/correctAnswer to empty-string form values', () => {
    const draft = draftFromQuestion(question({ difficulty: null, correctAnswer: null }));
    expect(draft.difficulty).toBe('');
    expect(draft.correctAnswer).toBe('');
  });

  it('maps a null chapterId to an empty-string form value, and pulls topic ids out of the topics list (Phase 5)', () => {
    const draft = draftFromQuestion(question({ chapterId: null, topics: [] }));
    expect(draft.chapterId).toBe('');
    expect(draft.topicIds).toEqual([]);
  });

  it('carries an existing chapterId/topics over into the draft (Phase 5)', () => {
    const draft = draftFromQuestion(question({
      chapterId: 'ch1',
      topics: [{ id: 't1', name: 'Topic One', source: 'ai' }, { id: 't2', name: 'Topic Two', source: 'human' }],
    }));
    expect(draft.chapterId).toBe('ch1');
    expect(draft.topicIds).toEqual(['t1', 't2']);
  });
});

describe('buildQuestionPatch', () => {
  it('returns null when nothing changed', () => {
    const q = question();
    const draft = draftFromQuestion(q);
    expect(buildQuestionPatch(q, draft)).toBeNull();
  });

  it('includes only the fields that actually changed', () => {
    const q = question({ marks: 2, text: 'Original text' });
    const draft = draftFromQuestion(q);
    draft.marks = 4;
    const patch = buildQuestionPatch(q, draft);
    expect(patch).toEqual({ marks: 4 });
  });

  it('trims text/questionNumber/correctAnswer before diffing and sending', () => {
    const q = question({ text: 'Original text' });
    const draft = draftFromQuestion(q);
    draft.text = '  Corrected text  ';
    const patch = buildQuestionPatch(q, draft);
    expect(patch).toEqual({ text: 'Corrected text' });
  });

  it('detects no change when whitespace-only edits round-trip to the same value', () => {
    const q = question({ text: 'Same' });
    const draft = draftFromQuestion(q);
    draft.text = '  Same  ';
    expect(buildQuestionPatch(q, draft)).toBeNull();
  });

  it('always includes options alongside a type change, even if option text is untouched', () => {
    const q = question({ type: 'short_answer', options: null });
    const draft = draftFromQuestion(q);
    draft.type = 'mcq';
    draft.options = ['A', 'B', 'C', 'D'];
    const patch = buildQuestionPatch(q, draft);
    expect(patch).toEqual({ type: 'mcq', options: ['A', 'B', 'C', 'D'] });
  });

  it('sends an empty options array when switching AWAY from mcq', () => {
    const q = question({ type: 'mcq', options: ['A', 'B', 'C', 'D'] });
    const draft = draftFromQuestion(q);
    draft.type = 'short_answer';
    const patch = buildQuestionPatch(q, draft);
    expect(patch).toEqual({ type: 'short_answer', options: [] });
  });

  it('detects an mcq option edit with the type unchanged', () => {
    const q = question({ type: 'mcq', options: ['A', 'B', 'C', 'D'] });
    const draft = draftFromQuestion(q);
    draft.options = ['A', 'B', 'C', 'Changed'];
    const patch = buildQuestionPatch(q, draft);
    expect(patch).toEqual({ options: ['A', 'B', 'C', 'Changed'] });
  });

  it('ignores option edits for a non-mcq type (nothing to send)', () => {
    const q = question({ type: 'short_answer', options: null });
    const draft = draftFromQuestion(q);
    draft.options = ['stray', 'text', '', ''];
    expect(buildQuestionPatch(q, draft)).toBeNull();
  });

  it('maps an empty-string difficulty draft back to null', () => {
    const q = question({ difficulty: 'medium' });
    const draft = draftFromQuestion(q);
    draft.difficulty = '';
    const patch = buildQuestionPatch(q, draft);
    expect(patch).toEqual({ difficulty: null });
  });

  it('detects a correctAnswer edit (never emits hasOfficialAnswer — that is server-derived)', () => {
    const q = question({ correctAnswer: null });
    const draft = draftFromQuestion(q);
    draft.correctAnswer = 'x = 5';
    const patch = buildQuestionPatch(q, draft);
    expect(patch).toEqual({ correctAnswer: 'x = 5' });
    expect(patch && 'hasOfficialAnswer' in patch).toBe(false);
  });

  it('combines multiple simultaneous edits into one patch', () => {
    const q = question({ marks: 2, hasDiagram: false, requiresGroupSelection: false });
    const draft = draftFromQuestion(q);
    draft.marks = 3;
    draft.hasDiagram = true;
    draft.requiresGroupSelection = true;
    const patch = buildQuestionPatch(q, draft);
    expect(patch).toEqual({ marks: 3, hasDiagram: true, requiresGroupSelection: true });
  });

  it('Phase 5: detects a chapterId change and maps the empty-string draft value to null', () => {
    const q = question({ chapterId: null });
    const draft = draftFromQuestion(q);
    draft.chapterId = 'ch1';
    expect(buildQuestionPatch(q, draft)).toEqual({ chapterId: 'ch1' });

    const draft2 = draftFromQuestion(question({ chapterId: 'ch1' }));
    draft2.chapterId = '';
    expect(buildQuestionPatch(question({ chapterId: 'ch1' }), draft2)).toEqual({ chapterId: null });
  });

  it('Phase 5: no chapterId edit when the draft was never touched', () => {
    const q = question({ chapterId: 'ch1' });
    const draft = draftFromQuestion(q);
    expect(buildQuestionPatch(q, draft)).toBeNull();
  });

  it('Phase 5: detects a topicIds change regardless of array order', () => {
    const q = question({ chapterId: 'ch1', topics: [{ id: 't1', name: 'A', source: 'ai' }, { id: 't2', name: 'B', source: 'ai' }] });
    const draft = draftFromQuestion(q);
    // Same set, different order — must NOT be treated as a change.
    draft.topicIds = ['t2', 't1'];
    expect(buildQuestionPatch(q, draft)).toBeNull();

    draft.topicIds = ['t1'];
    expect(buildQuestionPatch(q, draft)).toEqual({ topicIds: ['t1'] });
  });

  it('Phase 5: an empty topicIds draft against existing topics is a real "clear" edit', () => {
    const q = question({ chapterId: 'ch1', topics: [{ id: 't1', name: 'A', source: 'ai' }] });
    const draft = draftFromQuestion(q);
    draft.topicIds = [];
    expect(buildQuestionPatch(q, draft)).toEqual({ topicIds: [] });
  });
});

describe('withPdfPageFragment', () => {
  it('appends a #page= fragment for a positive page number', () => {
    expect(withPdfPageFragment('blob:abc', 5)).toBe('blob:abc#page=5');
  });

  it('returns the url unchanged for a missing, zero, or negative page number', () => {
    expect(withPdfPageFragment('blob:abc', null)).toBe('blob:abc');
    expect(withPdfPageFragment('blob:abc', undefined)).toBe('blob:abc');
    expect(withPdfPageFragment('blob:abc', 0)).toBe('blob:abc');
    expect(withPdfPageFragment('blob:abc', -1)).toBe('blob:abc');
  });
});
