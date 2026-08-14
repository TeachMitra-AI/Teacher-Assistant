// Request schema for POST /api/resources/generate-pyq — Phase 8
// (docs/pyq-implementation-plan.md §14). Mirrors generateAssessment.js's own
// "THE definition, not a copy" shape: one Zod object, `.strict()`, imported
// by the route that validates against it.
//
// CONTRACT DECISION (confirmed with the product owner before writing this
// file — recorded in the plan's Phase 8 completion record): §10's pseudocode
// names a `typeMix?` field (a target mix/count per question type), but §14's
// own API table — the plan's authoritative "API Design" section — instead
// lists `questionType?` (a single type filter, matching the existing AI
// generator's own field shape in generateAssessment.js) plus a `mode:
// 'pyq'|'hybrid'` field. The confirmed decision: implement §14 literally —
// a single optional `questionType` filter, and NO `mode` field at all, since
// Hybrid is explicitly postponed past MVP (§18, §20) and this endpoint only
// ever does PYQ-mode selection. A future Hybrid phase would add its own
// field/endpoint rather than resurrecting an unused enum here.
const { z } = require('zod');

const { MAX_LANGUAGE } = require('../../lib/resourceFields');
const { PYQ_CLASS_LEVELS, PYQ_QUESTION_TYPES } = require('../../lib/pyqVocab');

// MAX_QUESTIONS mirrors generateAssessment.js's own ceiling — no separate
// number is specified anywhere in the plan for PYQ mode, and there is no
// reason a real board paper would need more questions than the AI generator
// already allows. MIN_QUESTIONS is deliberately LOWER than the AI
// generator's own floor of 3: that floor exists because a very small AI
// generation call is barely worth the Gemini round-trip, a cost this
// endpoint never pays (§10/§11 — zero LLM calls). A teacher pulling just 1
// or 2 real historical questions (e.g. "show me the most-recurring question
// on this chapter") is a legitimate, cheap request here.
const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 30;

// A real board paper's total marks realistically sit well under 200; this is
// a generous, not a tight, ceiling — the exact-marks repair (§10 step 5) is
// only adequate "at this corpus's realistic scale," so an absurdly large
// request should fail validation here rather than reach the (bounded, cheap)
// selection algorithm at all.
const MIN_TOTAL_MARKS = 1;
const MAX_TOTAL_MARKS = 200;

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

const generatePyqSchema = z
  .object({
    boardId: z.string().trim().min(1),
    classLevel: z.enum(PYQ_CLASS_LEVELS),
    subjectId: z.string().trim().min(1),
    yearFrom: z.number().int().min(MIN_YEAR).max(MAX_YEAR),
    yearTo: z.number().int().min(MIN_YEAR).max(MAX_YEAR),
    totalMarks: z.number().int().min(MIN_TOTAL_MARKS).max(MAX_TOTAL_MARKS),
    questionCount: z.number().int().min(MIN_QUESTIONS).max(MAX_QUESTIONS),
    questionType: z.enum(PYQ_QUESTION_TYPES).optional(),
    prioritizeRecurring: z.boolean().default(false),
    language: z.string().trim().max(MAX_LANGUAGE).optional(),
  })
  .strict()
  .refine((data) => data.yearFrom <= data.yearTo, {
    message: 'yearFrom must be less than or equal to yearTo.',
    path: ['yearFrom'],
  });

module.exports = {
  generatePyqSchema,
  MIN_QUESTIONS,
  MAX_QUESTIONS,
  MIN_TOTAL_MARKS,
  MAX_TOTAL_MARKS,
  MIN_YEAR,
  MAX_YEAR,
};
