// Capability descriptor: generate_assessment. Pure data plus a reference to the schema that validates
// POST /api/resources/generate, so the router can't accept a payload the endpoint would reject.

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

  // 'draft': it prepares something a human then reviews; the teacher still presses Generate. This caps the decision policy.
  effect: 'draft',

  // Empty means any authenticated user: the endpoint is guarded by authRequired alone. A descriptor mirrors the
  // route's real guard and never claims a stricter or looser one.
  requiredRoles: [],

  featureFlag: 'ASSISTANT_ACTION_GENERATE_ASSESSMENT',

  // Never auto-executes; the registry enforces this at startup.
  autoExecute: false,

  summary: 'Create a printable quiz or worksheet with an answer key.',

  // Feeds the classifier prompt, the suggestion chips and the eval corpus seeds, so what the app advertises and
  // understands can't drift. Hinglish is included because many teachers type that way.
  examples: [
    'Generate a Class 5 fractions worksheet',
    'Create a Science paper for Class 8',
    'Class 3 ke liye maths quiz banao',
    'Make a 10 question true or false test on the water cycle',
    'I need an easy English worksheet for class 2',
  ],

  // Slot order follows how a person states them. `defaultFrom` names only the profile or constant fallback;
  // session memory is consulted by slot name and needs no declaration (precedence is resolver policy).
  slots: [
    {
      name: 'format',
      type: 'enum',
      values: ROUTABLE_FORMATS,
      required: true,
      // No default: these are genuinely different artefacts and guessing
      // produces a plausible-looking wrong document. Worth one tap.
      defaultFrom: null,
      // ROUTABLE_FORMATS, a subset of FORMATS (see the schema module). registry.js checks at boot that askOptions covers every advertised value.
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
    // Required by the endpoint but rarely spoken. Defaults live here so the manual form and routed path share one source.
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
      // ROUTABLE_QUESTION_TYPES, a frozen subset (see the schema module), like `format` above.
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
      // Set only from an explicit request ("in Hindi"), never inferred from the script typed: a Hinglish request
      // often wants an English worksheet.
      defaultFrom: 'prefs.defaultLanguage',
    },
    // The endpoint also accepts free-text `instructions`, which isn't a slot: there's no reliable way to tell it
    // from the topic, and guessing would change what gets generated.
  ],

  paramSchema: generateAssessmentSchema,
};

module.exports = { generateAssessment };
