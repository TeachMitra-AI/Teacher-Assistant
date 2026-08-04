// The structured renderer — AI Learning Representation System, Phase C
// (docs/learning-representation-system-adr.md, §6, §13 Phase C).
//
// THE ONLY FILE IN THIS FEATURE THAT GENERATES REPRESENTATION CONTENT. One
// generic function, data-driven from schemas.js's RENDER_SPECS, the same way
// classifier.js is data-driven from contracts.js's EDUCATIONAL_INTENTS —
// adding a seventh representation type means adding a RENDER_SPECS entry,
// not editing this file.
//
// THE SINGLE MOST IMPORTANT RULE IN THIS FILE (ADR §11's hallucination
// mitigation, made concrete): the model is given the ANSWER ALREADY PRODUCED
// for the teacher's question and told to restructure it, not to answer the
// question a second time from its own knowledge. A diagram that silently
// re-derives facts independently of the text answer could disagree with it —
// two different, unreconciled claims on one screen — which is worse than not
// having a diagram at all. Grounding in the existing answer is what keeps a
// wrong structured field a restructuring bug rather than a second,
// independent hallucination.
//
// Same reliability discipline as classifier.js, deliberately kept identical:
//
// 1. EVERY FAILURE BECOMES A REASON, NEVER AN EXCEPTION.
// 2. THE SCHEMA IS A STRONG HINT, NOT A GUARANTEE — parsed output is
//    re-validated against the representation's own zod schema, including the
//    structural invariants zod alone can express (e.g. hierarchy_diagram's
//    single-root, all-parents-resolve check) that Gemini's responseSchema
//    cannot.
//
// No GeminiService instance is constructed or referenced here. The caller
// injects one (dependency injection, same as classify()) — which concrete
// instance that should be (geminiFast is deliberately token-starved for a
// 2-field classification and is very likely the WRONG instance for this
// heavier structured output) is a wiring decision left to whichever later
// phase adds a route.

const { RENDER_SPECS, hasRenderer } = require('./schemas');

const PREAMBLE = `You are converting an answer already given to an Indian government school teacher into structured data for a specific visual representation.

You are NOT answering the question again and you are NOT adding new information. Use ONLY facts, names, numbers and claims that already appear in the answer below. If the answer does not contain enough detail for a field, use the most reasonable direct reading of what IS there — never invent a fact, date, number or label the answer does not support.

Return ONLY the structured fields you are given. Do not explain your choice, do not add commentary.`;

function buildSystemInstruction(representation) {
  const spec = RENDER_SPECS[representation];
  return `${PREAMBLE}

TARGET REPRESENTATION: ${representation}
${spec.instructions}`;
}

/**
 * Wrap the question and the existing answer as delimited untrusted content,
 * clearly labelled so the model restructures the ANSWER, not the question.
 *
 * @param {string} prompt the teacher's original question
 * @param {string} answer the answer already produced for it
 * @returns {string}
 */
function buildUserText(prompt, answer) {
  return (
    "TEACHER'S QUESTION:\n```\n" +
    prompt +
    '\n```\n\nANSWER ALREADY GIVEN (your only source of facts):\n```\n' +
    answer +
    '\n```'
  );
}

/**
 * Map an upstream failure to a passthrough reason. Identical shape to
 * classifier.js#classifyFailure — kept as a separate copy rather than a
 * shared import because the two classifiers are independent call sites that
 * happen to fail the same way GeminiService always fails, not because they
 * share a concept that would need to change together (same reasoning as
 * contracts.js's CONFIDENCE_LEVELS duplication).
 *
 * @param {Error} error
 * @returns {string}
 */
function renderFailure(error) {
  if (error.code === 'INPUT_BLOCKED' || error.code === 'OUTPUT_BLOCKED') return 'safety_blocked';
  if (error.code === 'DEADLINE_EXCEEDED') return 'render_timeout';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'render_timeout';
  if (typeof error.message === 'string' && error.message.includes('timeout')) return 'render_timeout';
  return 'render_error';
}

/**
 * Render structured content for one representation, grounded in the answer
 * already given.
 *
 * @param {object} args
 * @param {object} args.gemini a GeminiService-shaped instance (injected — see module header)
 * @param {string} args.representation a RENDERABLE_REPRESENTATION_IDS member
 * @param {string} args.prompt the teacher's original question
 * @param {string} args.answer the answer already produced for it
 * @param {string} args.requestId correlation id, also present in the logs
 * @returns {Promise<
 *   {ok: true, representation: string, data: object, metrics: object}
 *   |{ok: false, reason: string, metrics: object}
 * >}
 */
async function render({ gemini, representation, prompt, answer, requestId }) {
  if (!hasRenderer(representation)) {
    return { ok: false, reason: 'invalid_representation', metrics: {} };
  }

  const spec = RENDER_SPECS[representation];

  let result;
  try {
    result = await gemini.generateContent(
      {
        systemInstruction: buildSystemInstruction(representation),
        userText: buildUserText(prompt, answer),
        responseSchema: spec.responseSchema,
      },
      { correlationId: requestId }
    );
  } catch (error) {
    return { ok: false, reason: renderFailure(error), metrics: error.metrics || {} };
  }

  let raw;
  try {
    raw = JSON.parse(result.text);
  } catch {
    // Same outputGuard interaction as classifier.js: a suppressed response
    // comes back as prose, which fails here rather than being special-cased.
    return { ok: false, reason: 'render_error', metrics: result.metrics || {} };
  }

  const parsed = spec.resultSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_content', metrics: result.metrics || {} };
  }

  return { ok: true, representation, data: parsed.data, metrics: result.metrics || {} };
}

module.exports = {
  buildSystemInstruction,
  buildUserText,
  renderFailure,
  render,
};
