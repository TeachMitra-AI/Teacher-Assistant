// Structured contract for AI-generated quiz/worksheet questions. Gemini returns question content only, as this JSON;
// the server owns numbering, option letters, the answer-key heading and the title block, so none of it can drift or leak Markdown.
// `correctOptionIndex` (not a letter) is the authoritative MCQ signal; an integer can't be off by one against `options`.
const { z } = require('zod');

const { convertMathSegments } = require('./mathNotation');

// Structured question model (docs/generator-v2-plan.md). `descriptive`, `fill_blank` and `match` are the new response
// types. `mixed` (actions/schemas/generateAssessment.js) is a request-only modifier, never stored on a question.
const QUESTION_TYPES = ['mcq', 'true_false', 'short_answer', 'descriptive', 'fill_blank', 'match'];
const OPTION_LETTERS = ['A', 'B', 'C', 'D'];

// fill_blank's blank marker: three or more underscores, as the client's ExamHeaderView.tsx uses for an unset field.
const BLANK_MARKER_RE = /_{3,}/;

const MAX_MODEL_ANSWER = 2000; // descriptive's open-ended suggested answer
const MAX_PAIR_TEXT = 200; // match's per-side text
const MIN_MATCH_PAIRS = 3;
const MAX_MATCH_PAIRS = 8;

// LaTeX-in-JSON repair. Gemini writes LaTeX between $...$, but in a JSON string a single-backslash command is an
// escape: JSON.parse turns "\tan" into TAB+"an" and "\frac" into FORMFEED+"rac". Constrained decoding also can't emit
// an invalid escape like "\s", so the model dodges \sin/\sqrt into "\text{sin }", "\text{sqrt}(3)", "60^\text{o}".
// The prompt asks for double backslashes but can't guarantee them, so these manglings are repaired after parse.

// A control character followed by a lowercase letter in question text is never real content: it is a JSON-eaten
// LaTeX command. Restoring the backslash rebuilds it (TAB+"an" -> \tan, FORMFEED+"rac" -> \frac).
// Backspace (from \beta/\binom) is found by string scan, since a regex would need \x08, which no-control-regex forbids.
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

// Bare (backslash-less) commands: the backslash is simply gone ("$frac59$" for "$\frac59$"). Unlike the other two
// manglings it leaves no evidence, and "frac59" is valid KaTeX that renders as italic f·r·a·c·59, so latexGuard's
// render check passes it.
// Applied only inside $...$ segments and never inside a \text{...} argument, where "the sum of" is prose.
// Two-letter commands (\pm, \mp, \mu, \ln) are excluded except \pi, since "pm" may really be p·m and a wrong repair
// is worse than a missed one.
const BARE_COMMANDS = [
  'dfrac', 'tfrac', 'frac', 'sqrt', 'times', 'div', 'cdots', 'cdot', 'ldots',
  'leq', 'geq', 'neq', 'approx', 'equiv', 'propto', 'infty',
  'alpha', 'beta', 'gamma', 'delta', 'theta', 'lambda', 'sigma', 'omega', 'phi', 'pi',
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'exp',
  'circ', 'angle', 'triangle', 'rightarrow', 'leftarrow',
  'overline', 'underline', 'binom', 'boxed', 'vec', 'sum', 'prod', 'int', 'lim',
  'quad', 'left', 'right',
].sort((a, b) => b.length - a.length); // longest first: \dfrac before \frac

// Not preceded by a backslash or letter (so "\frac" and "dfrac" are skipped), nor followed by a letter ("fraction" stays).
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

// Degenerate forms the model produces to dodge invalid escapes (\s, \c, \o). Applied only inside $...$, where \text{sin} can only mean \sin.
function normalizeDegenerateLatex(mathSource) {
  return restoreBareCommands(mathSource)
    .replace(/\\text\{\s*(sin|cos|tan|sec|cot|csc|log|ln)\s*\}/g, '\\$1 ')
    .replace(/\\text\{\s*(cosec|arcsin|arccos|arctan)\s*\}/g, '\\operatorname{$1} ')
    .replace(/\\text\{\s*sqrt\s*\}\s*\(([^()]*)\)/g, '\\sqrt{$1}')
    // Degree-as-\text{o}: braced and unbraced forms are separate alternatives, so the outer braces are consumed only as a
    // pair and the unbraced form at the end of a \frac argument doesn't eat its closing brace.
    .replace(/\^(?:\{\\text\{\s*o\s*\}\}|\\text\{\s*o\s*\})/g, '^{\\circ}');
}

/**
 * Repairs JSON-escape-mangled and degenerate LaTeX in one string. Control-char repair runs everywhere (no
 * legitimate use in question text); newline repair and degenerate-form normalization run only inside math
 * segments, where a "\n"-eaten \neq is unambiguous but a real newline in prose is not.
 */
function normalizeMathText(text) {
  // First, plain notation -> LaTeX: the model is asked for "5/9", so this path should carry almost all traffic.
  // convertMathSegments leaves anything unparseable or containing a backslash untouched, so the repairs below still see old content.
  const converted = convertMathSegments(text);
  const repaired = repairControlCharLatex(converted);
  // Inline segments are single-line only; a broader matcher could pair "$" from currency amounts on different lines
  // and corrupt the prose between. So newline repair applies only inside $$...$$ blocks.
  return repaired.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g, (segment) =>
    normalizeDegenerateLatex(segment.replace(/\n(?=[a-z])/g, '\\n'))
  );
}

// The renderer (renderAssessmentBody in routes/resources.js) numbers questions itself, but the model often numbers
// them too, giving "1. 1. Which fraction...". Requires a dot or bracket after at most two digits, so "5 apples are
// shared..." and "2026." are left alone.
const LEADING_NUMBER_RE = /^\s*\d{1,2}\s*[.)]\s+/;

function stripLeadingQuestionNumber(text) {
  return typeof text === 'string' ? text.replace(LEADING_NUMBER_RE, '') : text;
}

// Same for options: the renderer prefixes "A. ", so a model-supplied "A. 3/5" would render "A. A. 3/5". Single letter
// A-D plus a dot/bracket only; an option that is just "A" is left alone.
const LEADING_OPTION_RE = /^\s*[A-Da-d]\s*[.)]\s+/;

function stripLeadingOptionLetter(text) {
  return typeof text === 'string' ? text.replace(LEADING_OPTION_RE, '') : text;
}

/**
 * Applies normalizeMathText to every text field of a raw (pre-validation) assessment document from a Gemini
 * response. Tolerates any malformed shape; schema validation right after rejects those.
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
      if (typeof nq.modelAnswer === 'string') {
        nq.modelAnswer = normalizeMathText(nq.modelAnswer);
      }
      if (Array.isArray(nq.pairs)) {
        nq.pairs = nq.pairs.map((p) => {
          if (!p || typeof p !== 'object' || Array.isArray(p)) return p;
          return {
            ...p,
            left: typeof p.left === 'string' ? normalizeMathText(p.left) : p.left,
            right: typeof p.right === 'string' ? normalizeMathText(p.right) : p.right,
          };
        });
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
    // "True"/"False" for true_false, a model answer for short_answer, the fill-in text for fill_blank. Ignored for mcq
    // (correctOptionIndex is authoritative), descriptive and match.
    correctAnswer: z.string().trim().max(500),
    // Only for "descriptive": an open-ended suggested answer. Optional so objects built without it (e.g. the legacy
    // content->doc parser) still validate.
    modelAnswer: z.string().trim().max(MAX_MODEL_ANSWER).optional().default(''),
    // Only meaningful for "match" — the correct left/right pairing itself
    // (position IS the answer key; no separate correctAnswer needed).
    pairs: z
      .array(
        z.object({
          left: z.string().trim().min(1).max(MAX_PAIR_TEXT),
          right: z.string().trim().min(1).max(MAX_PAIR_TEXT),
        })
      )
      .max(MAX_MATCH_PAIRS)
      .optional()
      .default([]),
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
    } else if (q.type === 'descriptive') {
      if (q.modelAnswer.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['modelAnswer'],
          message: 'descriptive requires a non-empty modelAnswer.',
        });
      }
    } else if (q.type === 'fill_blank') {
      if (!BLANK_MARKER_RE.test(q.text)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['text'],
          message: 'fill_blank text must contain a blank, written as three or more underscores (___).',
        });
      }
      if (q.correctAnswer.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['correctAnswer'],
          message: 'fill_blank requires a non-empty correctAnswer.',
        });
      }
    } else if (q.type === 'match') {
      if (q.pairs.length < MIN_MATCH_PAIRS || q.pairs.length > MAX_MATCH_PAIRS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pairs'],
          message: `match requires between ${MIN_MATCH_PAIRS} and ${MAX_MATCH_PAIRS} pairs.`,
        });
      }
      const leftValues = q.pairs.map((p) => p.left.trim().toLowerCase());
      if (new Set(leftValues).size !== leftValues.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['pairs'],
          message: 'match pairs must have unique left-hand values.',
        });
      }
    }
  });

const assessmentDocumentSchema = z.object({
  instructions: z.string().trim().min(1).max(500),
  questions: z.array(questionSchema).min(1).max(30),
});

/**
 * Cross-checks the validated document against the request: zod validates each question's shape, but whether the
 * model produced the requested count and type is a check against the request.
 * @returns {string|null} an error message, or null if the document satisfies the request.
 */
function checkAgainstRequest(doc, { questionCount, questionType }) {
  if (doc.questions.length !== questionCount) {
    return `Expected exactly ${questionCount} questions, got ${doc.questions.length}.`;
  }
  // questionType may be an array (several specific types); each question only needs to match one of them. A single
  // value keeps the original "every question matches exactly this type" check.
  const types = Array.isArray(questionType) ? questionType : [questionType];
  if (!types.includes('mixed')) {
    const wrongType = doc.questions.find((q) => !types.includes(q.type));
    if (wrongType) {
      // Single-type request: identical wording to before this array support
      // existed. Genuine multi-select gets the "one of" phrasing instead.
      const expected = types.length === 1 ? `"${types[0]}"` : `one of "${types.join(', ')}"`;
      return `Expected every question to be ${expected}, got "${wrongType.type}".`;
    }
  }
  return null;
}

module.exports = {
  assessmentDocumentSchema,
  questionSchema,
  checkAgainstRequest,
  normalizeAssessmentMath,
  normalizeMathText,
  QUESTION_TYPES,
  OPTION_LETTERS,
  BLANK_MARKER_RE,
  MIN_MATCH_PAIRS,
  MAX_MATCH_PAIRS,
  // Exported for latexGuard's backstop check and for unit testing.
  BARE_COMMANDS,
  restoreBareCommands,
};
