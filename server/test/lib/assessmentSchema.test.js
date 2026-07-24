const {
  assessmentDocumentSchema,
  checkAgainstRequest,
  normalizeAssessmentMath,
  normalizeMathText,
} = require('../../src/lib/assessmentSchema');

function validMcq(overrides = {}) {
  return {
    type: 'mcq',
    text: 'What is 2 + 2?',
    options: ['3', '4', '5', '6'],
    correctOptionIndex: 1,
    correctAnswer: '',
    ...overrides,
  };
}

function validTrueFalse(overrides = {}) {
  return {
    type: 'true_false',
    text: 'The sky is blue.',
    options: [],
    correctOptionIndex: -1,
    correctAnswer: 'True',
    ...overrides,
  };
}

function validShortAnswer(overrides = {}) {
  return {
    type: 'short_answer',
    text: 'Explain photosynthesis.',
    options: [],
    correctOptionIndex: -1,
    correctAnswer: 'The process by which plants make food using sunlight.',
    ...overrides,
  };
}

describe('assessmentDocumentSchema', () => {
  test('accepts a well-formed document with a mix of question types', () => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Answer all questions.',
      questions: [validMcq(), validTrueFalse(), validShortAnswer()],
    });
    expect(result.success).toBe(true);
  });

  test('rejects a document missing "instructions"', () => {
    const result = assessmentDocumentSchema.safeParse({ questions: [validMcq()] });
    expect(result.success).toBe(false);
  });

  test('rejects a document with an empty questions array', () => {
    const result = assessmentDocumentSchema.safeParse({ instructions: 'Go.', questions: [] });
    expect(result.success).toBe(false);
  });

  test('rejects a document with more than 30 questions', () => {
    const questions = Array.from({ length: 31 }, () => validMcq());
    const result = assessmentDocumentSchema.safeParse({ instructions: 'Go.', questions });
    expect(result.success).toBe(false);
  });

  test('rejects an mcq question with fewer than 4 options', () => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validMcq({ options: ['A', 'B', 'C'] })],
    });
    expect(result.success).toBe(false);
  });

  test('rejects an mcq question with more than 4 options', () => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validMcq({ options: ['A', 'B', 'C', 'D', 'E'] })],
    });
    expect(result.success).toBe(false);
  });

  test.each([-1, 4, 100])('rejects an mcq question with correctOptionIndex %i (out of 0-3 range)', (idx) => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validMcq({ correctOptionIndex: idx })],
    });
    expect(result.success).toBe(false);
  });

  test.each([0, 1, 2, 3])('accepts an mcq question with correctOptionIndex %i', (idx) => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validMcq({ correctOptionIndex: idx })],
    });
    expect(result.success).toBe(true);
  });

  test.each(['Maybe', 'yes', '1', ''])('rejects a true_false correctAnswer of %j', (val) => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validTrueFalse({ correctAnswer: val })],
    });
    expect(result.success).toBe(false);
  });

  test.each(['True', 'False', 'true', 'false'])('accepts a true_false correctAnswer of %j (case-insensitive)', (val) => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validTrueFalse({ correctAnswer: val })],
    });
    expect(result.success).toBe(true);
  });

  test('rejects a short_answer question with an empty correctAnswer', () => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validShortAnswer({ correctAnswer: '   ' })],
    });
    expect(result.success).toBe(false);
  });

  test('rejects an unknown question "type"', () => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validMcq({ type: 'essay' })],
    });
    expect(result.success).toBe(false);
  });

  test('rejects question text over the length cap', () => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validMcq({ text: 'x'.repeat(1001) })],
    });
    expect(result.success).toBe(false);
  });
});

describe('checkAgainstRequest', () => {
  const doc = { instructions: 'Go.', questions: [validMcq(), validMcq(), validMcq()] };

  test('returns null when the question count and type both match', () => {
    expect(checkAgainstRequest(doc, { questionCount: 3, questionType: 'mcq' })).toBeNull();
  });

  test('flags a question-count mismatch', () => {
    const err = checkAgainstRequest(doc, { questionCount: 5, questionType: 'mcq' });
    expect(err).toMatch(/Expected exactly 5 questions, got 3/);
  });

  test('flags a question-type mismatch for a non-mixed request', () => {
    const mixedDoc = { instructions: 'Go.', questions: [validMcq(), validTrueFalse(), validMcq()] };
    const err = checkAgainstRequest(mixedDoc, { questionCount: 3, questionType: 'mcq' });
    expect(err).toMatch(/Expected every question to be "mcq", got "true_false"/);
  });

  test('allows any mix of question types when questionType is "mixed"', () => {
    const mixedDoc = { instructions: 'Go.', questions: [validMcq(), validTrueFalse(), validShortAnswer()] };
    expect(checkAgainstRequest(mixedDoc, { questionCount: 3, questionType: 'mixed' })).toBeNull();
  });
});

// The mangled inputs below are written with real JS escapes so they contain the
// ACTUAL control characters JSON.parse produces from Gemini's single-backslash
// LaTeX: '\t' is a tab ("\tan" eaten), '\f' a form feed ("\frac" eaten), etc.
// Every fixture shape was observed verbatim in a real generated paper.
describe('normalizeMathText', () => {
  test('repairs JSON-eaten \\t and \\f commands inside inline math', () => {
    expect(normalizeMathText('If $\tan \theta = \frac{3}{4}$, find it.'))
      .toBe('If $\\tan \\theta = \\frac{3}{4}$, find it.');
  });

  test('repairs \\r (\\rho) and \\b (\\beta) manglings', () => {
    expect(normalizeMathText('$2\rho + 1$')).toBe('$2\\rho + 1$');
    expect(normalizeMathText('$\beta + 1$')).toBe('$\\beta + 1$');
  });

  test('normalizes degenerate \\text{...} function names inside math', () => {
    expect(normalizeMathText('$\text{sin } A + \text{cos } B$'))
      .toBe('$\\sin  A + \\cos  B$');
    expect(normalizeMathText('$\text{cosec } A$')).toBe('$\\operatorname{cosec}  A$');
  });

  test('normalizes \\text{sqrt}(x) and degree-as-\\text{o} forms', () => {
    expect(normalizeMathText('$\frac{1}{\text{sqrt}(3)}$')).toBe('$\\frac{1}{\\sqrt{3}}$');
    expect(normalizeMathText('$\tan 60^\text{o}$')).toBe('$\\tan 60^{\\circ}$');
  });

  test('degree normalization never eats the closing brace of an enclosing \\frac argument', () => {
    expect(normalizeMathText('$\frac{\tan 60^\text{o}}{\tan 30^\text{o}}$'))
      .toBe('$\\frac{\\tan 60^{\\circ}}{\\tan 30^{\\circ}}$');
    expect(normalizeMathText('$45^{\text{o}}$')).toBe('$45^{\\circ}$');
  });

  test('leaves well-formed LaTeX and plain text untouched', () => {
    const good = 'If $\\sin\\theta = \\frac{1}{2}$, then $\\theta = 30^{\\circ}$.';
    expect(normalizeMathText(good)).toBe(good);
    const prose = 'Ravi has 5 mangoes and eats 2.';
    expect(normalizeMathText(prose)).toBe(prose);
  });

  test('does not touch \\text{...} outside math delimiters or pair currency across lines', () => {
    const outside = 'Write \text{sin} here.';
    // control-char repair still applies (a tab before a lowercase letter is
    // never legitimate), but the \text -> \sin rewrite must not.
    expect(normalizeMathText(outside)).toBe('Write \\text{sin} here.');
    const currency = 'It costs $5 today.\nTomorrow it costs $10.';
    expect(normalizeMathText(currency)).toBe(currency);
  });
});

describe('normalizeAssessmentMath', () => {
  test('repairs every text field of a document', () => {
    const doc = normalizeAssessmentMath({
      instructions: 'Evaluate each $\theta$ expression.',
      questions: [
        {
          type: 'mcq',
          text: 'What is $\tan 45^\text{o}$?',
          options: ['$1$', '$0$', '$\frac{1}{2}$', '$\text{sqrt}(2)$'],
          correctOptionIndex: 0,
          correctAnswer: '',
        },
        {
          type: 'short_answer',
          text: 'Simplify $\frac{2}{4}$.',
          options: [],
          correctOptionIndex: -1,
          correctAnswer: '$\frac{1}{2}$',
        },
      ],
    });
    expect(doc.instructions).toBe('Evaluate each $\\theta$ expression.');
    expect(doc.questions[0].text).toBe('What is $\\tan 45^{\\circ}$?');
    expect(doc.questions[0].options).toEqual(['$1$', '$0$', '$\\frac{1}{2}$', '$\\sqrt{2}$']);
    expect(doc.questions[1].correctAnswer).toBe('$\\frac{1}{2}$');
  });

  test('tolerates malformed shapes without throwing (validation rejects them later)', () => {
    expect(normalizeAssessmentMath(null)).toBe(null);
    expect(normalizeAssessmentMath('not an object')).toBe('not an object');
    expect(normalizeAssessmentMath({ questions: 'nope' })).toEqual({ questions: 'nope' });
    expect(normalizeAssessmentMath({ instructions: 1, questions: [null, 5] }))
      .toEqual({ instructions: 1, questions: [null, 5] });
  });
});
