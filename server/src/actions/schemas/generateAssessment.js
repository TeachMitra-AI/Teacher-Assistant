// Request schema for the Quiz / Worksheet Generator.
//
// THE definition — not a copy. Two consumers import this exact object:
//
//   1. routes/resources.js       — validates POST /api/resources/generate
//   2. actions/descriptors/…     — the `generate_assessment` capability
//                                  descriptor's `paramSchema` (from M2)
//
// That single-definition property is the whole point of the AI Action Router's
// M1 milestone, and it is load-bearing rather than tidy. If the router ever
// validated against a second, drifted copy, it would confidently produce
// parameter objects that the real endpoint rejects — the router would look
// correct right up until the teacher pressed Generate. Keeping one object means
// "the router thinks this is valid" and "the endpoint accepts this" cannot
// disagree.
//
// Do not add router-only fields (provenance, confidence, requestId) here or to
// anything validated by it: the schema is `.strict()` and rejects unknown keys,
// so router metadata must travel alongside `params`, never inside it.

const { z } = require('zod');

const { MAX_META, MAX_LANGUAGE } = require('../../lib/resourceFields');

// Closed vocabularies for the generator's structured options. From M2 these are
// also the values the capability descriptor advertises in its slot definitions,
// so a teacher typing "make it hard" and a teacher choosing "Hard" from the
// dropdown resolve to the same validated value.
//
// CLIENT COUNTERPART: client/src/config.ts (ASSESSMENT_FORMATS, DIFFICULTIES,
// QUESTION_TYPES, QUESTION_COUNT_MIN/MAX) holds the matching PICKER options.
// That is a presentation list, not a second validator — this module is the only
// runtime authority — but the values must agree, or the UI can offer an option
// the server rejects with a 400 the teacher cannot act on. CHANGE BOTH IN THE
// SAME COMMIT; a drift guard for this pair is a mandatory M2 acceptance
// criterion (docs/AI_ACTION_ROUTER_README.md §11).
// `exit_ticket` added for Classroom Mode (docs/classroom-mode.md P4). It is a
// FORMAT, not a new resource type — an exit ticket is a handful of questions
// with an answer key, which is exactly what this endpoint already produces, and
// it saves as `type: 'assessment'` like the others (D17). Its distinct shape
// (very few questions, checking one lesson's understanding) lives in
// FORMAT_META in routes/resources.js, not here: this list is the vocabulary,
// not the behaviour.
const FORMATS = ['quiz', 'worksheet', 'exit_ticket'];

// What the AI ACTION ROUTER advertises — deliberately a SUBSET of FORMATS.
//
// A subset is safe in a way a superset never is. The rule this module exists to
// enforce is that the router must not propose parameters the endpoint would
// reject; every value here is still in FORMATS, so that cannot happen. The
// router simply declines to route a format it does not advertise, and the
// teacher reaches it through the Generator page or Classroom Mode instead.
//
// WHY IT IS FROZEN AT quiz|worksheet: the router's classifier prompt is built
// from these values, and that prompt is pinned byte-for-byte by
// test/assistant/recoveryIsolation.test.js against the M7a evaluation baseline.
// Changing it invalidates every recorded eval cassette and, per that test's own
// note, requires "a full live pass and a variance band, not a replay" to
// re-validate. Classroom Mode has no need of the router — it calls the
// generation endpoint directly — so widening the vocabulary here would impose
// an expensive re-validation on an unrelated, not-yet-rolled-out feature to buy
// nothing.
//
// TO ADD A FORMAT HERE LATER: budget for that live eval pass and update
// FROZEN_PROMPT_SHA16 in the same commit, saying why.
const ROUTABLE_FORMATS = ['quiz', 'worksheet'];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const QUESTION_TYPES = ['mcq', 'true_false', 'short_answer', 'mixed'];

// Question-count bounds. MAX_QUESTIONS is also enforced outside this schema, by
// the `more_questions` AI-assist action in routes/resources.js, so that adding
// questions to an existing assessment cannot quietly exceed a limit the original
// generation request was held to.
const MIN_QUESTIONS = 3;
const MAX_QUESTIONS = 30;

const MAX_TOPIC = 200;
const MAX_INSTRUCTIONS = 1000;

// `.strict()` rejects unknown keys. Every field here is either a closed enum, a
// bounded integer, or a length-bounded string: the structured config is what
// goes into the trusted systemInstruction, while `topic` and `instructions` are
// the only free text, and those are passed to the model as delimited untrusted
// content (see buildGeneratorPrompt in routes/resources.js).
const generateAssessmentSchema = z
  .object({
    format: z.enum(FORMATS),
    grade: z.string().trim().max(MAX_META).optional(),
    subject: z.string().trim().max(MAX_META).optional(),
    topic: z.string().trim().min(1).max(MAX_TOPIC),
    difficulty: z.enum(DIFFICULTIES),
    questionType: z.enum(QUESTION_TYPES),
    questionCount: z.number().int().min(MIN_QUESTIONS).max(MAX_QUESTIONS),
    language: z.string().trim().max(MAX_LANGUAGE).optional(),
    instructions: z.string().trim().max(MAX_INSTRUCTIONS).optional(),
  })
  .strict();

module.exports = {
  generateAssessmentSchema,
  FORMATS,
  ROUTABLE_FORMATS,
  DIFFICULTIES,
  QUESTION_TYPES,
  MIN_QUESTIONS,
  MAX_QUESTIONS,
  MAX_TOPIC,
  MAX_INSTRUCTIONS,
};
