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

// --- Regressions from the live Class 4 fractions quiz, 2026-08-07 -------------
//
// A teacher received a quiz reading "In the fraction f r a c 59, which number
// is the numerator?" and questions numbered "1. 1.". Both are model-output
// manglings that every layer downstream passed through, because both produce
// documents that are structurally valid and (for the LaTeX one) render without
// error. These tests pin the repairs.

describe('restoreBareCommands — backslash-less LaTeX', () => {
  test('repairs the reported case: $frac59$ renders as italic letters, not a fraction', () => {
    expect(normalizeMathText('In the fraction $frac59$, which is the numerator?'))
      .toBe('In the fraction $\\frac59$, which is the numerator?');
  });

  test('repairs the braced form too', () => {
    expect(normalizeMathText('$frac{5}{9}$')).toBe('$\\frac{5}{9}$');
  });

  test('leaves already-correct commands untouched', () => {
    expect(normalizeMathText('$\\frac{5}{9}$')).toBe('$\\frac{5}{9}$');
    expect(normalizeMathText('$\\frac59$')).toBe('$\\frac59$');
  });

  // The regex must not treat the "frac" inside "\dfrac" as a bare command,
  // which would produce the unrenderable "\d\frac".
  test('does not split a longer command that ends in a shorter one', () => {
    expect(normalizeMathText('$\\dfrac{1}{2}$')).toBe('$\\dfrac{1}{2}$');
    expect(normalizeMathText('$\\tfrac{1}{2}$')).toBe('$\\tfrac{1}{2}$');
  });

  // The mirror-image corruption: prose inside \text{...} is English by design.
  test('never touches prose inside a \\text{...} argument', () => {
    expect(normalizeMathText('$\\text{the sum of}$')).toBe('$\\text{the sum of}$');
    expect(normalizeMathText('$\\text{fraction of}$')).toBe('$\\text{fraction of}$');
    expect(normalizeMathText('$\\text{turn left}$')).toBe('$\\text{turn left}$');
  });

  test('leaves genuine variable juxtaposition alone', () => {
    expect(normalizeMathText('$abc$')).toBe('$abc$');
    expect(normalizeMathText('$xyz = 5$')).toBe('$xyz = 5$');
  });

  test('does not touch text outside math delimiters', () => {
    expect(normalizeMathText('Explain what a fraction is.')).toBe('Explain what a fraction is.');
    expect(normalizeMathText('Find the sum of two numbers.')).toBe('Find the sum of two numbers.');
  });
});

describe('duplicate numbering from the model', () => {
  test("strips the model's own question number — the renderer supplies it", () => {
    const doc = normalizeAssessmentMath({
      questions: [
        { type: 'mcq', text: '1. Which fraction is shaded?', options: ['A. 3/5', 'B. 2/5'], correctAnswer: 'A' },
        { type: 'short_answer', text: '2) Add the fractions.', correctAnswer: '3. 7/9' },
      ],
    });
    expect(doc.questions[0].text).toBe('Which fraction is shaded?');
    expect(doc.questions[1].text).toBe('Add the fractions.');
    expect(doc.questions[1].correctAnswer).toBe('7/9');
  });

  test("strips the model's own option letters", () => {
    const doc = normalizeAssessmentMath({
      questions: [{ type: 'mcq', text: 'Pick one', options: ['A. 3/5', 'B) 2/5', 'c. 1/5', '4/5'] }],
    });
    expect(doc.questions[0].options).toEqual(['3/5', '2/5', '1/5', '4/5']);
  });

  // The false positive that would matter most: a word problem opening with a
  // quantity must survive intact.
  test('a question that genuinely starts with a number is untouched', () => {
    const doc = normalizeAssessmentMath({
      questions: [
        { type: 'short_answer', text: '5 apples are shared between 2 friends. What fraction each?' },
        { type: 'short_answer', text: '12 students in a class of 30 wear glasses.' },
      ],
    });
    expect(doc.questions[0].text).toBe('5 apples are shared between 2 friends. What fraction each?');
    expect(doc.questions[1].text).toBe('12 students in a class of 30 wear glasses.');
  });

  test('an option that IS the letter A is not emptied', () => {
    const doc = normalizeAssessmentMath({
      questions: [{ type: 'mcq', text: 'Which letter marks the vertex?', options: ['A', 'B', 'C', 'D'] }],
    });
    expect(doc.questions[0].options).toEqual(['A', 'B', 'C', 'D']);
  });
});

// Structured Question Model (Generator v2) — the 3 new question types.
describe('assessmentDocumentSchema — new question types (Generator v2)', () => {
  function validDescriptive(overrides = {}) {
    return {
      type: 'descriptive',
      text: 'Explain why the sky appears blue.',
      options: [],
      correctOptionIndex: -1,
      correctAnswer: '',
      modelAnswer: 'Because of Rayleigh scattering of shorter wavelengths by the atmosphere.',
      ...overrides,
    };
  }

  function validFillBlank(overrides = {}) {
    return {
      type: 'fill_blank',
      text: 'The capital of France is ___.',
      options: [],
      correctOptionIndex: -1,
      correctAnswer: 'Paris',
      ...overrides,
    };
  }

  function validMatch(overrides = {}) {
    return {
      type: 'match',
      text: 'Match each planet to its position from the sun.',
      options: [],
      correctOptionIndex: -1,
      correctAnswer: '',
      pairs: [
        { left: 'Mercury', right: '1st' },
        { left: 'Venus', right: '2nd' },
        { left: 'Earth', right: '3rd' },
      ],
      ...overrides,
    };
  }

  test('accepts a well-formed document containing all 6 question types', () => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Answer all questions.',
      questions: [
        validMcq(), validTrueFalse(), validShortAnswer(), validDescriptive(), validFillBlank(), validMatch(),
      ],
    });
    expect(result.success).toBe(true);
  });

  test('rejects a descriptive question with an empty modelAnswer', () => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validDescriptive({ modelAnswer: '' })],
    });
    expect(result.success).toBe(false);
  });

  test('rejects a fill_blank question whose text has no blank marker', () => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validFillBlank({ text: 'The capital of France is Paris.' })],
    });
    expect(result.success).toBe(false);
  });

  test('accepts a fill_blank blank written with more than 3 underscores', () => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validFillBlank({ text: 'The capital of France is ______.' })],
    });
    expect(result.success).toBe(true);
  });

  test('rejects a fill_blank question with an empty correctAnswer', () => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validFillBlank({ correctAnswer: '' })],
    });
    expect(result.success).toBe(false);
  });

  test('rejects a match question with fewer than 3 pairs', () => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validMatch({ pairs: [{ left: 'A', right: '1' }, { left: 'B', right: '2' }] })],
    });
    expect(result.success).toBe(false);
  });

  test('rejects a match question with more than 8 pairs', () => {
    const pairs = Array.from({ length: 9 }, (_, i) => ({ left: `L${i}`, right: `R${i}` }));
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validMatch({ pairs })],
    });
    expect(result.success).toBe(false);
  });

  test('rejects a match question with duplicate left-hand values', () => {
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [validMatch({
        pairs: [
          { left: 'Mercury', right: '1st' },
          { left: 'mercury', right: '2nd' },
          { left: 'Earth', right: '3rd' },
        ],
      })],
    });
    expect(result.success).toBe(false);
  });

  test('a question object built without modelAnswer/pairs (legacy shape) still validates', () => {
    // Mirrors what routes/resources.js's legacy parseAssessmentBody path
    // constructs — it never sets these two new fields at all.
    const result = assessmentDocumentSchema.safeParse({
      instructions: 'Go.',
      questions: [{ type: 'mcq', text: 'Q?', options: ['A', 'B', 'C', 'D'], correctOptionIndex: 0, correctAnswer: '' }],
    });
    expect(result.success).toBe(true);
    expect(result.data.questions[0].modelAnswer).toBe('');
    expect(result.data.questions[0].pairs).toEqual([]);
  });
});
