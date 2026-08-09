// Request validation for POST /api/resources/generate-lesson-plan (P6).
//
// Deliberately NOT added to the AI Action Router's advertised capabilities:
// the router's classifier prompt is pinned byte-for-byte against the M7a
// evaluation baseline (see ROUTABLE_FORMATS in generateAssessment.js, D20),
// and Classroom Mode calls this endpoint directly. Widening the router would
// invalidate every recorded eval cassette to buy nothing.
const { z } = require('zod');

// Same bound and same "a free string, validated against LANGUAGE_NAMES at the
// route" contract generateAssessment.js uses — not a second enum that could
// drift from it.
const { MAX_LANGUAGE, MAX_META } = require('../../lib/resourceFields');

// Lesson lengths a school day actually contains. A "duration" free-text field
// would let the model plan a 3-hour lesson for a 35-minute period, which is
// the single most common way a generated plan becomes unusable.
const DURATIONS = ['30 minutes', '35 minutes', '40 minutes', '45 minutes', '60 minutes'];

// Drives the Differentiation section. These are the three realities of an
// Indian government classroom that change how a lesson must be taught — not
// cosmetic preferences, which is why the plan is generated against one rather
// than mentioning all three generically.
const CLASSROOM_TYPES = ['standard', 'multi_grade', 'large_class', 'mixed_ability'];

const generateLessonPlanSchema = z
  .object({
    topic: z.string().trim().min(1, 'Topic is required.').max(200, 'Topic is too long.'),
    grade: z.string().trim().max(MAX_META, 'Grade is too long.').optional().default(''),
    subject: z.string().trim().max(MAX_META, 'Subject is too long.').optional().default(''),
    language: z.string().trim().max(MAX_LANGUAGE).optional().default('en'),
    duration: z.enum(DURATIONS).optional().default('40 minutes'),
    classroomType: z.enum(CLASSROOM_TYPES).optional().default('standard'),
    instructions: z.string().trim().max(1000, 'Additional instructions are too long.').optional().default(''),
  })
  .strict();

module.exports = {
  generateLessonPlanSchema,
  DURATIONS,
  CLASSROOM_TYPES,
};
