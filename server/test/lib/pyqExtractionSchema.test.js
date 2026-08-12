const {
  PYQ_QUESTION_TYPES,
  pyqPageExtractionSchema,
  normalizePageExtractionMath,
} = require('../../src/lib/pyqExtractionSchema');

function baseQuestion(overrides = {}) {
  return {
    questionNumber: '5',
    requiresGroupSelection: false,
    language: 'en',
    type: 'short_answer',
    text: 'Solve for x.',
    options: [],
    marks: 2,
    correctAnswer: '',
    hasOfficialAnswer: false,
    hasDiagram: false,
    hasTable: false,
    confidence: 0.9,
    ...overrides,
  };
}

describe('pyqExtractionSchema.pyqPageExtractionSchema', () => {
  test('accepts a well-formed page with zero, one, and multiple questions', () => {
    expect(pyqPageExtractionSchema.safeParse({ questions: [] }).success).toBe(true);
    expect(pyqPageExtractionSchema.safeParse({ questions: [baseQuestion()] }).success).toBe(true);
    expect(
      pyqPageExtractionSchema.safeParse({ questions: [baseQuestion(), baseQuestion({ questionNumber: '6' })] }).success
    ).toBe(true);
  });

  test('accepts a parentQuestionNumber-carrying sub-part and omits it when absent', () => {
    const withParent = pyqPageExtractionSchema.safeParse({
      questions: [baseQuestion({ questionNumber: '5(a)', parentQuestionNumber: '5' })],
    });
    expect(withParent.success).toBe(true);
    expect(withParent.data.questions[0].parentQuestionNumber).toBe('5');

    const withoutParent = pyqPageExtractionSchema.safeParse({ questions: [baseQuestion()] });
    expect(withoutParent.success).toBe(true);
    expect(withoutParent.data.questions[0].parentQuestionNumber).toBeUndefined();
  });

  test.each(['questionNumber', 'language', 'type', 'text', 'marks', 'hasOfficialAnswer', 'confidence'])(
    'rejects a question missing required field %s',
    (field) => {
      const q = baseQuestion();
      delete q[field];
      const result = pyqPageExtractionSchema.safeParse({ questions: [q] });
      expect(result.success).toBe(false);
    }
  );

  test('rejects an unknown question type', () => {
    const result = pyqPageExtractionSchema.safeParse({ questions: [baseQuestion({ type: 'essay' })] });
    expect(result.success).toBe(false);
  });

  test('rejects an unknown language code', () => {
    const result = pyqPageExtractionSchema.safeParse({ questions: [baseQuestion({ language: 'fr' })] });
    expect(result.success).toBe(false);
  });

  test('mcq must have exactly 4 options', () => {
    const tooFew = pyqPageExtractionSchema.safeParse({
      questions: [baseQuestion({ type: 'mcq', options: ['a', 'b'] })],
    });
    expect(tooFew.success).toBe(false);

    const exactlyFour = pyqPageExtractionSchema.safeParse({
      questions: [baseQuestion({ type: 'mcq', options: ['a', 'b', 'c', 'd'] })],
    });
    expect(exactlyFour.success).toBe(true);
  });

  test('hasOfficialAnswer=true requires a non-empty correctAnswer', () => {
    const result = pyqPageExtractionSchema.safeParse({
      questions: [baseQuestion({ hasOfficialAnswer: true, correctAnswer: '' })],
    });
    expect(result.success).toBe(false);
  });

  test('hasOfficialAnswer=true with a real correctAnswer is valid', () => {
    const result = pyqPageExtractionSchema.safeParse({
      questions: [baseQuestion({ hasOfficialAnswer: true, correctAnswer: 'x = 5' })],
    });
    expect(result.success).toBe(true);
  });

  test('caps a page at 30 questions', () => {
    const questions = Array.from({ length: 31 }, (_, i) => baseQuestion({ questionNumber: String(i + 1) }));
    const result = pyqPageExtractionSchema.safeParse({ questions });
    expect(result.success).toBe(false);
  });

  test('rejects a non-object / missing questions array', () => {
    expect(pyqPageExtractionSchema.safeParse(null).success).toBe(false);
    expect(pyqPageExtractionSchema.safeParse({}).success).toBe(false);
    expect(pyqPageExtractionSchema.safeParse({ questions: 'not-an-array' }).success).toBe(false);
  });
});

describe('pyqExtractionSchema.normalizePageExtractionMath', () => {
  test('converts plain-notation math in text/options/correctAnswer', () => {
    const raw = {
      questions: [
        {
          ...baseQuestion(),
          text: 'What is $5/9$ of 45?',
          options: ['$1/2$', 'not math'],
          correctAnswer: '$x^2$',
        },
      ],
    };
    const normalized = normalizePageExtractionMath(raw);
    expect(normalized.questions[0].text).toContain('\\frac');
    expect(normalized.questions[0].options[0]).toContain('\\frac');
    expect(normalized.questions[0].correctAnswer).toContain('x^{2}');
  });

  test('tolerates malformed shapes without throwing, leaving Zod to reject them', () => {
    expect(normalizePageExtractionMath(null)).toBeNull();
    expect(normalizePageExtractionMath({})).toEqual({});
    expect(normalizePageExtractionMath({ questions: 'nope' })).toEqual({ questions: 'nope' });
    expect(normalizePageExtractionMath({ questions: [null, 42] })).toEqual({ questions: [null, 42] });
  });
});

describe('pyqExtractionSchema.PYQ_QUESTION_TYPES', () => {
  test('is a non-empty, deduplicated list of strings', () => {
    expect(PYQ_QUESTION_TYPES.length).toBeGreaterThan(0);
    expect(new Set(PYQ_QUESTION_TYPES).size).toBe(PYQ_QUESTION_TYPES.length);
  });
});
