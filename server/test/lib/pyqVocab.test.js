const {
  PYQ_CLASS_LEVELS, PYQ_EXAM_TYPES, PYQ_PAPER_STATUSES, PYQ_QUESTION_TYPES,
  PYQ_QUESTION_REVIEW_STATUSES, PYQ_TOPIC_SOURCES,
} = require('../../src/lib/pyqVocab');

describe('pyqVocab', () => {
  test('every vocabulary is a frozen, non-empty array of unique strings', () => {
    for (const vocab of [
      PYQ_CLASS_LEVELS, PYQ_EXAM_TYPES, PYQ_PAPER_STATUSES, PYQ_QUESTION_TYPES,
      PYQ_QUESTION_REVIEW_STATUSES, PYQ_TOPIC_SOURCES,
    ]) {
      expect(Object.isFrozen(vocab)).toBe(true);
      expect(vocab.length).toBeGreaterThan(0);
      expect(new Set(vocab).size).toBe(vocab.length);
      for (const v of vocab) expect(typeof v).toBe('string');
    }
  });

  test('matches the exact closed vocabularies locked by earlier phases (schema.prisma comments, Phase 0 decision record)', () => {
    expect(PYQ_CLASS_LEVELS).toEqual(['9', '10', '11', '12']);
    expect(PYQ_EXAM_TYPES).toEqual(['annual', 'compartment', 'pre_board']);
    expect(PYQ_PAPER_STATUSES).toEqual(['uploaded', 'extracting', 'needs_review', 'published', 'archived', 'extraction_failed']);
    expect(PYQ_QUESTION_TYPES).toEqual(['mcq', 'very_short_answer', 'short_answer', 'long_answer', 'case_study']);
    expect(PYQ_QUESTION_REVIEW_STATUSES).toEqual(['extracted', 'reviewed', 'approved', 'rejected']);
    expect(PYQ_TOPIC_SOURCES).toEqual(['ai', 'human']);
  });
});

describe('pyqExtractionSchema re-export', () => {
  test('PYQ_QUESTION_TYPES re-exported from lib/pyqExtractionSchema.js is the SAME array as pyqVocab.js — one source of truth, not a second copy', () => {
    const { PYQ_QUESTION_TYPES: reExported } = require('../../src/lib/pyqExtractionSchema');
    expect(reExported).toBe(PYQ_QUESTION_TYPES);
  });
});
