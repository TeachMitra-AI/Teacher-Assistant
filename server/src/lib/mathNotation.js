// Plain school-maths notation → LaTeX.
//
// WHY THIS EXISTS
// ---------------
// Every LaTeX repair layer in this codebase (repairControlCharLatex,
// normalizeDegenerateLatex, restoreBareCommands, repairBareLatex) exists for
// ONE root cause: we ask the model to write LaTeX backslashes inside JSON
// strings, and JSON escaping eats backslashes. "\frac" becomes FORMFEED+"rac";
// the model dodges "\sin" (an invalid JSON escape) into "\text{sin}"; and
// sometimes the backslash simply vanishes, producing "$frac59$" — valid KaTeX
// that renders as five italic letters and reached a real teacher on 2026-08-07.
//
// The prompt already DEMANDS double-backslash escaping, in capitals. It does
// not work reliably, and no amount of prompt will make it: a model instruction
// is a request, not a guarantee. Each new way the model gets it wrong has cost
// another repair pass.
//
// So: stop asking for backslashes. The model writes "5/9", "x^2", "sqrt(16)",
// "45 deg" — notation with NO backslashes, so there is nothing for JSON to
// corrupt — and this module turns it into LaTeX deterministically, in code we
// can unit-test rather than hope about.
//
// SCOPE: school maths. Fractions, powers, roots, trig, logs, the Greek letters
// that appear in Indian school textbooks, comparison operators, degrees. Not a
// general computer-algebra parser, and deliberately not one.
//
// SAFETY CONTRACT — the most important part of this file:
//   1. Input that already contains a backslash is LaTeX. Returned UNCHANGED.
//      That keeps every existing saved resource, and any model that ignores
//      the new prompt, working exactly as before.
//   2. Anything this module cannot parse with confidence returns null, and the
//      caller leaves the original text alone. A half-converted expression is
//      worse than an unconverted one, so "don't guess" beats "try harder" —
//      the same rule stripAssessmentPreamble already follows.
//   3. The existing repair layers stay in place behind this as a safety net.
//      They become dead code only once live traffic proves this path holds.

// Functions rendered as LaTeX operators (\sin x), not as \text{}.
const FUNCTIONS = Object.freeze({
  sin: '\\sin', cos: '\\cos', tan: '\\tan',
  cot: '\\cot', sec: '\\sec', csc: '\\csc',
  cosec: '\\operatorname{cosec}',
  arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan',
  log: '\\log', ln: '\\ln', exp: '\\exp',
});

// Named symbols. Greek letters limited to the ones that actually appear in
// Indian school maths and science — a longer list is more surface for a
// variable named "eta" to be silently rewritten.
const SYMBOLS = Object.freeze({
  pi: '\\pi', theta: '\\theta', alpha: '\\alpha', beta: '\\beta',
  gamma: '\\gamma', delta: '\\delta', lambda: '\\lambda', mu: '\\mu',
  sigma: '\\sigma', omega: '\\omega', phi: '\\phi', rho: '\\rho',
  infinity: '\\infty', inf: '\\infty',
});

// Multi-character operators, longest first so "<=" never lexes as "<" then "=".
const OPERATORS = [
  ['<=', '\\leq'], ['>=', '\\geq'], ['!=', '\\neq'], ['~=', '\\approx'],
  ['+-', '\\pm'], ['-+', '\\mp'], ['->', '\\rightarrow'], ['=>', '\\Rightarrow'],
  ['<', '<'], ['>', '>'], ['=', '='],
];

// ---- Tokenizer --------------------------------------------------------------

function tokenize(src) {
  const tokens = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i];

    if (ch === ' ' || ch === '\t') { i += 1; continue; }

    // Number (integer or decimal). A leading/trailing dot is not a number.
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src[j])) j += 1;
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] || '')) {
        j += 1;
        while (j < src.length && /[0-9]/.test(src[j])) j += 1;
      }
      tokens.push({ type: 'number', value: src.slice(i, j) });
      i = j;
      continue;
    }

    // Identifier: a function name, a named symbol, "deg", or a variable.
    if (/[a-zA-Z]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j += 1;
      tokens.push({ type: 'ident', value: src.slice(i, j) });
      i = j;
      continue;
    }

    const two = src.slice(i, i + 2);
    const op = OPERATORS.find(([sym]) => sym === two) || OPERATORS.find(([sym]) => sym === ch);
    if (op) {
      tokens.push({ type: 'op', value: op[0] });
      i += op[0].length;
      continue;
    }

    if ('+-*/^(),|%'.includes(ch)) {
      tokens.push({ type: 'punct', value: ch });
      i += 1;
      continue;
    }

    // Anything else (%, currency, a stray letter from another script) means
    // this is not an expression we understand. Bail rather than guess.
    return null;
  }

  return tokens;
}

// ---- Parser (recursive descent) ---------------------------------------------
//
// Precedence, loosest first:
//   comparison  :=  additive ( (= < > <= >= != ~= -> =>) additive )*
//   additive    :=  multiplicative ( (+ | -) multiplicative )*
//   multiplic.  :=  unary ( (* | / | times | div | juxtaposition) unary )*
//   unary       :=  '-'? power
//   power       :=  atom ( '^' unary )?
//   atom        :=  number | symbol | variable | func '(' expr ')'
//                 | '(' expr ')' | '|' expr '|'

function parse(tokens) {
  let pos = 0;

  const peek = () => tokens[pos];
  const at = (type, value) => {
    const t = peek();
    return !!t && t.type === type && (value === undefined || t.value === value);
  };
  const eat = () => tokens[pos++];
  const expect = (type, value) => (at(type, value) ? eat() : null);

  function comparison() {
    let left = additive();
    if (left === null) return null;
    while (at('op')) {
      const { value } = eat();
      const right = additive();
      if (right === null) return null;
      const latex = (OPERATORS.find(([sym]) => sym === value) || [])[1] || value;
      left = { kind: 'binary', latex, left, right };
    }
    return left;
  }

  function additive() {
    let left = multiplicative();
    if (left === null) return null;
    while (at('punct', '+') || at('punct', '-')) {
      const { value } = eat();
      const right = multiplicative();
      if (right === null) return null;
      left = { kind: 'binary', latex: value, left, right };
    }
    return left;
  }

  // "|" is its own closing delimiter, so while we are inside |...| a "|" can
  // only be the END of it — never the start of a juxtaposed factor. Without
  // this, "|x|" parses the closing bar as a new opening bar and fails.
  let absDepth = 0;

  // A term that can start a factor — used to detect juxtaposition ("2x", "3pi").
  const startsFactor = () =>
    at('number') || at('ident') || at('punct', '(') || (at('punct', '|') && absDepth === 0);

  function multiplicative() {
    let left = unary();
    if (left === null) return null;

    for (;;) {
      if (at('punct', '*')) {
        eat();
        const right = unary();
        if (right === null) return null;
        left = { kind: 'binary', latex: '\\times ', left, right };
      } else if (at('punct', '/')) {
        eat();
        const right = unary();
        if (right === null) return null;
        // The whole point of the exercise: "/" becomes a real fraction.
        left = { kind: 'frac', num: left, den: right };
      } else if (at('ident', 'times') || at('ident', 'div')) {
        // Word forms, so the model never needs the × or ÷ Unicode characters
        // the prompt forbids. Checked BEFORE the juxtaposition branch below,
        // which would otherwise treat "times" as a variable.
        const { value } = eat();
        const right = unary();
        if (right === null) return null;
        left = value === 'div'
          ? { kind: 'binary', latex: '\\div', left, right }
          : { kind: 'binary', latex: '\\times', left, right };
      } else if (startsFactor()) {
        // Implicit multiplication: "2x", "3pi", "2(a+b)". Rendered as
        // juxtaposition, which is what a maths teacher writes.
        const right = unary();
        if (right === null) return null;
        left = { kind: 'juxta', left, right };
      } else {
        return left;
      }
    }
  }

  function unary() {
    if (at('punct', '-')) {
      eat();
      const operand = unary();
      return operand === null ? null : { kind: 'neg', operand };
    }
    return power();
  }

  function power() {
    let base = atom();
    if (base === null) return null;
    if (at('punct', '^')) {
      eat();
      const exp = unary();
      if (exp === null) return null;
      base = { kind: 'pow', base, exp };
    }
    // Postfix percent ("25%"). Escaped in LaTeX because a bare % starts a
    // comment and would silently swallow the rest of the expression.
    if (at('punct', '%')) {
      eat();
      base = { kind: 'percent', inner: base };
    }
    return base;
  }

  function atom() {
    if (at('number')) return { kind: 'number', value: eat().value };

    if (at('punct', '(')) {
      eat();
      const inner = comparison();
      if (inner === null || !expect('punct', ')')) return null;
      return { kind: 'group', inner };
    }

    if (at('punct', '|')) {
      eat();
      absDepth += 1;
      const inner = comparison();
      absDepth -= 1;
      if (inner === null || !expect('punct', '|')) return null;
      return { kind: 'abs', inner };
    }

    if (at('ident')) {
      const name = eat().value;
      const lower = name.toLowerCase();

      // sqrt(...) and cbrt(...) are the only functions whose argument becomes
      // a braced LaTeX group rather than following the operator.
      if ((lower === 'sqrt' || lower === 'cbrt') && at('punct', '(')) {
        eat();
        const inner = comparison();
        if (inner === null || !expect('punct', ')')) return null;
        return { kind: 'root', degree: lower === 'cbrt' ? '3' : null, inner };
      }

      if (FUNCTIONS[lower] && at('punct', '(')) {
        eat();
        const inner = comparison();
        if (inner === null || !expect('punct', ')')) return null;
        return { kind: 'func', latex: FUNCTIONS[lower], inner };
      }

      // "45 deg" — a postfix unit, so it is handled by the caller as a symbol
      // that attaches to what precedes it. Here it is just a symbol.
      if (lower === 'deg' || lower === 'degree' || lower === 'degrees') {
        return { kind: 'raw', latex: '^{\\circ}' };
      }

      if (SYMBOLS[lower]) return { kind: 'raw', latex: SYMBOLS[lower] };

      // A bare function name with no parentheses ("sin x") — still valid.
      if (FUNCTIONS[lower]) return { kind: 'raw', latex: `${FUNCTIONS[lower]} ` };

      // A variable. Single letters are the overwhelmingly common case; a
      // multi-letter run is a word ("apples"), which does not belong inside
      // maths delimiters at all — bail rather than italicise prose.
      if (name.length === 1) return { kind: 'var', value: name };
      return null;
    }

    return null;
  }

  const tree = comparison();
  // Trailing tokens mean we did not understand the whole expression.
  return tree !== null && pos === tokens.length ? tree : null;
}

// ---- Emitter ----------------------------------------------------------------

function emit(node) {
  switch (node.kind) {
    case 'number': return node.value;
    case 'var': return node.value;
    case 'raw': return node.latex;
    case 'group': return `(${emit(node.inner)})`;
    case 'abs': return `\\left|${emit(node.inner)}\\right|`;
    case 'neg': return `-${emit(node.operand)}`;
    case 'percent': return `${emit(node.inner)}\\%`;
    case 'juxta': return `${emit(node.left)}${emit(node.right)}`;
    case 'binary': return `${emit(node.left)} ${node.latex} ${emit(node.right)}`.replace(/\s+/g, ' ').trim();
    case 'func': return `${node.latex}(${emit(node.inner)})`;
    case 'root':
      return node.degree
        ? `\\sqrt[${node.degree}]{${emit(node.inner)}}`
        : `\\sqrt{${emit(node.inner)}}`;
    case 'pow':
      return `${emit(node.base)}^{${emit(node.exp)}}`;
    case 'frac':
      // Strip the parentheses a group only needed for precedence — \frac's
      // braces already group, and "\frac{(a+b)}{2}" prints ugly brackets a
      // teacher would not write on a blackboard.
      return `\\frac{${emitUnwrapped(node.num)}}{${emitUnwrapped(node.den)}}`;
    default: return null;
  }
}

function emitUnwrapped(node) {
  return node.kind === 'group' ? emit(node.inner) : emit(node);
}

/**
 * Convert ONE plain-notation expression to LaTeX.
 * @param {string} source the text between $ delimiters, without backslashes
 * @returns {string|null} LaTeX, or null if it could not be parsed confidently
 */
function toLatex(source) {
  if (typeof source !== 'string') return null;
  const trimmed = source.trim();
  if (trimmed === '') return null;

  // Contract rule 1: already LaTeX, leave it entirely alone.
  if (trimmed.includes('\\')) return null;

  const tokens = tokenize(trimmed);
  if (tokens === null || tokens.length === 0) return null;

  const tree = parse(tokens);
  if (tree === null) return null;

  const latex = emit(tree);
  return typeof latex === 'string' && latex.length > 0 ? latex : null;
}

/**
 * Convert every $...$ / $$...$$ segment in a string from plain notation to
 * LaTeX. Segments that are already LaTeX, or that cannot be parsed, are left
 * exactly as they are — this never makes a document worse than it arrived.
 * @param {string} text
 * @returns {string}
 */
function convertMathSegments(text) {
  if (typeof text !== 'string' || !text.includes('$')) return text;

  return text
    .replace(/\$\$([\s\S]+?)\$\$/g, (whole, inner) => {
      const latex = toLatex(inner);
      return latex === null ? whole : `$$${latex}$$`;
    })
    .replace(/\$(\S(?:[^$\n]*?\S)?)\$/g, (whole, inner) => {
      const latex = toLatex(inner);
      return latex === null ? whole : `$${latex}$`;
    });
}

module.exports = {
  toLatex,
  convertMathSegments,
  FUNCTIONS,
  SYMBOLS,
};
