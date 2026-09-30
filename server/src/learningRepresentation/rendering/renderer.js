// The structured renderer: the only place this feature generates representation content. One generic function
// driven by RENDER_SPECS in schemas.js, so a new representation type is a spec entry, not an edit here.
// Grounding: the model gets the answer already produced and restructures it rather than answering again, so a
// diagram can't contradict the text answer beside it.
// Same reliability rules as classifier.js: every failure becomes a reason, never an exception, and parsed output
// is re-validated against the representation's zod schema, including structural invariants (e.g. hierarchy_diagram
// single root, all parents resolve) that responseSchema can't express.
// The caller injects the Gemini instance; geminiFast is likely too token-starved for this heavier output.

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
 * Wrap the question and the existing answer as delimited untrusted content, labelled so the model
 * restructures the answer rather than the question.
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
 * Map an upstream failure to a reason. Same as classifier.js#classifyFailure but kept as a separate copy,
 * since the two call sites only happen to fail the same way.
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
 * Render structured content for one representation, grounded in the answer already given.
 *
 * @param {object} args
 * @param {object} args.gemini a GeminiService-shaped instance, injected
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
