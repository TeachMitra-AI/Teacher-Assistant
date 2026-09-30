// Request validation for POST /api/resources/generate-set (batched assessments).
// Classroom Mode used to cost seven Gemini calls per question, and on the free tier's 20 requests/minute the rate
// limit is the binding constraint. Batching the four question-shaped artifacts (shared schema, prompt and
// renderer) into one call cuts it to four. The lesson plan stays separate: it has no questions or answer key.
const { z } = require('zod');

const { FORMATS, DIFFICULTIES, QUESTION_TYPES, MIN_QUESTIONS, MAX_QUESTIONS } = require('./generateAssessment');
const { MAX_META, MAX_LANGUAGE } = require('../../lib/resourceFields');

// One requested artifact. What differs between artifacts (format, count, difficulty) lives here; shared fields live once on the parent.
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
    // Capped at FORMATS.length: a repeated format is a client bug, and an unbounded array buys an expensive request.
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
