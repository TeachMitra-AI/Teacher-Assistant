// Post-generation LaTeX safety guard, a second pass after normalizeAssessmentMath. That function only repairs text
// inside an existing $...$/$$...$$ pair, but Gemini sometimes drops the delimiters around a unit-bearing quantity
// ("0.25\text{ mol}"), mostly in MCQ options, and nothing downstream looks outside a $ pair, so raw LaTeX reached teachers.
// Treating the JSON as untrusted, this pass:
//   1. detects bare LaTeX commands outside $...$/$$...$$
//   2. wraps the safe case (a balanced-brace run) in $...$
//   3. renders every math segment in KaTeX (the client's engine) with throwOnError, trusting no regex alone
//   4. reports anything that still fails as unsafe; callers must not forward that document (see resources.js's retry loop)
const katex = require('katex');
const { BARE_COMMANDS } = require('./assessmentSchema');

// Rebuilt here rather than exported from the repair code, so this backstop doesn't share the first pass's state.
const BARE_COMMAND_RE = new RegExp(`(?<![\\\\a-zA-Z])(${BARE_COMMANDS.join('|')})(?![a-zA-Z])`, 'g');
const TEXT_ARG_RE = /\\(?:text|textbf|textit|textrm|mathrm|mbox|operatorname)\s*\{[^{}]*\}/g;

// Same shape as BLOCK_MATH/INLINE_MATH in client/src/lib/math.ts, kept as a copy (CJS server vs ESM client), as
// with repairBackspaceLatex in assessmentSchema.js. Keep in sync.
const BLOCK_MATH = /\$\$([\s\S]+?)\$\$/g;
const INLINE_MATH = /\$(\S(?:[^$\n]*?\S)?)\$/g;

/**
 * Finds every already-delimited math range, block first so a $$...$$ pair's inner $ aren't read as inline math
 * (mirrors math.ts's replace precedence without mutating text).
 * @returns {Array<{start: number, end: number, source: string}>} non-overlapping, sorted by start
 */
function findExistingMathRanges(text) {
  const ranges = [];
  let m;

  BLOCK_MATH.lastIndex = 0;
  while ((m = BLOCK_MATH.exec(text))) {
    ranges.push({ start: m.index, end: m.index + m[0].length, source: m[1] });
  }

  INLINE_MATH.lastIndex = 0;
  while ((m = INLINE_MATH.exec(text))) {
    const start = m.index;
    const end = m.index + m[0].length;
    const overlapsBlock = ranges.some((r) => start < r.end && end > r.start);
    if (!overlapsBlock) ranges.push({ start, end, source: m[1] });
  }

  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

// Tokens that may extend a bare-math run outside brace arguments: digits, a LaTeX command, braces, a few
// operators and single spaces. Anything else ends the run, which keeps prose untouched; a run is only kept if it has a \command.
const RUN_TOKEN_RE = /\\[a-zA-Z]+|[0-9]+(?:\.[0-9]+)?|[{}+\-=^_]|[ \t]|./g;

/**
 * Scans a stretch of text outside any existing math for bare-LaTeX runs safe to wrap. A run needs at least one
 * \command and balanced braces; inside braces any character is allowed, since a \text argument like "km/h" is free text.
 * @param {string} chunk
 * @returns {Array<{start: number, end: number}>} offsets relative to chunk
 */
function findBareLatexRuns(chunk) {
  const runs = [];
  let runStart = -1;
  let runEnd = -1;
  let hasCommand = false;
  let depth = 0;
  let broken = false; // this run hit a stray closing brace — unrepairable, don't extend/keep it

  const flush = () => {
    if (runStart !== -1 && hasCommand && depth === 0 && !broken) {
      // Trim edge whitespace picked up before/after the \command so the wrap doesn't swallow a space that separates
      // math from prose ("of 120\text{ km} in" keeps the spaces before "120" and "in").
      let s = runStart;
      let e = runEnd;
      while (s < e && (chunk[s] === ' ' || chunk[s] === '\t')) s += 1;
      while (e > s && (chunk[e - 1] === ' ' || chunk[e - 1] === '\t')) e -= 1;
      if (s < e) runs.push({ start: s, end: e });
    }
    runStart = -1;
    runEnd = -1;
    hasCommand = false;
    depth = 0;
    broken = false;
  };

  RUN_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = RUN_TOKEN_RE.exec(chunk))) {
    const tok = m[0];
    const isCommand = /^\\[a-zA-Z]+$/.test(tok);
    const isNumber = /^[0-9]+(?:\.[0-9]+)?$/.test(tok);
    const isOperator = /^[+\-=^_]$/.test(tok);
    const isSpace = tok === ' ' || tok === '\t';
    const isOpenBrace = tok === '{';
    const isCloseBrace = tok === '}';

    if (depth > 0) {
      // Inside a \command{...} argument anything goes, but brace depth is still tracked so nesting doesn't end verbatim mode early.
      if (isOpenBrace) depth += 1;
      else if (isCloseBrace) depth -= 1;
      if (runStart === -1) runStart = m.index; // shouldn't happen, defensive
      runEnd = m.index + tok.length;
      continue;
    }

    if (isCommand || isNumber || isOperator || isSpace || isOpenBrace) {
      if (runStart === -1) runStart = m.index;
      runEnd = m.index + tok.length;
      if (isCommand) hasCommand = true;
      if (isOpenBrace) depth = 1;
      continue;
    }

    if (isCloseBrace) {
      // Stray '}' with no matching '{' in this run — mark unrepairable and
      // stop extending; flush() below will discard it (broken=true).
      if (runStart !== -1) {
        broken = true;
        runEnd = m.index + tok.length;
      }
      continue;
    }

    // Any other character (prose, punctuation, newline) ends the run.
    flush();
  }
  flush();

  return runs;
}

/**
 * Wraps every safe bare-LaTeX run outside existing math ranges in $...$. Content already inside math is left
 * alone (normalizeAssessmentMath's job).
 * @param {string} text
 * @returns {string}
 */
function repairBareLatex(text) {
  const protectedRanges = findExistingMathRanges(text);

  // Walk the unprotected stretches (the gaps between protected ranges),
  // collecting absolute-offset runs to wrap.
  const runsToWrap = [];
  let cursor = 0;
  for (const r of protectedRanges) {
    if (r.start > cursor) {
      const chunk = text.slice(cursor, r.start);
      for (const run of findBareLatexRuns(chunk)) {
        runsToWrap.push({ start: cursor + run.start, end: cursor + run.end });
      }
    }
    cursor = r.end;
  }
  if (cursor < text.length) {
    const chunk = text.slice(cursor);
    for (const run of findBareLatexRuns(chunk)) {
      runsToWrap.push({ start: cursor + run.start, end: cursor + run.end });
    }
  }

  if (runsToWrap.length === 0) return text;

  // Splice right-to-left so earlier offsets stay valid.
  let out = text;
  for (let i = runsToWrap.length - 1; i >= 0; i -= 1) {
    const { start, end } = runsToWrap[i];
    const raw = out.slice(start, end).trim();
    out = out.slice(0, start) + '$' + raw + '$' + out.slice(end);
  }
  return out;
}

/**
 * True if a \command token still exists outside every math range (unbalanced braces, or some other bare
 * command survived). That makes the document unsafe to forward.
 * @param {string} text
 * @returns {boolean}
 */
function hasUnprotectedLatexCommand(text) {
  const protectedRanges = findExistingMathRanges(text);
  const COMMAND_RE = /\\[a-zA-Z]+/g;

  let cursor = 0;
  const stretches = [];
  for (const r of protectedRanges) {
    if (r.start > cursor) stretches.push(text.slice(cursor, r.start));
    cursor = r.end;
  }
  if (cursor < text.length) stretches.push(text.slice(cursor));

  return stretches.some((chunk) => {
    COMMAND_RE.lastIndex = 0;
    return COMMAND_RE.test(chunk);
  });
}

/**
 * Verifies every math segment actually renders in KaTeX. This is the real safety check: rather than trust
 * repairBareLatex's narrow grammar, every segment, old and new, is rendered before the document is trusted.
 * @param {string} text
 * @returns {string[]} error messages, empty if every segment is valid
 */
function findUnrenderableSegments(text) {
  const errors = [];
  for (const { source } of findExistingMathRanges(text)) {
    try {
      katex.renderToString(source.trim(), { throwOnError: true, output: 'html' });
    } catch (e) {
      errors.push(`"${source}": ${e.message}`);
    }
  }
  return errors;
}

/**
 * Backstop for the backslash-less mangling repaired by restoreBareCommands in assessmentSchema.js ("$frac59$"
 * for "$\frac59$"). findUnrenderableSegments can't catch it because "frac59" is valid KaTeX that renders as
 * italic gibberish. Anything found here means the repair missed a form, and the document must not be forwarded.
 * @param {string} text
 * @returns {string[]} error messages, empty if every segment is clean
 */
function findBareCommandSegments(text) {
  const errors = [];
  for (const { source } of findExistingMathRanges(text)) {
    // Same \text{...}-protection as the repair: prose inside a text argument
    // is not a mangled command.
    const stripped = source.replace(TEXT_ARG_RE, '');
    BARE_COMMAND_RE.lastIndex = 0;
    const hit = BARE_COMMAND_RE.exec(stripped);
    if (hit) {
      errors.push(
        `"${source}": "${hit[1]}" is missing its backslash — this renders as italic letters, not as \\${hit[1]}.`
      );
    }
  }
  return errors;
}

/**
 * Runs detect, repair and verify on one string field.
 * @param {string} text
 * @returns {{ text: string, ok: boolean, errors: string[] }}
 */
function sanitizeLatex(text) {
  if (typeof text !== 'string' || text.length === 0) return { text, ok: true, errors: [] };

  const repaired = repairBareLatex(text);
  const errors = [];

  if (hasUnprotectedLatexCommand(repaired)) {
    errors.push('LaTeX command found outside $...$/$$...$$ that could not be safely repaired.');
  }
  errors.push(...findUnrenderableSegments(repaired));
  errors.push(...findBareCommandSegments(repaired));

  return { text: repaired, ok: errors.length === 0, errors };
}

/**
 * Applies sanitizeLatex to every text field of an assessment document (instructions, and each question's
 * text/options/correctAnswer). Run after normalizeAssessmentMath.
 * @param {{instructions?: string, questions?: object[]}} doc
 * @returns {{ ok: boolean, doc: object, errors: string[] }} `doc` is only meaningful when ok is true;
 *   otherwise callers must not forward it to the client.
 */
function sanitizeAssessmentDocument(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: true, doc, errors: [] };
  }

  const errors = [];
  const out = { ...doc };

  if (typeof out.instructions === 'string') {
    const r = sanitizeLatex(out.instructions);
    out.instructions = r.text;
    if (!r.ok) errors.push(...r.errors.map((e) => `instructions: ${e}`));
  }

  if (Array.isArray(out.questions)) {
    out.questions = out.questions.map((q, i) => {
      if (!q || typeof q !== 'object' || Array.isArray(q)) return q;
      const nq = { ...q };

      if (typeof nq.text === 'string') {
        const r = sanitizeLatex(nq.text);
        nq.text = r.text;
        if (!r.ok) errors.push(...r.errors.map((e) => `questions[${i}].text: ${e}`));
      }

      if (Array.isArray(nq.options)) {
        nq.options = nq.options.map((o, j) => {
          if (typeof o !== 'string') return o;
          const r = sanitizeLatex(o);
          if (!r.ok) errors.push(...r.errors.map((e) => `questions[${i}].options[${j}]: ${e}`));
          return r.text;
        });
      }

      if (typeof nq.correctAnswer === 'string') {
        const r = sanitizeLatex(nq.correctAnswer);
        nq.correctAnswer = r.text;
        if (!r.ok) errors.push(...r.errors.map((e) => `questions[${i}].correctAnswer: ${e}`));
      }

      if (typeof nq.modelAnswer === 'string') {
        const r = sanitizeLatex(nq.modelAnswer);
        nq.modelAnswer = r.text;
        if (!r.ok) errors.push(...r.errors.map((e) => `questions[${i}].modelAnswer: ${e}`));
      }

      if (Array.isArray(nq.pairs)) {
        nq.pairs = nq.pairs.map((p, j) => {
          if (!p || typeof p !== 'object' || Array.isArray(p)) return p;
          const np = { ...p };
          if (typeof np.left === 'string') {
            const r = sanitizeLatex(np.left);
            np.left = r.text;
            if (!r.ok) errors.push(...r.errors.map((e) => `questions[${i}].pairs[${j}].left: ${e}`));
          }
          if (typeof np.right === 'string') {
            const r = sanitizeLatex(np.right);
            np.right = r.text;
            if (!r.ok) errors.push(...r.errors.map((e) => `questions[${i}].pairs[${j}].right: ${e}`));
          }
          return np;
        });
      }

      return nq;
    });
  }

  return { ok: errors.length === 0, doc: out, errors };
}

/**
 * Runs sanitizeLatex over already-extracted text fields. The caller flattens its own document (e.g. a lesson
 * plan, which has no questions) to {path, value} pairs and gets repaired values back keyed the same way.
 *
 * @param {Array<{path: string, value: string}>} fields
 * @returns {{ ok: boolean, repaired: Record<string, string>, errors: string[] }}
 */
function sanitizeTextFields(fields) {
  const errors = [];
  const repaired = {};

  for (const { path, value } of fields) {
    const r = sanitizeLatex(value);
    repaired[path] = r.text;
    if (!r.ok) errors.push(...r.errors.map((e) => `${path}: ${e}`));
  }

  return { ok: errors.length === 0, repaired, errors };
}

module.exports = {
  sanitizeAssessmentDocument,
  sanitizeTextFields,
  sanitizeLatex,
  // Exported for unit testing only.
  repairBareLatex,
  hasUnprotectedLatexCommand,
  findUnrenderableSegments,
};
