const { toLatex, convertMathSegments } = require('../../src/lib/mathNotation');

// This module exists to remove the root cause of every LaTeX repair layer:
// backslashes inside JSON strings. The model now writes "5/9"; this turns it
// into LaTeX in code we can test rather than a prompt we can only hope about.

describe('toLatex — the notation a teacher would actually write', () => {
  const cases = [
    ['5/9', '\\frac{5}{9}'],
    ['1/2 + 1/4', '\\frac{1}{2} + \\frac{1}{4}'],
    ['(a+b)/(c+d)', '\\frac{a + b}{c + d}'],
    ['(3+4)/7', '\\frac{3 + 4}{7}'],
    ['x^2', 'x^{2}'],
    ['x^(n+1)', 'x^{(n + 1)}'],
    ['sqrt(16)', '\\sqrt{16}'],
    ['cbrt(8)', '\\sqrt[3]{8}'],
    ['45 deg', '45^{\\circ}'],
    ['2x', '2x'],
    ['3pi', '3\\pi'],
    ['2(a+b)', '2(a + b)'],
    ['sin(x)', '\\sin(x)'],
    ['cos(2 theta)', '\\cos(2\\theta)'],
    ['cosec(x)', '\\operatorname{cosec}(x)'],
    ['log(100)', '\\log(100)'],
    ['2 times 3', '2 \\times 3'],
    ['10 div 2', '10 \\div 2'],
    ['x >= 5', 'x \\geq 5'],
    ['a != b', 'a \\neq b'],
    ['|x|', '\\left|x\\right|'],
    ['25%', '25\\%'],
    ['x^2 + 2x + 1', 'x^{2} + 2x + 1'],
  ];

  for (const [input, expected] of cases) {
    test(`"${input}" → ${expected}`, () => {
      expect(toLatex(input)).toBe(expected);
    });
  }

  // The \frac braces already group; "\frac{(a+b)}{2}" prints brackets no
  // teacher writes on a blackboard.
  test('drops the parentheses a fraction no longer needs', () => {
    expect(toLatex('(a+b)/2')).toBe('\\frac{a + b}{2}');
  });

  // A bare % starts a LaTeX comment and would swallow the rest of the line.
  test('escapes percent so it cannot comment out the expression', () => {
    expect(toLatex('25%')).toContain('\\%');
  });
});

describe('toLatex — the safety contract', () => {
  // Rule 1: anything already containing a backslash is LaTeX. Every saved
  // resource in the database is in that form, and so is output from a model
  // that ignores the new prompt.
  test('returns null for input that is already LaTeX, so it is left alone', () => {
    expect(toLatex('\\frac{1}{2}')).toBeNull();
    expect(toLatex('\\sin\\theta')).toBeNull();
  });

  // Rule 2: never guess. A half-converted expression is worse than an
  // unconverted one.
  test('returns null rather than guessing at prose', () => {
    expect(toLatex('apples')).toBeNull();
    expect(toLatex('hello world')).toBeNull();
    expect(toLatex('25% of 80')).toBeNull();
  });

  test('returns null on an unparseable fragment', () => {
    expect(toLatex('5 +')).toBeNull();
    expect(toLatex('(3 + 4')).toBeNull();
    expect(toLatex(')')).toBeNull();
    expect(toLatex('')).toBeNull();
    expect(toLatex('   ')).toBeNull();
  });

  test('returns null on characters outside school maths', () => {
    expect(toLatex('₹50')).toBeNull();
    expect(toLatex('5 → 6')).toBeNull();
  });

  test('tolerates non-strings without throwing', () => {
    expect(toLatex(null)).toBeNull();
    expect(toLatex(undefined)).toBeNull();
    expect(toLatex(42)).toBeNull();
  });

  // A multi-letter run is a word, not a variable. Italicising prose inside
  // math delimiters is exactly the "f r a c 59" failure in another costume.
  test('refuses to treat a word as a variable', () => {
    expect(toLatex('total')).toBeNull();
  });
});

describe('convertMathSegments', () => {
  test('converts inline segments and leaves the prose between them', () => {
    expect(convertMathSegments('What is $5/9$ of $x^2$?')).toBe(
      'What is $\\frac{5}{9}$ of $x^{2}$?'
    );
  });

  test('converts display segments', () => {
    expect(convertMathSegments('$$7/10 - 2/10$$')).toBe('$$\\frac{7}{10} - \\frac{2}{10}$$');
  });

  test('leaves an already-LaTeX segment untouched', () => {
    const already = 'Find $\\frac{1}{2}$ of it.';
    expect(convertMathSegments(already)).toBe(already);
  });

  // The mixed case is the one that matters during rollout: a model that
  // half-adopts the new notation must not produce a half-broken document.
  test('handles a document mixing both notations', () => {
    expect(convertMathSegments('Compare $1/2$ with $\\frac{1}{4}$.')).toBe(
      'Compare $\\frac{1}{2}$ with $\\frac{1}{4}$.'
    );
  });

  test('leaves an unparseable segment exactly as it arrived', () => {
    expect(convertMathSegments('The $apples$ here')).toBe('The $apples$ here');
  });

  test('text with no math is returned unchanged', () => {
    expect(convertMathSegments('Explain what a fraction is.')).toBe('Explain what a fraction is.');
  });

  test('tolerates non-strings', () => {
    expect(convertMathSegments(null)).toBe(null);
    expect(convertMathSegments(7)).toBe(7);
  });
});

describe('convertMathSegments output actually renders in KaTeX', () => {
  const katex = require('katex');

  // The real oracle. A converter that emits plausible-looking LaTeX which
  // KaTeX rejects would replace one silent failure with another.
  const inputs = [
    '5/9', '(a+b)/(c+d)', 'x^(n+1)', 'sqrt(16)', 'cbrt(8)', '45 deg',
    '3pi', 'cos(2 theta)', 'cosec(x)', '2 times 3', 'x >= 5', '|x|', '25%',
  ];

  for (const input of inputs) {
    test(`"${input}" produces renderable LaTeX`, () => {
      const latex = toLatex(input);
      expect(latex).not.toBeNull();
      expect(() => katex.renderToString(latex, { throwOnError: true })).not.toThrow();
    });
  }
});
