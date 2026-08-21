// Ported from client/src/lib/structuredQuestions.test.ts (same logic, only
// the import paths and Jest-vs-vitest globals differ — see
// docs/generator-v2-plan.md's "reuse the same structured-question contract"
// instruction).
import {
  BLANK_MARKER_RE,
  EDITABLE_QUESTION_TYPES,
  MAX_MATCH_PAIRS,
  MIN_MATCH_PAIRS,
  buildStructuredPayload,
  createEmptyQuestion,
  fromWireQuestion,
  parseStructuredDocument,
  toWireQuestion,
  validateQuestion,
  validateQuestions,
} from './structuredQuestions';
import type {
  DescriptiveQuestion, FillBlankQuestion, MatchQuestion, McqQuestion, Question, ShortAnswerQuestion,
} from '../api/resources';

describe('EDITABLE_QUESTION_TYPES', () => {
  it('excludes "mixed" (a generation-request modifier, never a real question type)', () => {
    expect(EDITABLE_QUESTION_TYPES.some((q) => q.value === 'mixed')).toBe(false);
  });

  it('contains all 6 real question types', () => {
    const values = EDITABLE_QUESTION_TYPES.map((q) => q.value).sort();
    expect(values).toEqual(['descriptive', 'fill_blank', 'match', 'mcq', 'short_answer', 'true_false'].sort());
  });
});

describe('createEmptyQuestion', () => {
  (['mcq', 'true_false', 'short_answer', 'descriptive', 'fill_blank', 'match'] as const).forEach((type) => {
    it(`creates a valid-shape but empty ${type} question with a unique id`, () => {
      const a = createEmptyQuestion(type);
      const b = createEmptyQuestion(type);
      expect(a.type).toBe(type);
      expect(a.id).toBeTruthy();
      expect(a.id).not.toBe(b.id);
    });
  });

  it('mcq starts with 4 empty options and correctOptionIndex 0', () => {
    const q = createEmptyQuestion('mcq') as McqQuestion;
    expect(q.options).toEqual(['', '', '', '']);
    expect(q.correctOptionIndex).toBe(0);
  });

  it('match starts with 3 empty pairs (the minimum)', () => {
    const q = createEmptyQuestion('match') as MatchQuestion;
    expect(q.pairs).toHaveLength(MIN_MATCH_PAIRS);
  });
});

describe('fromWireQuestion / toWireQuestion round trip', () => {
  it('mcq round-trips exactly', () => {
    const wire = { id: 'q1', type: 'mcq', text: 'What is 2+2?', options: ['1', '2', '3', '4'], correctOptionIndex: 3, correctAnswer: '', modelAnswer: '', pairs: [] };
    const q = fromWireQuestion(wire);
    expect(q).toEqual({ id: 'q1', type: 'mcq', text: 'What is 2+2?', options: ['1', '2', '3', '4'], correctOptionIndex: 3 });
    expect(toWireQuestion(q)).toMatchObject({ type: 'mcq', options: ['1', '2', '3', '4'], correctOptionIndex: 3 });
  });

  it('true_false normalizes correctAnswer to exactly "True"/"False"', () => {
    expect(fromWireQuestion({ type: 'true_false', text: 'Q', correctAnswer: 'false' })).toMatchObject({ correctAnswer: 'False' });
    expect(fromWireQuestion({ type: 'true_false', text: 'Q', correctAnswer: 'anything else' })).toMatchObject({ correctAnswer: 'True' });
  });

  it('descriptive round-trips modelAnswer', () => {
    const wire = { type: 'descriptive', text: 'Explain X.', modelAnswer: 'Because of Y.' };
    const q = fromWireQuestion(wire);
    expect(q).toMatchObject({ type: 'descriptive', modelAnswer: 'Because of Y.' });
    expect(toWireQuestion(q)).toMatchObject({ modelAnswer: 'Because of Y.', correctAnswer: '', options: [], pairs: [] });
  });

  it('fill_blank round-trips correctAnswer and keeps the blank marker in text', () => {
    const q = fromWireQuestion({ type: 'fill_blank', text: 'The capital of France is ___.', correctAnswer: 'Paris' });
    expect(q).toMatchObject({ type: 'fill_blank', text: 'The capital of France is ___.', correctAnswer: 'Paris' });
  });

  it('match round-trips pairs', () => {
    const wire = { type: 'match', text: 'Match them.', pairs: [{ left: 'A', right: '1' }, { left: 'B', right: '2' }, { left: 'C', right: '3' }] };
    const q = fromWireQuestion(wire) as MatchQuestion;
    expect(q.pairs).toEqual(wire.pairs);
    expect(toWireQuestion(q)).toMatchObject({ pairs: wire.pairs, options: [], correctOptionIndex: -1 });
  });

  it('short_answer round-trips correctAnswer', () => {
    const q = fromWireQuestion({ type: 'short_answer', text: 'Define X.', correctAnswer: 'A thing.' });
    expect(q).toMatchObject({ type: 'short_answer', correctAnswer: 'A thing.' });
  });

  it('an unrecognized type falls back to short_answer rather than throwing', () => {
    const q = fromWireQuestion({ type: 'essay', text: 'Write about it.' });
    expect(q.type).toBe('short_answer');
  });

  it('a completely malformed input (not an object) never throws', () => {
    expect(() => fromWireQuestion(null)).not.toThrow();
    expect(() => fromWireQuestion('nonsense')).not.toThrow();
    expect(() => fromWireQuestion(undefined)).not.toThrow();
    expect(fromWireQuestion(null).type).toBe('short_answer');
  });

  it('mcq with fewer than 4 raw options is padded, not truncated to invalid shape', () => {
    const q = fromWireQuestion({ type: 'mcq', text: 'Q', options: ['A', 'B'] }) as McqQuestion;
    expect(q.options).toHaveLength(4);
    expect(q.options.slice(0, 2)).toEqual(['A', 'B']);
  });

  it('an existing id is preserved by fromWireQuestion', () => {
    const q = fromWireQuestion({ id: 'stable-id-1', type: 'short_answer', text: 'Q', correctAnswer: 'A' });
    expect(q.id).toBe('stable-id-1');
  });

  it('toWireQuestion always includes every field (empty/-1 when not applicable), matching the server schema', () => {
    const tf = fromWireQuestion({ type: 'true_false', text: 'Q', correctAnswer: 'True' });
    expect(toWireQuestion(tf)).toEqual({
      id: tf.id, type: 'true_false', text: 'Q', options: [], correctOptionIndex: -1,
      correctAnswer: 'True', modelAnswer: '', pairs: [],
    });
  });
});

describe('parseStructuredDocument', () => {
  it('returns null for undefined/null/empty input', () => {
    expect(parseStructuredDocument(undefined)).toBeNull();
    expect(parseStructuredDocument(null)).toBeNull();
    expect(parseStructuredDocument('')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseStructuredDocument('{not valid json')).toBeNull();
  });

  it('returns null for a legacy structured payload with no schemaVersion (existing resources)', () => {
    const legacy = JSON.stringify({ format: 'quiz', difficulty: 'medium', questionType: 'mcq', questionCount: 5, topic: 'Fractions' });
    expect(parseStructuredDocument(legacy)).toBeNull();
  });

  it('returns null when schemaVersion is present but not 2', () => {
    expect(parseStructuredDocument(JSON.stringify({ schemaVersion: 1, questions: [] }))).toBeNull();
  });

  it('returns null when questions is missing or not an array', () => {
    expect(parseStructuredDocument(JSON.stringify({ schemaVersion: 2 }))).toBeNull();
    expect(parseStructuredDocument(JSON.stringify({ schemaVersion: 2, questions: 'nope' }))).toBeNull();
  });

  it('parses a well-formed structured document, preserving generator-config keys', () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      format: 'quiz', topic: 'Fractions', grade: 'Class 5', subject: 'Maths', difficulty: 'medium',
      instructions: 'Answer all questions.',
      questions: [{ type: 'mcq', text: 'Q1?', options: ['A', 'B', 'C', 'D'], correctOptionIndex: 0 }],
    });
    const doc = parseStructuredDocument(raw);
    expect(doc).not.toBeNull();
    expect(doc?.schemaVersion).toBe(2);
    expect(doc?.topic).toBe('Fractions');
    expect(doc?.questions).toHaveLength(1);
    expect(doc?.questions[0].type).toBe('mcq');
  });
});

describe('buildStructuredPayload', () => {
  it('produces a JSON string parseStructuredDocument reads back identically', () => {
    const questions: Question[] = [createEmptyQuestion('mcq'), createEmptyQuestion('true_false')];
    questions[0] = { ...questions[0], text: 'Q1?' } as Question;
    const payload = buildStructuredPayload({ instructions: 'Go.', questions, format: 'quiz', topic: 'X' });
    const parsed = parseStructuredDocument(payload);
    expect(parsed?.instructions).toBe('Go.');
    expect(parsed?.questions).toHaveLength(2);
    expect(parsed?.format).toBe('quiz');
  });
});

describe('validateQuestion', () => {
  it('rejects empty text for every type', () => {
    (['mcq', 'true_false', 'short_answer', 'descriptive', 'fill_blank', 'match'] as const).forEach((type) => {
      const q = createEmptyQuestion(type);
      expect(validateQuestion(q)).toBeTruthy();
    });
  });

  it('mcq: requires all 4 options filled', () => {
    const q = { ...createEmptyQuestion('mcq'), text: 'Q?', options: ['A', 'B', '', 'D'] } as McqQuestion;
    expect(validateQuestion(q)).toMatch(/all 4 options/i);
  });

  it('mcq: valid when text + all options filled + a correct index selected', () => {
    const q = { ...createEmptyQuestion('mcq'), text: 'Q?', options: ['A', 'B', 'C', 'D'], correctOptionIndex: 2 } as McqQuestion;
    expect(validateQuestion(q)).toBeNull();
  });

  it('true_false: valid as soon as text is present (correctAnswer is always a valid toggle value)', () => {
    const q = { ...createEmptyQuestion('true_false'), text: 'The sky is blue.' };
    expect(validateQuestion(q)).toBeNull();
  });

  it('short_answer: requires a non-empty correctAnswer', () => {
    const q = { ...(createEmptyQuestion('short_answer') as ShortAnswerQuestion), text: 'Define X.' };
    expect(validateQuestion(q)).toMatch(/correct answer/i);
    expect(validateQuestion({ ...q, correctAnswer: 'A thing.' })).toBeNull();
  });

  it('descriptive: requires a non-empty modelAnswer', () => {
    const q = { ...(createEmptyQuestion('descriptive') as DescriptiveQuestion), text: 'Explain X.' };
    expect(validateQuestion(q)).toMatch(/model answer/i);
    expect(validateQuestion({ ...q, modelAnswer: 'Because Y.' })).toBeNull();
  });

  it('fill_blank: rejects text with no blank marker', () => {
    const q = { ...(createEmptyQuestion('fill_blank') as FillBlankQuestion), text: 'No blank here.', correctAnswer: 'X' };
    expect(validateQuestion(q)).toMatch(/blank/i);
  });

  it('fill_blank: accepts a blank written with 3+ underscores and a correctAnswer', () => {
    const q = { ...(createEmptyQuestion('fill_blank') as FillBlankQuestion), text: 'The capital of France is ___.', correctAnswer: 'Paris' };
    expect(validateQuestion(q)).toBeNull();
    expect(BLANK_MARKER_RE.test(q.text)).toBe(true);
  });

  it('match: rejects fewer than MIN_MATCH_PAIRS', () => {
    const q = { ...createEmptyQuestion('match'), text: 'Match.', pairs: [{ left: 'A', right: '1' }, { left: 'B', right: '2' }] } as MatchQuestion;
    expect(validateQuestion(q)).toMatch(/between/i);
  });

  it('match: rejects more than MAX_MATCH_PAIRS', () => {
    const pairs = Array.from({ length: MAX_MATCH_PAIRS + 1 }, (_, i) => ({ left: `L${i}`, right: `R${i}` }));
    const q = { ...createEmptyQuestion('match'), text: 'Match.', pairs } as MatchQuestion;
    expect(validateQuestion(q)).toMatch(/between/i);
  });

  it('match: rejects an empty side of a pair', () => {
    const q = {
      ...createEmptyQuestion('match'), text: 'Match.',
      pairs: [{ left: 'A', right: '1' }, { left: '', right: '2' }, { left: 'C', right: '3' }],
    } as MatchQuestion;
    expect(validateQuestion(q)).toMatch(/left and right/i);
  });

  it('match: rejects duplicate left-hand values', () => {
    const q = {
      ...createEmptyQuestion('match'), text: 'Match.',
      pairs: [{ left: 'Mercury', right: '1' }, { left: 'mercury', right: '2' }, { left: 'Earth', right: '3' }],
    } as MatchQuestion;
    expect(validateQuestion(q)).toMatch(/unique/i);
  });

  it('match: valid with 3-8 unique, fully-filled pairs', () => {
    const q = {
      ...createEmptyQuestion('match'), text: 'Match.',
      pairs: [{ left: 'A', right: '1' }, { left: 'B', right: '2' }, { left: 'C', right: '3' }],
    } as MatchQuestion;
    expect(validateQuestion(q)).toBeNull();
  });
});

describe('validateQuestions', () => {
  it('returns an empty map when every question is valid', () => {
    const q1: Question = { ...createEmptyQuestion('true_false'), text: 'Q1' };
    const q2: Question = { ...(createEmptyQuestion('short_answer') as ShortAnswerQuestion), text: 'Q2', correctAnswer: 'A' };
    expect(validateQuestions([q1, q2])).toEqual({});
  });

  it('keys errors by question id, only for invalid questions', () => {
    const valid: Question = { ...createEmptyQuestion('true_false'), text: 'Q1' };
    const invalid = createEmptyQuestion('short_answer'); // no text, no correctAnswer
    const errors = validateQuestions([valid, invalid]);
    expect(Object.keys(errors)).toEqual([invalid.id]);
    expect(errors[invalid.id]).toBeTruthy();
  });
});
