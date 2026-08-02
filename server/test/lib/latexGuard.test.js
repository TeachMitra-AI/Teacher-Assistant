const {
  sanitizeLatex,
  sanitizeAssessmentDocument,
  repairBareLatex,
  hasUnprotectedLatexCommand,
  findUnrenderableSegments,
} = require('../../src/lib/latexGuard');

describe('repairBareLatex', () => {
  test('wraps a bare number + \\text{unit} run in $...$ (the spec example)', () => {
    expect(repairBareLatex('30\\text{ km/h}')).toBe('$30\\text{ km/h}$');
    expect(repairBareLatex('0.5\\text{ mol}')).toBe('$0.5\\text{ mol}$');
  });

  test('wraps only the math portion of a sentence, preserving surrounding prose and spacing', () => {
    expect(repairBareLatex('A car travels 120\\text{ km} in 3\\text{ hours} today.')).toBe(
      'A car travels $120\\text{ km}$ in $3\\text{ hours}$ today.'
    );
  });

  test('wraps a bare quantity+unit chain (the actual observed failure shape)', () => {
    // The real regression is an isolated "<number>\text{unit}" run (MCQ
    // options); a full hand-written equation mixing bare variable names
    // ("F", "d") with LaTeX is a harder, out-of-scope case — the scanner is
    // deliberately conservative there (a bare single-letter variable ends a
    // run, same as any other prose character) rather than guessing where an
    // equation begins/ends. What matters for safety is that the result still
    // renders cleanly, asserted via findUnrenderableSegments below.
    const repaired = repairBareLatex('50\\text{ N} \\times 4\\text{ m} = 200\\text{ J}.');
    expect(repaired).toBe('$50\\text{ N} \\times 4\\text{ m} = 200\\text{ J}$.');
    expect(findUnrenderableSegments(repaired)).toEqual([]);
  });

  test('leaves plain prose with no LaTeX command untouched', () => {
    const prose = 'Ravi has 5 mangoes and eats 2.';
    expect(repairBareLatex(prose)).toBe(prose);
  });

  test('leaves already-delimited math untouched (idempotent)', () => {
    const text = 'The value is $30\\text{ km/h}$ today.';
    expect(repairBareLatex(text)).toBe(text);
  });

  test('does not touch bare "$" currency amounts with no LaTeX command', () => {
    const currency = 'It costs $5 today.\nTomorrow it costs $10.';
    expect(repairBareLatex(currency)).toBe(currency);
  });

  test('does not wrap a run with unbalanced braces — leaves it bare for the caller to reject', () => {
    const broken = 'The distance is 30\\text{ km/h today.';
    expect(repairBareLatex(broken)).toBe(broken);
  });
});

describe('hasUnprotectedLatexCommand', () => {
  test('true for an unbalanced-brace bare command repair could not wrap', () => {
    expect(hasUnprotectedLatexCommand('The distance is 30\\text{ km/h today.')).toBe(true);
  });

  test('false once a run has been safely wrapped', () => {
    expect(hasUnprotectedLatexCommand(repairBareLatex('30\\text{ km/h}'))).toBe(false);
  });

  test('false for plain prose', () => {
    expect(hasUnprotectedLatexCommand('Ravi has 5 mangoes.')).toBe(false);
  });
});

describe('findUnrenderableSegments', () => {
  test('empty for valid KaTeX inside $...$', () => {
    expect(findUnrenderableSegments('$30\\text{ km/h}$')).toEqual([]);
    expect(findUnrenderableSegments('$\\frac{1}{2} \\times 4$')).toEqual([]);
  });

  test('reports a segment KaTeX cannot parse', () => {
    const errors = findUnrenderableSegments('$\\frac{1}{$');
    expect(errors.length).toBe(1);
  });
});

describe('sanitizeLatex', () => {
  test('repairs and confirms renderable — ok: true', () => {
    const r = sanitizeLatex('0.25 \\text{ mol}');
    expect(r.ok).toBe(true);
    expect(r.text).toBe('$0.25 \\text{ mol}$');
    expect(r.errors).toEqual([]);
  });

  test('unbalanced braces — ok: false, not silently guessed at', () => {
    const r = sanitizeLatex('30\\text{ km/h');
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  test('empty/non-string input is a no-op pass-through', () => {
    expect(sanitizeLatex('')).toEqual({ text: '', ok: true, errors: [] });
  });
});

describe('sanitizeAssessmentDocument', () => {
  test('repairs the real captured Chemistry MCQ regression case end to end', () => {
    // Verbatim shape of the bare-\text{} options a live Gemini call produced
    // during the investigation for a Chemistry mole-concept MCQ.
    const doc = {
      instructions: 'Read each question carefully.',
      questions: [
        {
          type: 'mcq',
          text: 'What is the number of moles in $49 \\text{ g}$ of sulphuric acid?',
          options: ['0.25 \\text{ mol}', '0.5 \\text{ mol}', '1.0 \\text{ mol}', '2.0 \\text{ mol}'],
          correctOptionIndex: 1,
          correctAnswer: '',
        },
      ],
    };
    const result = sanitizeAssessmentDocument(doc);
    expect(result.ok).toBe(true);
    expect(result.doc.questions[0].options).toEqual([
      '$0.25 \\text{ mol}$',
      '$0.5 \\text{ mol}$',
      '$1.0 \\text{ mol}$',
      '$2.0 \\text{ mol}$',
    ]);
  });

  test('flags an unrepairable document as not ok', () => {
    const doc = {
      instructions: 'Fine.',
      questions: [
        {
          type: 'short_answer',
          text: 'The distance is 30\\text{ km/h today, unbalanced.',
          options: [],
          correctOptionIndex: -1,
          correctAnswer: 'irrelevant',
        },
      ],
    };
    const result = sanitizeAssessmentDocument(doc);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.startsWith('questions[0].text'))).toBe(true);
  });

  test('a well-formed, already-$-delimited document passes through unchanged', () => {
    const doc = {
      instructions: 'Answer the following.',
      questions: [
        {
          type: 'mcq',
          text: 'If $\\sin A = \\frac{3}{5}$, what is $\\tan A$?',
          options: ['$\\frac{4}{5}$', '$\\frac{3}{4}$', '$\\frac{5}{3}$', '$\\frac{4}{3}$'],
          correctOptionIndex: 1,
          correctAnswer: '',
        },
      ],
    };
    const result = sanitizeAssessmentDocument(doc);
    expect(result.ok).toBe(true);
    expect(result.doc).toEqual(doc);
  });

  test('non-object input passes through as ok (schema validation catches shape separately)', () => {
    expect(sanitizeAssessmentDocument(null)).toEqual({ ok: true, doc: null, errors: [] });
    expect(sanitizeAssessmentDocument([1, 2])).toEqual({ ok: true, doc: [1, 2], errors: [] });
  });
});
