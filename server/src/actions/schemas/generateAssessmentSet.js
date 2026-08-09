// Request validation for POST /api/resources/generate-set (batched assessments).
//
// WHY BATCH AT ALL
// ----------------
// Classroom Mode previously cost SEVEN Gemini calls per teacher question:
// the coaching answer, the planner, and one per artifact. On the free tier's
// 20 requests/minute that is three questions before a teacher is throttled —
// and rate limit, not token price, is the binding constraint in the pilot.
//
// Batching the four QUESTION-SHAPED artifacts into one call takes that to
// four. They already share one schema, one prompt shape and one renderer, so
// this is a natural grouping rather than a union of unlike things.
//
// WHY THE LESSON PLAN IS NOT IN HERE
// ----------------------------------
// It has no questions and no answer key (D21). Putting it in this request
// would mean one response schema covering both "questions with an answer key"
// and "ten prose sections" — precisely the union D21 rejected. It keeps its
// own call, which also keeps the single largest output out of this response.
const { z } = require('zod');

const { FORMATS, DIFFICULTIES, QUESTION_TYPES, MIN_QUESTIONS, MAX_QUESTIONS } = require('./generateAssessment');
const { MAX_META, MAX_LANGUAGE } = require('../../lib/resourceFields');

// One requested artifact. Everything that differs BETWEEN artifacts — the
// format, how many questions, how hard — lives here; everything shared (topic,
// grade, subject, language) lives once on the parent, which is the whole
// token saving.
const itemSchema = z
  .object({
    format: z.enum(FORMATS),
    difficulty: z.enum(DIFFICULTIES),
    questionType: z.enum(QUESTION_TYPES),
    questionCount: z.number().int().min(MIN_QUESTIONS).max(MAX_QUESTIONS),
  })
  .strict();

const generateAssessmentSetSchema = z
  .object({
    topic: z.string().trim().min(1, 'Topic is required.').max(200, 'Topic is too long.'),
    grade: z.string().trim().max(MAX_META).optional().default(''),
    subject: z.string().trim().max(MAX_META).optional().default(''),
    language: z.string().trim().max(MAX_LANGUAGE).optional().default('en'),
    instructions: z.string().trim().max(1000).optional().default(''),
    // Upper bound is FORMATS.length: asking for the same format twice is a
    // client bug, and an unbounded array is a way to buy a very expensive
    // single request.
    items: z
      .array(itemSchema)
      .min(1, 'At least one artifact is required.')
      .max(FORMATS.length, 'Too many artifacts in one request.')
      .refine(
        (items) => new Set(items.map((i) => i.format)).size === items.length,
        { message: 'Each format may appear only once in a set.' }
      ),
  })
  .strict();

module.exports = { generateAssessmentSetSchema };
