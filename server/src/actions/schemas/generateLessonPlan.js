// Request validation for POST /api/resources/generate-lesson-plan.
// Not advertised by the router: its classifier prompt is pinned against the eval baseline (see ROUTABLE_FORMATS
// in generateAssessment.js), and Classroom Mode calls this endpoint directly.
const { z } = require('zod');

// Same bound and contract as generateAssessment.js: a free string validated against LANGUAGE_NAMES at the route.
const { MAX_LANGUAGE, MAX_META } = require('../../lib/resourceFields');

// Real lesson lengths. A free-text duration could plan a 3-hour lesson for a 35-minute period.
const DURATIONS = ['30 minutes', '35 minutes', '40 minutes', '45 minutes', '60 minutes'];

// Drives the Differentiation section: realities of an Indian government classroom that change how a lesson is taught.
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
