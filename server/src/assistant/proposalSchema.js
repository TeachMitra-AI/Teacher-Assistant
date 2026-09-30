// The untrusted-model boundary: everything the classifier returns passes through here before it is trusted.
// buildResponseSchema() is what Gemini is asked to produce and parseProposal() is what we accept. Both derive from
// the same role-filtered descriptor list, so a new registry action widens both with no second list to forget.
// The model may only produce: intent (a catalog id or non-action intent), confidence (ordinal), up to 2
// alternatives (used only for the margin), and raw slot strings. There is no field for reasoning, params,
// decisions or routes, because an unverifiable rationale would start being trusted.
// The responseSchema enum is a hint, not a guarantee: catalog membership is re-checked on every request.
// Removing that check (Gate 2b) is the most damaging change available in this file.

const { z } = require('zod');

const { CONFIDENCE_LEVELS, NON_ACTION_INTENTS } = require('./contracts');

/**
 * Longest raw slot value accepted. Well above any real phrase and below the topic field's own
 * 200-char bound; it stops a malformed response from handing the mappers a whole document.
 */
const MAX_SLOT_VALUE_LENGTH = 200;

/**
 * Length the model is asked to stay within, distinct from the accept bound above. It gives the decoder
 * a place to stop without rejecting anything previously accepted; ~4x the longest legitimate topic.
 */
const REQUESTED_SLOT_MAX_LENGTH = 120;

/** At most two alternatives are read; the policy only ever compares against the top one. */
const MAX_ALTERNATIVES = 2;

/**
 * Intent values a proposal may carry. Non-action intents are included: "no action for this" is a correct,
 * common answer and is distinct from naming an action that doesn't exist.
 *
 * @param {object[]} descriptors the role-filtered descriptor list
 * @returns {string[]}
 */
function allowedIntents(descriptors) {
  return [...descriptors.map((d) => d.id), ...NON_ACTION_INTENTS];
}

/**
 * Every slot name any visible action declares, de-duplicated. The schema is one flat slot object because
 * Gemini's responseSchema has no discriminated union; sanitizeSlots() drops slots that don't belong to the intent.
 */
function allowedSlotNames(descriptors) {
  const names = new Set();
  for (const descriptor of descriptors) {
    for (const slot of descriptor.slots) names.add(slot.name);
  }
  return [...names];
}

/**
 * Which slot names are free text, per the registry. A slot typed text in any descriptor counts as
 * text, the conservative direction since the bound is a ceiling.
 */
function freeTextSlotNames(descriptors) {
  const names = new Set();
  for (const descriptor of descriptors) {
    for (const slot of descriptor.slots) {
      if (slot.type === 'text') names.add(slot.name);
    }
  }
  return names;
}

/**
 * Build the Gemini `responseSchema` (OpenAPI subset with uppercase types, as gemini.js#buildRequestBody
 * forwards it) from the role-filtered catalog. Kept minimal on purpose: this is the output contract.
 *
 * @param {object[]} descriptors the role-filtered descriptor list
 */
function buildResponseSchema(descriptors) {
  const intents = allowedIntents(descriptors);
  const freeText = freeTextSlotNames(descriptors);
  const slotProperties = {};
  for (const name of allowedSlotNames(descriptors)) {
    // Every slot is a string: the model reports what the teacher said ("ten"), and the resolver turns it into the typed value.
    slotProperties[name] = { type: 'STRING' };

    // Free-text slots are bounded. Unbounded, the decoder sometimes degenerated inside `topic` until the
    // JSON was truncated and unparseable. Only free-text slots needed it. The bound is a ceiling; the
    // accept bound and the resolver's validation are unchanged.
    if (freeText.has(name)) slotProperties[name].maxLength = REQUESTED_SLOT_MAX_LENGTH;
  }

  return {
    type: 'OBJECT',
    properties: {
      intent: { type: 'STRING', enum: intents },
      confidence: { type: 'STRING', enum: [...CONFIDENCE_LEVELS] },
      slots: { type: 'OBJECT', properties: slotProperties },
      alternatives: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            intent: { type: 'STRING', enum: intents },
            confidence: { type: 'STRING', enum: [...CONFIDENCE_LEVELS] },
          },
          required: ['intent', 'confidence'],
        },
      },
    },
    required: ['intent', 'confidence'],
  };
}

/** Longest intent string accepted. An action id is short; anything else is noise. */
const MAX_INTENT_LENGTH = 60;

/**
 * Build the zod validator for a proposal. It checks shape only; authorization happens once, in
 * parseProposal. Building `intent` as an enum from the same list would make the membership check
 * unreachable, so `intent` is a bounded string. `confidence` keeps its enum since it is a wire vocabulary.
 *
 * The top level is `.strict()`: an extra key such as `reasoning` rejects the whole proposal, so the
 * output contract can't erode quietly. `slots` is not strict; an unknown slot is noisy extraction,
 * so sanitizeSlots() drops it and keeps the rest.
 */
function buildProposalSchema() {
  const intentField = z.string().trim().min(1).max(MAX_INTENT_LENGTH);

  return z
    .object({
      intent: intentField,
      confidence: z.enum([...CONFIDENCE_LEVELS]),
      slots: z.record(z.string(), z.unknown()).optional(),
      alternatives: z
        .array(
          z
            .object({
              intent: intentField,
              confidence: z.enum([...CONFIDENCE_LEVELS]),
            })
            .strict()
        )
        .max(MAX_ALTERNATIVES)
        .optional(),
    })
    .strict();
}

/**
 * Reduce the model's slot bag to what this action can use. Drops (rather than rejects) undeclared
 * names, non-strings, empty and overlong values, so good slots survive. Returns a count of drops,
 * never the values, for the decision log.
 *
 * @param {object} descriptor the chosen action's descriptor
 * @param {unknown} rawSlots whatever the model returned
 * @returns {{slots: Record<string, string>, dropped: number}}
 */
function sanitizeSlots(descriptor, rawSlots) {
  const slots = {};
  let dropped = 0;

  if (!rawSlots || typeof rawSlots !== 'object' || Array.isArray(rawSlots)) {
    return { slots, dropped };
  }

  const declared = new Set(descriptor.slots.map((slot) => slot.name));

  for (const [name, value] of Object.entries(rawSlots)) {
    if (
      !declared.has(name) ||
      typeof value !== 'string' ||
      value.trim() === '' ||
      value.length > MAX_SLOT_VALUE_LENGTH
    ) {
      dropped += 1;
      continue;
    }
    slots[name] = value;
  }

  return { slots, dropped };
}

/**
 * How clearly the model preferred its top answer. 'close' when the best alternative has the same
 * ordinal confidence as the chosen intent; the policy won't act on that coin flip.
 *
 * @param {{intent: string, confidence: string}[]} [alternatives]
 * @param {string} confidence the chosen intent's confidence
 * @param {string} intent the chosen intent
 */
function computeMargin(alternatives, confidence, intent) {
  if (!Array.isArray(alternatives)) return 'clear';
  const rival = alternatives.find(
    (alt) => alt && alt.intent !== intent && alt.confidence === confidence
  );
  return rival ? 'close' : 'clear';
}

/**
 * Validate and authorize one model response, in order: shape, authorization, slot hygiene. Any failure
 * returns a reason code (never throws), which becomes a passthrough.
 *
 * @param {unknown} raw the parsed JSON the model returned
 * @param {object[]} descriptors the role-filtered descriptor list used to build the prompt
 * @returns {{ok: true, proposal: object}|{ok: false, reason: string}}
 */
function parseProposal(raw, descriptors) {
  // Gate 2a — SHAPE. Is this even a proposal?
  const parsed = buildProposalSchema().safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: 'invalid_proposal' };
  }

  const { intent, confidence, alternatives } = parsed.data;

  // The model correctly reported that it has no action for this. A normal,
  // frequent, healthy outcome — most messages in a coaching app are questions.
  if (NON_ACTION_INTENTS.includes(intent)) {
    return {
      ok: true,
      proposal: { intent, confidence, descriptor: null, slots: {}, dropped: 0, margin: 'clear' },
    };
  }

  // Gate 2b: the only place an action id is authorized. Membership is checked against the role-filtered
  // catalog for this request, so an action that is flagged off, deprecated or outside the caller's role is
  // refused like an invented one. The responseSchema constraint is only a hint. Don't remove this.
  const descriptor = descriptors.find((candidate) => candidate.id === intent);
  if (!descriptor) {
    return { ok: false, reason: 'invalid_proposal' };
  }

  const { slots, dropped } = sanitizeSlots(descriptor, parsed.data.slots);

  return {
    ok: true,
    proposal: {
      intent,
      confidence,
      descriptor,
      slots,
      dropped,
      margin: computeMargin(alternatives, confidence, intent),
    },
  };
}

module.exports = {
  MAX_SLOT_VALUE_LENGTH,
  MAX_ALTERNATIVES,
  allowedIntents,
  allowedSlotNames,
  buildResponseSchema,
  buildProposalSchema,
  sanitizeSlots,
  computeMargin,
  parseProposal,
};
