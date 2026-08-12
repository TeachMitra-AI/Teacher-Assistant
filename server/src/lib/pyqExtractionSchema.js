// Structured contract for Gemini's per-page PYQ extraction output — Phase 3
// (docs/pyq-implementation-plan.md §7/§8). Same shape/purpose as
// lib/assessmentSchema.js's questionSchema, but for TRANSCRIPTION of a real
// printed exam page, not generation: every field here maps directly onto
// Question's own columns (schema.prisma), and nothing here invents content —
// Zod only checks the shape Gemini already claims to have transcribed.
//
// PYQ_QUESTION_TYPES now lives in lib/pyqVocab.js (Phase 5) — re-exported
// here so every existing importer of THIS file keeps working unchanged.
const { z } = require('zod');

const { LANGUAGE_NAMES } = require('../prompts');
const { normalizeMathText } = require('./assessmentSchema');
const { PYQ_QUESTION_TYPES } = require('./pyqVocab');

const PYQ_LANGUAGE_CODES = Object.keys(LANGUAGE_NAMES);

// OpenAPI-subset schema for Gemini's responseSchema (generationConfig.responseSchema
// in gemini.js's buildRequestBody) — same style as routes/resources.js's
// ASSESSMENT_RESPONSE_SCHEMA. `parentQuestionNumber` is deliberately absent
// from `required` so Gemini can omit it entirely for a non-sub-part question,
// rather than being forced to emit an empty-string placeholder.
const PYQ_PAGE_EXTRACTION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          questionNumber: { type: 'STRING' },
          parentQuestionNumber: { type: 'STRING' },
          requiresGroupSelection: { type: 'BOOLEAN' },
          language: { type: 'STRING', enum: PYQ_LANGUAGE_CODES },
          type: { type: 'STRING', enum: PYQ_QUESTION_TYPES },
          text: { type: 'STRING' },
          options: { type: 'ARRAY', items: { type: 'STRING' } },
          marks: { type: 'INTEGER' },
          correctAnswer: { type: 'STRING' },
          hasOfficialAnswer: { type: 'BOOLEAN' },
          hasDiagram: { type: 'BOOLEAN' },
          hasTable: { type: 'BOOLEAN' },
          confidence: { type: 'NUMBER' },
        },
        required: [
          'questionNumber', 'requiresGroupSelection', 'language', 'type', 'text',
          'options', 'marks', 'correctAnswer', 'hasOfficialAnswer', 'hasDiagram',
          'hasTable', 'confidence',
        ],
      },
    },
  },
  required: ['questions'],
};

const pyqExtractedQuestionSchema = z
  .object({
    questionNumber: z.string().trim().min(1).max(20),
    parentQuestionNumber: z.string().trim().min(1).max(20).optional(),
    requiresGroupSelection: z.boolean(),
    language: z.enum(PYQ_LANGUAGE_CODES),
    type: z.enum(PYQ_QUESTION_TYPES),
    text: z.string().trim().min(1).max(3000),
    options: z.array(z.string().trim().min(1).max(500)).max(4),
    marks: z.number().int().min(1).max(10),
    correctAnswer: z.string().trim().max(2000),
    hasOfficialAnswer: z.boolean(),
    hasDiagram: z.boolean(),
    hasTable: z.boolean(),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((q, ctx) => {
    if (q.type === 'mcq' && q.options.length !== 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'mcq question must have exactly 4 options.',
      });
    }
    // Trust-boundary check (§9/§11): a model that marks hasOfficialAnswer
    // true MUST have actually transcribed something — this rejects the
    // self-contradictory "true but empty" shape at validation time, on top
    // of the app-level enforcement in pyqWorker.js that ALSO never persists
    // correctAnswer when hasOfficialAnswer is false, regardless of this
    // check. Two independent enforcement points for the same rule, not one.
    if (q.hasOfficialAnswer && q.correctAnswer.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['correctAnswer'],
        message: 'hasOfficialAnswer=true requires a non-empty correctAnswer.',
      });
    }
  });

const pyqPageExtractionSchema = z.object({
  questions: z.array(pyqExtractedQuestionSchema).max(30),
});

/**
 * Applies normalizeMathText (lib/assessmentSchema.js — shared repair/convert
 * pipeline, not duplicated here) to every question's text/options/
 * correctAnswer BEFORE Zod validation. Tolerates any malformed shape — Zod
 * validation right after is what actually rejects those.
 */
function normalizePageExtractionMath(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  if (!Array.isArray(raw.questions)) return raw;
  return {
    ...raw,
    questions: raw.questions.map((q) => {
      if (!q || typeof q !== 'object' || Array.isArray(q)) return q;
      const nq = { ...q };
      if (typeof nq.text === 'string') nq.text = normalizeMathText(nq.text);
      if (Array.isArray(nq.options)) {
        nq.options = nq.options.map((o) => (typeof o === 'string' ? normalizeMathText(o) : o));
      }
      if (typeof nq.correctAnswer === 'string') nq.correctAnswer = normalizeMathText(nq.correctAnswer);
      return nq;
    }),
  };
}

module.exports = {
  PYQ_QUESTION_TYPES,
  PYQ_LANGUAGE_CODES,
  PYQ_PAGE_EXTRACTION_RESPONSE_SCHEMA,
  pyqExtractedQuestionSchema,
  pyqPageExtractionSchema,
  normalizePageExtractionMath,
};
