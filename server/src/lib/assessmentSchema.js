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
function repairControlCharLatex(text) {
  return text
    .replace(/\t(?=[a-z])/g, '\\t')
    .replace(/\f(?=[a-z])/g, '\\f')
    .replace(/\x08(?=[a-z])/g, '\\b')
    .replace(/\r(?=[a-z])/g, '\\r');
}

// Degenerate command forms the model produces to dodge invalid JSON escapes
// (\s, \c, \o...). Only applied INSIDE $...$ math segments, where \text{sin}
// can only mean the \sin the model couldn't emit.
function normalizeDegenerateLatex(mathSource) {
  return mathSource
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
  const repaired = repairControlCharLatex(text);
  // Inline segments are single-line only — a broader matcher could pair two
  // unrelated "$" (currency amounts on different lines) into one bogus
  // "segment" and corrupt the prose between them. Newline repair therefore
  // only ever applies inside $$...$$ blocks, the only place a real newline
  // can sit inside math.
  return repaired.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g, (segment) =>
    normalizeDegenerateLatex(segment.replace(/\n(?=[a-z])/g, '\\n'))
  );
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
      if (typeof nq.text === 'string') nq.text = normalizeMathText(nq.text);
      if (Array.isArray(nq.options)) {
        nq.options = nq.options.map((o) => (typeof o === 'string' ? normalizeMathText(o) : o));
      }
      if (typeof nq.correctAnswer === 'string') nq.correctAnswer = normalizeMathText(nq.correctAnswer);
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
};
