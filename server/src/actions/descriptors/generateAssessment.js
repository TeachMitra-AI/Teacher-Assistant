// Capability descriptor: generate_assessment.
//
// Describes the Quiz / Worksheet Generator as something the application can be
// ASKED to do. Pure data plus one schema reference — no logic, no I/O.
//
// The `paramSchema` below is a REFERENCE to the same object that validates
// POST /api/resources/generate. That is the whole point of milestone M1: the
// router cannot decide a payload is valid that the endpoint would then reject,
// because there is only one definition to disagree with.

const {
  generateAssessmentSchema,
  ROUTABLE_FORMATS,
  DIFFICULTIES,
  ROUTABLE_QUESTION_TYPES,
  MIN_QUESTIONS,
  MAX_QUESTIONS,
} = require('../schemas/generateAssessment');

/** @type {import('../../assistant/contracts').ActionDescriptor} */
const generateAssessment = {
  id: 'generate_assessment',
  version: 1,
  status: 'active',
  domain: 'generator',

  // 'draft' — it prepares something a human then reviews and commits. The
  // teacher still presses Generate; nothing is produced or saved on the
  // application's own initiative. This value CAPS what the decision policy may
  // return for this action, at any confidence.
  effect: 'draft',

  // Empty means "any authenticated user", which is the truth here: the
  // underlying POST /api/resources/generate is guarded by authRequired alone,
  // with no role check. A descriptor must MIRROR the route's real guard and
  // never invent one — claiming a restriction the endpoint does not enforce
  // would be security theatre, and claiming a looser one would be a bypass.
  requiredRoles: [],

  featureFlag: 'ASSISTANT_ACTION_GENERATE_ASSESSMENT',

  // Phase 1 never auto-executes. Enforced by the registry at startup, not by
  // convention. Flipping this to true is the single-field graduation described
  // in the architecture document, gated on a measured field-edit rate.
  autoExecute: false,

  summary: 'Create a printable quiz or worksheet with an answer key.',

  // These feed three things at once, which is why they are kept together: the
  // classifier prompt, the visible suggestion chips, and the evaluation corpus
  // seeds. Because the chips are generated from the same list the classifier
  // sees, what the app advertises and what it understands cannot drift apart.
  // Hinglish is represented deliberately — it is how a large share of the
  // target teachers actually type.
  examples: [
    'Generate a Class 5 fractions worksheet',
    'Create a Science paper for Class 8',
    'Class 3 ke liye maths quiz banao',
    'Make a 10 question true or false test on the water cycle',
    'I need an easy English worksheet for class 2',
  ],

  // Slot order is the order a human would naturally state them, which is also a
  // sensible order for the prompt. `defaultFrom` names only the PROFILE or
  // CONSTANT fallback; session memory is consulted generically by slot name, so
  // it does not need declaring here (precedence is resolver policy —
  // utterance > memory > profile > default — not per-slot configuration).
  slots: [
    {
      name: 'format',
      type: 'enum',
      values: ROUTABLE_FORMATS,
      required: true,
      // No default: these are genuinely different artefacts and guessing
      // produces a plausible-looking wrong document. Worth one tap.
      defaultFrom: null,
      // ROUTABLE_FORMATS, not FORMATS — the router advertises a deliberate
      // subset (see the schema module for why). registry.js checks at boot
      // that askOptions covers every advertised value.
      ask: 'Quiz or worksheet?',
      askOptions: ['Quiz', 'Worksheet'],
    },
    {
      name: 'topic',
      type: 'text',
      required: true,
      defaultFrom: null,
      ask: 'What topic should it cover?',
    },
    {
      name: 'grade',
      type: 'vocab',
      vocab: 'GRADES',
      required: false,
      defaultFrom: 'prefs.defaultGrade',
    },
    {
      name: 'subject',
      type: 'vocab',
      vocab: 'SUBJECTS',
      required: false,
      defaultFrom: 'prefs.defaultSubject',
    },
    // The next three are required by the endpoint but rarely spoken aloud.
    // Their defaults moved here from GeneratorPage's useState literals so the
    // manual form and the routed path read one source.
    {
      name: 'difficulty',
      type: 'enum',
      values: DIFFICULTIES,
      required: false,
      defaultFrom: 'const:medium',
    },
    {
      name: 'questionType',
      type: 'enum',
      // ROUTABLE_QUESTION_TYPES, not the full QUESTION_TYPES — the router
      // advertises a deliberate, frozen subset (see the schema module for
      // why), same reasoning as `format` using ROUTABLE_FORMATS above.
      values: ROUTABLE_QUESTION_TYPES,
      required: false,
      defaultFrom: 'const:mcq',
    },
    {
      name: 'questionCount',
      type: 'number',
      min: MIN_QUESTIONS,
      max: MAX_QUESTIONS,
      required: false,
      defaultFrom: 'const:10',
    },
    {
      name: 'language',
      type: 'vocab',
      vocab: 'LANGUAGES',
      required: false,
      // Set ONLY from an explicit request ("in Hindi"), never inferred from the
      // script the teacher typed in — a Hinglish request very often wants an
      // English worksheet, because the printed paper follows an English-medium
      // syllabus. Getting this wrong prints the wrong language.
      defaultFrom: 'prefs.defaultLanguage',
    },
    // NOTE: the endpoint also accepts an optional free-text `instructions`
    // field. It is deliberately NOT a slot: there is no reliable way to tell
    // which part of an utterance is "extra instructions" as opposed to the
    // topic itself, and guessing would quietly change what gets generated. A
    // teacher who wants it types it into the form.
  ],

  paramSchema: generateAssessmentSchema,
};

module.exports = { generateAssessment };
