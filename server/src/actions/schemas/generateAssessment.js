// Request schema for the Quiz / Worksheet Generator. One definition, imported by routes/resources.js
// (POST /api/resources/generate) and used as the `generate_assessment` descriptor's `paramSchema`, so the router
// can't validate against a drifted copy and produce params the endpoint rejects.
// Don't add router-only fields (provenance, confidence, requestId) here: the schema is `.strict()`, so router
// metadata travels alongside `params`, never inside it.

const { z } = require('zod');

const { MAX_META, MAX_LANGUAGE } = require('../../lib/resourceFields');

// Closed vocabularies for the generator's options; the capability descriptor advertises these too.
// client/src/config.ts (ASSESSMENT_FORMATS, DIFFICULTIES, QUESTION_TYPES, QUESTION_COUNT_MIN/MAX) holds the matching
// picker options. This module is the only validator, but the values must agree or the UI offers options the server
// 400s. Change both together; a drift test guards the pair.
// `exit_ticket` and `homework` (docs/classroom-mode.md) are formats, not resource types: they save as
// `type: 'assessment'`, and their distinct shape lives in FORMAT_META in routes/resources.js.
const FORMATS = ['quiz', 'worksheet', 'exit_ticket', 'homework'];

// What the router advertises: a subset of FORMATS, so it can never propose a value the endpoint rejects.
// Frozen at quiz|worksheet because the classifier prompt is built from these values and pinned byte-for-byte by
// test/assistant/recoveryIsolation.test.js against the eval baseline. Adding a format needs a full live eval
// pass and an updated FROZEN_PROMPT_SHA16 in the same commit. Classroom Mode calls the endpoint directly.
const ROUTABLE_FORMATS = ['quiz', 'worksheet'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
// Structured question model (docs/generator-v2-plan.md): 'descriptive', 'fill_blank' and 'match' are the new
// response types (assessmentSchema.js's QUESTION_TYPES must match). 'mixed' is a request-only modifier, never a
// question's own type. The 3 new values are gated by STRUCTURED_QUESTIONS_ENABLED in routes/resources.js, so a
// cached client gets a clear 503 while the flag is off.
const QUESTION_TYPES = ['mcq', 'true_false', 'short_answer', 'descriptive', 'fill_blank', 'match', 'mixed'];
// The 3 values gated by STRUCTURED_QUESTIONS_ENABLED (routes/resources.js).
const NEW_QUESTION_TYPES = ['descriptive', 'fill_blank', 'match'];
// What the router advertises: the original 4 types, frozen for the same reason as ROUTABLE_FORMATS (widening
// QUESTION_TYPES changes the pinned prompt hash). The Generator form can still request the new types.
const ROUTABLE_QUESTION_TYPES = ['mcq', 'true_false', 'short_answer', 'mixed'];

// Accepts a bare string (existing callers) or a non-empty array (several specific types), so the change is
// additive. 'mixed' can't be combined with a specific list; "mix freely" and "only these" contradict.
const questionTypeSchema = z
  .union([z.enum(QUESTION_TYPES), z.array(z.enum(QUESTION_TYPES)).min(1).max(QUESTION_TYPES.length)])
  .refine(
    (value) => {
      const types = Array.isArray(value) ? value : [value];
      return !(types.includes('mixed') && types.length > 1);
    },
    { message: '"mixed" cannot be combined with other question types.' }
  );

// MAX_QUESTIONS is also enforced by the `more_questions` assist action in routes/resources.js, so adding
// questions can't exceed the limit the original request was held to.
const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 30;

const MAX_TOPIC = 200;
const MAX_INSTRUCTIONS = 1000;

// `.strict()` rejects unknown keys. Structured config goes into the trusted systemInstruction; `topic` and
// `instructions` are the only free text and are passed as delimited untrusted content (buildGeneratorPrompt in routes/resources.js).
const generateAssessmentSchema = z
  .object({
    format: z.enum(FORMATS),
    grade: z.string().trim().max(MAX_META).optional(),
    subject: z.string().trim().max(MAX_META).optional(),
    topic: z.string().trim().min(1).max(MAX_TOPIC),
    difficulty: z.enum(DIFFICULTIES),
    questionType: questionTypeSchema,
    questionCount: z.number().int().min(MIN_QUESTIONS).max(MAX_QUESTIONS),
    language: z.string().trim().max(MAX_LANGUAGE).optional(),
    instructions: z.string().trim().max(MAX_INSTRUCTIONS).optional(),
  })
  .strict();

// A validated `questionType` is a string or an array; consumers normalize through this.
function normalizeQuestionTypes(questionType) {
  return Array.isArray(questionType) ? questionType : [questionType];
}

module.exports = {
  generateAssessmentSchema,
  normalizeQuestionTypes,
  FORMATS,
  ROUTABLE_FORMATS,
  DIFFICULTIES,
  QUESTION_TYPES,
  NEW_QUESTION_TYPES,
  ROUTABLE_QUESTION_TYPES,
  MIN_QUESTIONS,
  MAX_QUESTIONS,
  MAX_TOPIC,
  MAX_INSTRUCTIONS,
};
