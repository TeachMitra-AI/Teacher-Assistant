// Post-generation LaTeX safety guard.
//
// Root cause (see investigation, 2026-08-01): assessmentSchema.js's
// normalizeAssessmentMath repairs JSON-escape-mangled/degenerate LaTeX, but
// — by design, pinned by assessmentSchema.test.js's "does not touch
// \text{...} outside math delimiters" — it only ever touches text INSIDE an
// existing $...$/$$...$$ pair. Gemini sometimes drops the $ delimiters
// entirely around a unit-bearing quantity ("0.25\text{ mol}" with no $ at
// all), most often in MCQ "options" entries. Nothing downstream (this file,
// nor client/src/lib/math.ts) ever looks at text outside a $ pair, so that
// raw LaTeX reaches the teacher verbatim. Confirmed live against the real
// Gemini endpoint: a Chemistry MCQ response came back with
// options: ["0.25 \\text{ mol}", ...] — no delimiters — while the sibling
// Trigonometry run always wrapped its (delimiter-free-of-units) fractions.
//
// This module is a SECOND, independent pass run after normalizeAssessmentMath,
// treating Gemini's JSON as untrusted input:
//   1. detect bare LaTeX commands sitting outside $...$/$$...$$
//   2. mechanically repair the safe case (wrap a balanced-brace run in $...$)
//   3. verify EVERY math segment (old and newly-wrapped) actually renders in
//      KaTeX — the same engine the client uses — with throwOnError; nothing
//      is trusted on the strength of our own regex alone
//   4. anything that still fails is reported as unsafe; callers must not
//      forward that document to the client (see resources.js's retry loop)
const katex = require('katex');
const { BARE_COMMANDS } = require('./assessmentSchema');

// Same two patterns restoreBareCommands uses, rebuilt here rather than
// exported, so this backstop stays independent of the repair's internals —
// the point of a second pass is that it does not share the first one's state.
const BARE_COMMAND_RE = new RegExp(`(?<![\\\\a-zA-Z])(${BARE_COMMANDS.join('|')})(?![a-zA-Z])`, 'g');
const TEXT_ARG_RE = /\\(?:text|textbf|textit|textrm|mathrm|mbox|operatorname)\s*\{[^{}]*\}/g;

// Same shape as client/src/lib/math.ts's BLOCK_MATH/INLINE_MATH — kept as a
// separate copy (CJS server vs ESM client) rather than a cross-package
// import, same convention already used for repairBackspaceLatex in
// assessmentSchema.js. KEEP IN SYNC.
const BLOCK_MATH = /\$\$([\s\S]+?)\$\$/g;
const INLINE_MATH = /\$(\S(?:[^$\n]*?\S)?)\$/g;

/**
 * Finds every already-delimited math range in `text` (block first, so a
 * $$...$$ pair's inner $ characters are never mistaken for inline math),
 * mirroring math.ts's sequential-replace precedence without mutating text.
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

// Tokens allowed to extend a candidate bare-math run OUTSIDE brace
// arguments — deliberately narrow: digits/decimal point, a LaTeX command,
// a brace, a small arithmetic/relational operator set, and single spaces.
// Anything else (a plain word character, punctuation, a newline) ends the
// run — this is what keeps surrounding prose untouched, since a run is only
// ever kept if it contained at least one \command token.
const RUN_TOKEN_RE = /\\[a-zA-Z]+|[0-9]+(?:\.[0-9]+)?|[{}+\-=^_]|[ \t]|./g;

/**
 * Scans one "unprotected" stretch of text (i.e. already known to be outside
 * any existing $...$/$$...$$) for maximal bare-LaTeX runs safe to wrap.
 * A run must contain at least one \command and have balanced braces; braces
 * open a "verbatim" mode (matching \text{...}'s actual argument syntax)
 * where any character is allowed, since a unit argument like "km/h" or
 * "opposite side" is free text by design.
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
      // A run can start/end on a whitespace token picked up before we knew
      // whether a \command would follow (or after the last one, before we
      // knew the run was over) — trim those edge positions back to the
      // actual content so the wrap below never swallows a space that
      // separates the math from surrounding prose (e.g. "of 120\text{ km}
      // in" must keep both the space before "120" and the one before "in").
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
      // Inside a \command{...} argument: anything goes except we still track
      // brace depth so nested braces (rare, but \text{$x$} etc. is not our
      // concern here) don't prematurely end verbatim mode.
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
 * Wraps every safe bare-LaTeX run in `text` with $...$. Only ever touches
 * text OUTSIDE existing math ranges — content already inside $...$/$$...$$
 * is left completely alone (that's normalizeAssessmentMath's job).
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
 * True if a \command token still exists outside every $...$/$$...$$ range —
 * i.e. repairBareLatex found it but couldn't safely wrap it (unbalanced
 * braces), or some other bare command survives. Anything this returns true
 * for makes the document unsafe to forward to the client.
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
 * Verifies every math segment in `text` actually renders in KaTeX. This is
 * the real safety oracle: repairBareLatex's grammar is deliberately narrow,
 * but rather than trust it, every segment it produces (and every segment
 * that was already there) gets rendered for real before the document is
 * trusted.
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
 * Backstop for the backslash-less mangling repaired by
 * assessmentSchema.js's restoreBareCommands ("$frac59$" for "$\frac59$").
 *
 * This exists because findUnrenderableSegments CANNOT catch it: "frac59" is
 * valid KaTeX, so the render check passes and the teacher receives italic
 * gibberish. Renderability is not meaningfulness, and this is the one case
 * where the difference reaches a classroom.
 *
 * The repair upstream should have fixed it; anything still here means the
 * repair missed a form, and the document must not be forwarded.
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
 * Runs the full detect → repair → verify pipeline on one string field.
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
 * Applies sanitizeLatex to every text field of an assessment document
 * (instructions, and each question's text/options/correctAnswer). Expects
 * `doc` to already be schema-shaped enough to iterate (i.e. run this AFTER
 * normalizeAssessmentMath, same as normalizeAssessmentMath expects raw
 * pre-validation shape and tolerates the rest).
 * @param {{instructions?: string, questions?: object[]}} doc
 * @returns {{ ok: boolean, doc: object, errors: string[] }} `doc` is only
 *   meaningful when ok is true — callers must not forward it to the client
 *   otherwise.
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
 * Runs sanitizeLatex over an arbitrary set of already-extracted text fields.
 *
 * sanitizeAssessmentDocument above walks the assessment shape directly because
 * it predates there being a second shape. A lesson plan (P6) has ten named
 * sections and no questions, so rather than teach this module a second
 * document layout, the caller flattens its own document to {path, value} pairs
 * and gets the repaired values back keyed the same way. The LaTeX rules are
 * identical; only the traversal differs, and traversal is the caller's
 * business.
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
