// Structured contract for AI-generated quiz/worksheet questions (Phase 1 of
// the quiz/worksheet generator rework — see the architecture review this
// implements).
//
// Gemini's job shrinks to question CONTENT only: it returns this JSON shape,
// never a formatted document. The server owns numbering, option-letter
// rendering, the answer-key heading, and the title/metadata block entirely
// itself — none of that is sourced from the model's own text anymore, so it
// can't drift, get mislabeled, or leak literal Markdown syntax.
//
// `correctOptionIndex` (not a letter) is the authoritative signal for MCQ
// correctness — an integer is unambiguous, where a letter risks an
// off-by-one mismatch against `options` if the model miscounts.
const { z } = require('zod');

const { convertMathSegments } = require('./mathNotation');

const QUESTION_TYPES = ['mcq', 'true_false', 'short_answer'];
const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

// --- LaTeX-in-JSON repair -----------------------------------------------------
// Gemini is told to write LaTeX between $...$ delimiters, but inside a JSON
// string a single-backslash command is a JSON escape sequence: JSON.parse
// silently turns "\tan" into TAB+"an", "\frac" into FORMFEED+"rac", "\theta"
// into TAB+"heta", and so on for all of \t \f \b \n \r. And because Gemini's
// constrained JSON decoding CANNOT emit an invalid escape like "\s", the model
// swerves around \sin/\sqrt into degenerate forms: "\text{sin }",
// "\text{sqrt}(3)", "60^\text{o}". Both failure modes were observed verbatim
// in real generated papers. The prompt now demands double-backslash escaping,
// but a model instruction is a request, not a guarantee — this repairs the
// deterministic manglings after parse, before validation/storage.

// A control character followed by a lowercase letter inside question text is
// never legitimate content — it is the corpse of a JSON-eaten LaTeX command.
// Restoring the backslash escape it came from reconstructs the command
// exactly: TAB+"an" → \tan, FORMFEED+"rac" → \frac, CR+"ight" → \right.
//
// Backspace (the "\b" of a JSON-eaten \beta/\binom) is handled with a plain
// string scan rather than a regex: a regex can only express that character
// as the \x08 control-character escape, which no-control-regex forbids.
function repairBackspaceLatex(text) {
  if (!text.includes('\b')) return text;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\b' && /[a-z]/.test(text[i + 1] || '')) out += '\\b';
    else out += ch;
  }
  return out;
}

function repairControlCharLatex(text) {
  return repairBackspaceLatex(
    text
      .replace(/\t(?=[a-z])/g, '\\t')
      .replace(/\f(?=[a-z])/g, '\\f')
      .replace(/\r(?=[a-z])/g, '\\r')
  );
}

// --- Bare (backslash-less) commands -------------------------------------------
// A THIRD mangling, distinct from the two above and far nastier because it is
// silent: the command arrives with its backslash simply gone — "$frac59$"
// rather than "$\frac59$".
//
// The other two manglings leave evidence. A JSON-eaten \frac leaves a FORMFEED
// control character; a degenerate \text{sqrt} leaves a \text. This one leaves
// nothing: "frac59" is PERFECTLY VALID KaTeX. It renders, without error, as the
// five italic variables f·r·a·c·59 — which is why latexGuard's render check
// (findUnrenderableSegments) passes it and a teacher receives a question
// reading "In the fraction f r a c 59, which number is the numerator?".
// Observed 2026-08-07 in a live Class 4 fractions quiz.
//
// Only ever applied INSIDE $...$ math segments, and never inside a \text{...}
// argument — "the sum of" is English prose there, and turning its "sum" into
// \sum would be the same class of corruption in reverse.
//
// Deliberately excludes two-letter commands (\pm, \mp, \mu, \ln) except \pi:
// in math mode "pm" really can be the product p·m, and a wrong repair is worse
// than a missed one. \pi is kept because p·i is vanishingly rare next to π.
const BARE_COMMANDS = [
  'dfrac', 'tfrac', 'frac', 'sqrt', 'times', 'div', 'cdots', 'cdot', 'ldots',
  'leq', 'geq', 'neq', 'approx', 'equiv', 'propto', 'infty',
  'alpha', 'beta', 'gamma', 'delta', 'theta', 'lambda', 'sigma', 'omega', 'phi', 'pi',
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'exp',
  'circ', 'angle', 'triangle', 'rightarrow', 'leftarrow',
  'overline', 'underline', 'binom', 'boxed', 'vec', 'sum', 'prod', 'int', 'lim',
  'quad', 'left', 'right',
].sort((a, b) => b.length - a.length); // longest first: \dfrac before \frac

// Not preceded by a backslash OR a letter (so "\frac" and the "frac" inside
// "\dfrac" are both skipped), and not followed by a letter (so the English
// word "fraction" is never mistaken for a mangled \frac).
const BARE_COMMAND_RE = new RegExp(`(?<![\\\\a-zA-Z])(${BARE_COMMANDS.join('|')})(?![a-zA-Z])`, 'g');

// Spans whose contents are prose by design and must never be repaired.
const TEXT_ARG_RE = /\\(?:text|textbf|textit|textrm|mathrm|mbox|operatorname)\s*\{[^{}]*\}/g;

function restoreBareCommands(mathSource) {
  let out = '';
  let cursor = 0;
  let m;
  TEXT_ARG_RE.lastIndex = 0;
  while ((m = TEXT_ARG_RE.exec(mathSource))) {
    out += mathSource.slice(cursor, m.index).replace(BARE_COMMAND_RE, '\\$1');
    out += m[0]; // \text{...} argument passes through verbatim
    cursor = m.index + m[0].length;
  }
  return out + mathSource.slice(cursor).replace(BARE_COMMAND_RE, '\\$1');
}

// Degenerate command forms the model produces to dodge invalid JSON escapes
// (\s, \c, \o...). Only applied INSIDE $...$ math segments, where \text{sin}
// can only mean the \sin the model couldn't emit.
function normalizeDegenerateLatex(mathSource) {
  return restoreBareCommands(mathSource)
    .replace(/\\text\{\s*(sin|cos|tan|sec|cot|csc|log|ln)\s*\}/g, '\\$1 ')
    .replace(/\\text\{\s*(cosec|arcsin|arccos|arctan)\s*\}/g, '\\operatorname{$1} ')
    .replace(/\\text\{\s*sqrt\s*\}\s*\(([^()]*)\)/g, '\\sqrt{$1}')
    // Degree-as-\text{o}: the braced (^{\text{o}}) and unbraced (^\text{o})
    // forms are separate alternatives so the outer braces are only consumed
    // as a PAIR — a lone \}? would eat the closing brace of an enclosing
    // \frac{...} argument when the unbraced form appears at its end.
    .replace(/\^(?:\{\\text\{\s*o\s*\}\}|\\text\{\s*o\s*\})/g, '^{\\circ}');
}

/**
 * Repairs JSON-escape-mangled and degenerate LaTeX in one string. Control-char
 * repair runs everywhere (those characters have no legitimate use in question
 * text); newline repair and degenerate-form normalization run only inside
 * $...$/$$...$$ segments, where a "\n"-eaten \neq is unambiguous but a real
 * newline in prose is not.
 */
function normalizeMathText(text) {
  // FIRST: plain notation → LaTeX. The model is now asked for "5/9", which has
  // no backslash for JSON to eat, so this is the path that should carry
  // essentially all traffic. convertMathSegments returns anything it cannot
  // parse confidently — and anything already containing a backslash —
  // completely untouched, so the repair layers below still see exactly what
  // they saw before for old content and for a model that ignores the prompt.
  const converted = convertMathSegments(text);
  const repaired = repairControlCharLatex(converted);
  // Inline segments are single-line only — a broader matcher could pair two
  // unrelated "$" (currency amounts on different lines) into one bogus
  // "segment" and corrupt the prose between them. Newline repair therefore
  // only ever applies inside $$...$$ blocks, the only place a real newline
  // can sit inside math.
  return repaired.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g, (segment) =>
    normalizeDegenerateLatex(segment.replace(/\n(?=[a-z])/g, '\\n'))
  );
}

// The renderer (routes/resources.js renderAssessmentBody) numbers every
// question itself — "1. ", "2. " — because it owns the document's structure.
// The model frequently numbers them a SECOND time inside the question text,
// producing "1. 1. Which fraction represents…" on the page, and the matching
// "1. 1. A" in the answer key. Observed 2026-08-07 in a live Class 4 quiz.
//
// Requires a dot or a bracket after the digits, so a question that genuinely
// opens with a quantity ("5 apples are shared between…") is never touched.
// Two digits at most: "12." is question twelve, "2026." is a year.
const LEADING_NUMBER_RE = /^\s*\d{1,2}\s*[.)]\s+/;

function stripLeadingQuestionNumber(text) {
  return typeof text === 'string' ? text.replace(LEADING_NUMBER_RE, '') : text;
}

// Same problem one level down: renderAssessmentBody prefixes each option with
// "A. ", "B. "… so a model-supplied "A. 3/5" renders as "A. A. 3/5".
// Single letter A-D only, and a following dot/bracket is required — an option
// whose whole content is the letter "A" (a valid answer to "which letter…")
// has nothing after it to strip and is left alone.
const LEADING_OPTION_RE = /^\s*[A-Da-d]\s*[.)]\s+/;

function stripLeadingOptionLetter(text) {
  return typeof text === 'string' ? text.replace(LEADING_OPTION_RE, '') : text;
}

/**
 * Applies normalizeMathText to every text field of a raw (pre-validation)
 * assessment document parsed from a Gemini JSON response. Tolerates any
 * malformed shape — schema validation right after is what rejects those.
 */
function normalizeAssessmentMath(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const out = { ...raw };
  if (typeof out.instructions === 'string') out.instructions = normalizeMathText(out.instructions);
  if (Array.isArray(out.questions)) {
    out.questions = out.questions.map((q) => {
      if (!q || typeof q !== 'object' || Array.isArray(q)) return q;
      const nq = { ...q };
      if (typeof nq.text === 'string') nq.text = stripLeadingQuestionNumber(normalizeMathText(nq.text));
      if (Array.isArray(nq.options)) {
        // Options are lettered by the renderer the same way questions are
        // numbered, so "A. 3/5" arrives doubly-lettered for the same reason.
        nq.options = nq.options.map((o) =>
          typeof o === 'string' ? stripLeadingOptionLetter(normalizeMathText(o)) : o
        );
      }
      if (typeof nq.correctAnswer === 'string') {
        nq.correctAnswer = stripLeadingQuestionNumber(normalizeMathText(nq.correctAnswer));
      }
      return nq;
    });
  }
  return out;
}

const questionSchema = z
  .object({
    type: z.enum(QUESTION_TYPES),
    text: z.string().trim().min(1).max(1000),
    // Only meaningful for "mcq" — validated below. Gemini is instructed to
    // send an empty array for other types.
    options: z.array(z.string().trim().min(1).max(300)).max(4),
    // Only meaningful for "mcq" — validated below. -1 for other types.
    correctOptionIndex: z.number().int(),
    // "True"/"False" for true_false, a model answer for short_answer,
    // unused (ignored) for mcq since correctOptionIndex is authoritative.
    correctAnswer: z.string().trim().max(500),
  })
  .superRefine((q, ctx) => {
    if (q.type === 'mcq') {
      if (q.options.length !== 4) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['options'],
          message: 'mcq question must have exactly 4 options.',
        });
      }
      if (q.correctOptionIndex < 0 || q.correctOptionIndex > 3) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['correctOptionIndex'],
          message: 'mcq correctOptionIndex must be between 0 and 3.',
        });
      }
    } else if (q.type === 'true_false') {
      const norm = q.correctAnswer.trim().toLowerCase();
      if (norm !== 'true' && norm !== 'false') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['correctAnswer'],
          message: 'true_false correctAnswer must be "True" or "False".',
        });
      }
    } else if (q.type === 'short_answer') {
      if (q.correctAnswer.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['correctAnswer'],
          message: 'short_answer requires a non-empty correctAnswer.',
        });
      }
    }
  });

const assessmentDocumentSchema = z.object({
  instructions: z.string().trim().min(1).max(500),
  questions: z.array(questionSchema).min(1).max(30),
});

/**
 * Cross-checks the validated document against the teacher's request — Zod
 * validates each question's own internal shape, but "did the model actually
 * produce the requested COUNT and TYPE" is a contract check against the
 * request, not the document alone.
 * @returns {string|null} an error message, or null if the document satisfies the request.
 */
function checkAgainstRequest(doc, { questionCount, questionType }) {
  if (doc.questions.length !== questionCount) {
    return `Expected exactly ${questionCount} questions, got ${doc.questions.length}.`;
  }
  if (questionType !== 'mixed') {
    const wrongType = doc.questions.find((q) => q.type !== questionType);
    if (wrongType) {
      return `Expected every question to be "${questionType}", got "${wrongType.type}".`;
    }
  }
  return null;
}

module.exports = {
  assessmentDocumentSchema,
  checkAgainstRequest,
  normalizeAssessmentMath,
  normalizeMathText,
  QUESTION_TYPES,
  OPTION_LETTERS,
  // Exported for latexGuard's backstop check and for unit testing.
  BARE_COMMANDS,
  restoreBareCommands,
};
