// Plain school-maths notation -> LaTeX.
// Every LaTeX repair layer exists because the model writes LaTeX backslashes inside JSON strings and JSON
// escaping eats them ("\frac" becomes FORMFEED+"rac", "\sin" becomes "\text{sin}", sometimes the backslash just
// vanishes, giving "$frac59$"). Prompting for double backslashes isn't reliable. So the model writes backslash-free
// notation ("5/9", "x^2", "sqrt(16)", "45 deg") and this module converts it deterministically, where it can be tested.
// Scope: school maths (fractions, powers, roots, trig, logs, integrals, common Greek letters, comparisons, degrees),
// not a general algebra parser.
// Safety contract:
//   1. Input already containing a backslash is LaTeX and is returned unchanged, so saved resources still work.
//   2. Anything not parsed with confidence returns null and the caller keeps the original; a half-converted
//      expression is worse than an unconverted one.
//   3. The older repair layers stay behind this as a safety net.

// Functions rendered as LaTeX operators (\sin x), not as \text{}.
const FUNCTIONS = Object.freeze({
  sin: '\\sin', cos: '\\cos', tan: '\\tan',
  cot: '\\cot', sec: '\\sec', csc: '\\csc',
  cosec: '\\operatorname{cosec}',
  arcsin: '\\arcsin', arccos: '\\arccos', arctan: '\\arctan',
  log: '\\log', ln: '\\ln', exp: '\\exp',
});

// Named symbols. Greek letters are limited to those in Indian school maths and science; a longer list risks
// rewriting a variable named "eta".
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

// Recursive-descent parser. Precedence, loosest first:
//   comparison  := additive ( (= < > <= >= != ~= -> =>) additive )*
//   additive    := multiplicative ( (+ | -) multiplicative )*
//   multiplic.  := unary ( (* | / | times | div | juxtaposition) unary )*
//   unary       := '-'? power
//   power       := atom ( '^' unary )?
//   atom        := number | symbol | variable | func '(' expr ')' | '(' expr ')' | '|' expr '|'

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

  // "|" closes itself, so inside |...| a "|" can only end it, never start a juxtaposed factor ("|x|" would otherwise fail).
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
        // Word forms ("times", "div"), so the model needn't emit × or ÷. Checked before juxtaposition, which would read "times" as a variable.
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

      // integral(expr, var) is indefinite; integral(lower, upper, expr, var) is definite. The last argument must be the
      // bare differential variable.
      if (lower === 'integral' && at('punct', '(')) {
        eat();
        const args = [comparison()];
        if (args[0] === null) return null;
        while (at('punct', ',')) {
          eat();
          const arg = comparison();
          if (arg === null) return null;
          args.push(arg);
        }
        if (!expect('punct', ')')) return null;

        const varNode = args[args.length - 1];
        if (varNode.kind !== 'var') return null;

        if (args.length === 2) {
          return { kind: 'integral', lower: null, upper: null, integrand: args[0], variable: varNode.value };
        }
        if (args.length === 4) {
          return { kind: 'integral', lower: args[0], upper: args[1], integrand: args[2], variable: varNode.value };
        }
        return null;
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

      // A variable. Single letters are the norm; a multi-letter run is a word ("apples") that doesn't belong in math, so bail.
      if (name.length === 1) return { kind: 'var', value: name };
      return null;
    }

    return null;
  }

  const tree = comparison();
  // Trailing tokens mean we did not understand the whole expression.
  return tree !== null && pos === tokens.length ? tree : null;
}

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
      // Strip parentheses a group only needed for precedence; \frac's braces already group and "\frac{(a+b)}{2}" looks wrong.
      return `\\frac{${emitUnwrapped(node.num)}}{${emitUnwrapped(node.den)}}`;
    case 'integral': {
      const bounds = node.lower ? `_{${emit(node.lower)}}^{${emit(node.upper)}}` : '';
      return `\\int${bounds} ${emit(node.integrand)}\\, d${node.variable}`;
    }
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
 * Convert every $...$ / $$...$$ segment from plain notation to LaTeX. Segments already in LaTeX or
 * unparseable are left as they are, so this never makes a document worse.
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
