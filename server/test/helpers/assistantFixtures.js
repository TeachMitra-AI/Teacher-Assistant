// Canonical example payloads for the AI Action Router wire contracts (M0).
//
// These are the SAME examples published in docs/ai-action-router-phase1-spec.md
// §7. Keeping an executable copy here means the documented contract and the
// frozen vocabularies in src/assistant/contracts.js are checked against each
// other by the test suite (test/assistant/contracts.test.js) instead of drifting
// apart quietly — a documented example that no longer validates is exactly the
// kind of rot that makes a spec untrustworthy six months later.
//
// From M2/M5 onward these fixtures double as the expected shapes for the
// catalog and interpret route tests, so a change to the contract fails loudly in
// one place rather than in a dozen assertions.
//
// NOTE: the two catalog entries below describe the actions Phase 1 will ship.
// They are illustrative fixtures, NOT the registry — the real descriptors land
// in src/actions/descriptors/ during M2, and the registry is what the endpoint
// will actually serve.

/** GET /api/assistant/catalog — populated response (assistant enabled, teacher role). */
const catalogResponse = {
  catalogVersion: 1,
  actions: [
    {
      id: 'generate_assessment',
      version: 1,
      status: 'active',
      domain: 'generator',
      effect: 'draft',
      summary: 'Create a printable quiz or worksheet with an answer key.',
      examples: [
        'Generate a Class 5 fractions worksheet',
        'Create a Science paper for Class 8',
        'Class 3 ke liye maths quiz banao',
        'Make a 10 question true or false test on the water cycle',
        'I need an easy English worksheet for class 2',
      ],
      slots: [
        {
          name: 'format',
          type: 'enum',
          required: true,
          values: ['quiz', 'worksheet'],
          ask: 'Quiz or worksheet?',
          askOptions: ['Quiz', 'Worksheet'],
        },
        { name: 'topic', type: 'text', required: true, ask: 'What topic should it cover?' },
        { name: 'grade', type: 'vocab', vocab: 'GRADES', required: false },
        { name: 'subject', type: 'vocab', vocab: 'SUBJECTS', required: false },
        { name: 'difficulty', type: 'enum', required: false, values: ['easy', 'medium', 'hard'] },
        {
          name: 'questionType',
          type: 'enum',
          required: false,
          values: ['mcq', 'true_false', 'short_answer', 'mixed'],
        },
        { name: 'questionCount', type: 'number', required: false, min: 3, max: 30 },
        { name: 'language', type: 'vocab', vocab: 'LANGUAGES', required: false },
      ],
    },
    {
      id: 'open_generator',
      version: 1,
      status: 'active',
      domain: 'generator',
      effect: 'read',
      summary: 'Open the quiz and worksheet generator.',
      examples: [
        'Open the generator',
        'I want to make a worksheet',
        'Take me to the quiz maker',
        'Worksheet generator kholo',
        'Where do I create a test?',
      ],
      slots: [],
    },
  ],
};

/**
 * GET /api/assistant/catalog when the assistant is disabled. An empty catalog is
 * a valid INERT state, not an error — the client simply never routes.
 */
const catalogDisabledResponse = {
  catalogVersion: 0,
  actions: [],
};

/** POST /api/assistant/interpret — a request carrying session memory from earlier turns. */
const interpretRequest = {
  utterance: 'Generate a Class 5 fractions worksheet',
  catalogVersion: 1,
  memory: {
    grade: { value: 'Class 3-5', source: 'utterance', turn: 2 },
    subject: { value: 'Mathematics', source: 'utterance', turn: 2 },
  },
  pendingAsk: null,
  turn: 3,
  sequence: 7,
};

/**
 * The main path: enough was understood to open the Generator with values.
 *
 * Note that `provenance` is a SIBLING of `params`, never a key inside it. The
 * generation schema is `.strict()`, so router metadata folded into params would
 * make every downstream generation request fail with a 400.
 */
const interpretPrefillResponse = {
  catalogVersion: 1,
  passthrough: false,
  actions: [
    {
      actionId: 'generate_assessment',
      version: 1,
      effect: 'draft',
      decision: 'prefill',
      confidence: 'high',
      params: {
        format: 'worksheet',
        topic: 'Fractions',
        grade: 'Class 3-5',
        subject: 'Mathematics',
        difficulty: 'medium',
        questionType: 'mcq',
        questionCount: 10,
        language: 'en',
      },
      provenance: {
        format: 'utterance',
        topic: 'utterance',
        grade: 'utterance',
        subject: 'memory',
        difficulty: 'default',
        questionType: 'default',
        questionCount: 'default',
        language: 'profile',
      },
      lowConfidenceFields: [],
      missing: [],
    },
  ],
  memoryUpdates: {
    format: { value: 'worksheet', source: 'utterance', turn: 3 },
    topic: { value: 'Fractions', source: 'utterance', turn: 3 },
    grade: { value: 'Class 3-5', source: 'utterance', turn: 3 },
  },
  requestId: '6f1c0f4e-0000-4000-8000-000000000001',
};

/**
 * Exactly one required slot missing => one chip question, and NO navigation.
 *
 * Answering by chip is resolved entirely on the client: it already holds these
 * params and only needs to fill `format`. No second network call, no second LLM
 * call. Only a free-text answer comes back to the server with `pendingAsk` set.
 *
 * ─── ONE PROVENANCE DIFFERS FROM THE SPEC AS WRITTEN (Alternative A) ────────
 * `grade` is 'utterance' here; spec §7.2 shows 'memory'. The VALUE is unchanged
 * (Class 3-5) and so is every other field — only the attribution moved, and it
 * moved to the truthful one.
 *
 * The spec example's utterance is "a fractions worksheet FOR CLASS 5". The
 * teacher stated the grade in this very message; it read as 'memory' only
 * because the classifier failed to extract it, which is the extraction gap
 * deterministic recovery exists to close (M7a measured grade at 23.9%). The
 * example was therefore encoding a SYMPTOM as though it were a rule.
 *
 * Kept as the same input rather than being rewritten to a grade-free utterance,
 * so the diff against the approved document stays one line and reviewable. The
 * spec's memory-inheritance demonstration survives intact in
 * `interpretPrefillResponse` above, where `subject` genuinely is not stated in
 * the turn and still resolves from memory.
 */
const interpretAskResponse = {
  catalogVersion: 1,
  passthrough: false,
  actions: [
    {
      actionId: 'generate_assessment',
      version: 1,
      effect: 'draft',
      decision: 'ask',
      confidence: 'high',
      params: {
        topic: 'Fractions',
        grade: 'Class 3-5',
        difficulty: 'medium',
        questionType: 'mcq',
        questionCount: 10,
        language: 'en',
      },
      provenance: {
        topic: 'utterance',
        // Recovered from "…for class 5" in this turn's utterance. See the note
        // above: the spec shows 'memory', the value is identical, and this is
        // the one line where the two differ.
        grade: 'utterance',
        difficulty: 'default',
        questionType: 'default',
        questionCount: 'default',
        language: 'profile',
      },
      lowConfidenceFields: [],
      missing: ['format'],
      ask: {
        slot: 'format',
        question: 'Quiz or worksheet?',
        options: [
          { label: 'Quiz', value: 'quiz' },
          { label: 'Worksheet', value: 'worksheet' },
        ],
      },
    },
  ],
  requestId: '8a2d0f4e-0000-4000-8000-000000000002',
};

/**
 * Not an action (or anything at all went wrong). The client submits to
 * /api/coach exactly as it does today. `reason` is diagnostic only and is never
 * shown to the teacher — every reason produces the same experience.
 */
const interpretPassthroughResponse = {
  catalogVersion: 1,
  passthrough: true,
  actions: [],
  reason: 'not_an_action',
  requestId: 'c3f90f4e-0000-4000-8000-000000000003',
};

module.exports = {
  catalogResponse,
  catalogDisabledResponse,
  interpretRequest,
  interpretPrefillResponse,
  interpretAskResponse,
  interpretPassthroughResponse,
};
