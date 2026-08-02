// The untrusted-model boundary (Milestone M5).
//
// Everything the classifier returns passes through this file, and nothing the
// classifier returns is trusted until it has. Two halves that must stay in
// agreement, which is why they live together rather than in the classifier:
//
//   1. buildResponseSchema()  what Gemini is ASKED to produce
//   2. parseProposal()        what the application AGREES to accept
//
// Both are derived from the SAME role-filtered descriptor list, passed in by the
// caller. That is deliberate and it is the single most important property of
// this module: adding an action to the registry widens the accepted intent set
// automatically, and there is no second list anywhere that could be forgotten.
// A hand-maintained enum here would be a fourth home for knowledge the registry
// already owns, and the first one to drift silently.
//
// WHAT THE MODEL IS ALLOWED TO PRODUCE — the complete list:
//
//     intent        one id from the role-filtered catalog, or a non-action intent
//     confidence    'high' | 'medium' | 'low'  — ordinal, never a float (D9)
//     alternatives  at most 2, same constrained shape, used ONLY for the margin
//     slots         RAW strings, exactly as the teacher wrote them
//
// It is structurally incapable of producing anything else, because there is no
// field for anything else: no canonical value (that is actions/vocab/'s job, in
// code — G5), no provenance, no decision, no route, no URL, no `params`, no
// explanation and no reasoning. If a future prompt tempts someone to ask the
// model "why", the answer is that a rationale is an unverifiable string that
// would immediately start being trusted. The application already knows why it
// decided what it decided; it does not need the model's account of it.
//
// GUARDRAIL G4, which is the security boundary of the whole design: the
// responseSchema enum below is a STRONG HINT, NOT A GUARANTEE. Catalog
// membership is re-verified after parsing, on every single request. Deleting
// that check is the single most consequential mistake available in this file.

const { z } = require('zod');

const { CONFIDENCE_LEVELS, NON_ACTION_INTENTS } = require('./contracts');

/**
 * Longest raw slot value accepted from the model. Generous next to any real
 * phrase ("a Class 5 fractions worksheet") and far below the topic field's own
 * 200-character bound, so this never becomes the thing that rejects a legitimate
 * value — it exists to stop a malformed response handing the vocabulary mappers
 * an entire document to scan.
 */
const MAX_SLOT_VALUE_LENGTH = 200;

/**
 * What the model is ASKED to stay within, as opposed to what the application
 * will ACCEPT (MAX_SLOT_VALUE_LENGTH above). Added at M7b as candidate C4.
 *
 * The two are deliberately different numbers and the gap is the point: the
 * request bound gives the decoder somewhere to stop, while the accept bound
 * stays where it was so this change cannot reject anything the application
 * previously took. 120 characters is roughly four times the longest legitimate
 * topic in the M7a corpus, so it constrains nothing a teacher would write.
 */
const REQUESTED_SLOT_MAX_LENGTH = 120;

/** At most two alternatives are read; the policy only ever compares against the top one. */
const MAX_ALTERNATIVES = 2;

/**
 * The intent values a proposal may carry, for a given set of visible actions.
 *
 * Non-action intents are included because "I have no action for this" is a
 * CORRECT answer that the router wants often, and it is worth distinguishing
 * from "the model named something that does not exist" — the first is a healthy
 * passthrough, the second is a proposal worth logging.
 *
 * @param {object[]} descriptors the ROLE-FILTERED descriptor list
 * @returns {string[]}
 */
function allowedIntents(descriptors) {
  return [...descriptors.map((d) => d.id), ...NON_ACTION_INTENTS];
}

/**
 * Every slot name any visible action declares, de-duplicated.
 *
 * One flat slot object across all actions, rather than a per-action shape,
 * because Gemini's responseSchema has no discriminated-union construct. Slots
 * that do not belong to the chosen intent are dropped by sanitizeSlots() below,
 * so the flat shape costs nothing in correctness — only a few prompt tokens.
 */
function allowedSlotNames(descriptors) {
  const names = new Set();
  for (const descriptor of descriptors) {
    for (const slot of descriptor.slots) names.add(slot.name);
  }
  return [...names];
}

/**
 * Which slot names are FREE TEXT, according to the registry.
 *
 * Registry-driven rather than a hardcoded `'topic'`: a future action's free-text
 * slot picks up the same treatment with no edit here, which is the same
 * four-artifact property the intent enum already has. A slot named in two
 * descriptors with different types is treated as text if either says so — the
 * conservative direction, since the bound is a ceiling.
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
 * Build the Gemini `responseSchema` for a request, from the role-filtered
 * catalog. OpenAPI subset (uppercase type names), which is what
 * gemini.js#buildRequestBody forwards to the API.
 *
 * Note what is NOT here: no `params`, no `decision`, no `route`, no `reasoning`,
 * no free-text field of any kind beyond the raw slot values. The schema IS the
 * output contract, so keeping it minimal is how the contract is enforced at the
 * only place the model can act on it.
 *
 * @param {object[]} descriptors the ROLE-FILTERED descriptor list
 */
function buildResponseSchema(descriptors) {
  const intents = allowedIntents(descriptors);
  const freeText = freeTextSlotNames(descriptors);
  const slotProperties = {};
  for (const name of allowedSlotNames(descriptors)) {
    // Every slot is a STRING regardless of the underlying field's type.
    // questionCount is an integer in the generation schema, but the model
    // reports what the teacher SAID ("ten", "10 questions"), and turning that
    // into a bounded integer is the resolver's job, not the model's.
    slotProperties[name] = { type: 'STRING' };

    // FREE-TEXT SLOTS ARE BOUNDED (M7b, candidate C4). An unbounded string gives
    // the decoder nowhere to stop, and M7a measured the consequence: on ~5% of
    // turns the model got the intent and the slots right and then degenerated
    // inside `topic`, repeating fragments until it hit `maxOutputTokens` and
    // truncated the JSON so it would not parse. The teacher got a coaching
    // answer to a clear command (golden_failures GF-1).
    //
    // Only free-text slots are bounded, because only they were ever observed to
    // degenerate — every enum and vocab slot is short by construction. Bounding
    // all of them would have been broader than the evidence justified.
    //
    // The bound is a CEILING, not a target: no real value approaches it, the
    // application's own accept bound (MAX_SLOT_VALUE_LENGTH) is unchanged, and
    // the resolver still validates every value against the generation schema
    // afterwards — so this cannot admit or reject anything it did not before.
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
 * Build the zod validator for a proposal.
 *
 * VALIDATES SHAPE ONLY — deliberately, and this is the single most important
 * design decision in this file. Spec §4.4 gate 2 is TWO checks: "zod shape AND
 * id membership in the role-filtered catalog". They are kept separate here
 * because collapsing them destroys the second one:
 *
 *   An earlier draft built `intent` as z.enum(allowedIntents(descriptors)) and
 *   then ALSO looked the descriptor up. Since both came from the same list, zod
 *   always rejected a bad id first and the membership check became unreachable
 *   dead code. Injecting a defect into it changed nothing — 123 tests still
 *   passed — which is how the redundancy was found. A guard that cannot fail is
 *   not a guard; it is a comment that costs a function call.
 *
 * So `intent` is a bounded string here, and AUTHORIZATION happens exactly once,
 * in parseProposal, where it is live, testable, and provably load-bearing.
 * `confidence` keeps its enum because CONFIDENCE_LEVELS is a frozen wire
 * vocabulary rather than a per-request authorization decision — validating it
 * here is shape, not permission.
 *
 * `.strict()` at the top level has a cost worth stating: a model that helpfully
 * adds a `reasoning` key gets its ENTIRE proposal rejected, and the teacher gets
 * a coaching answer instead of a prefill. That is the right trade. Quietly
 * stripping unknown keys would let the output contract erode with nobody
 * noticing, and this project's whole defence against a model doing more than it
 * was asked is that doing more is a visible, logged failure.
 *
 * `slots` is deliberately NOT strict, and that asymmetry is principled too: an
 * unexpected top-level key means the model ignored the contract (reject), while
 * an unexpected slot is ordinary noisy extraction (drop the offender, keep the
 * rest — gate 3). Slot filtering happens in sanitizeSlots().
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
 * Reduce the model's slot bag to what this specific action can actually use.
 *
 * Drops, rather than rejects: a name the descriptor does not declare, a
 * non-string value, an empty string, or something absurdly long. Every one of
 * these is the model being noisy rather than the model being hostile, and the
 * correct response is to keep the good slots and let the missing ones fall
 * through to memory, the profile, or a default — which is the same
 * drop-don't-guess behaviour the resolver applies to values.
 *
 * Returns the surviving slots plus a COUNT of what was dropped, so the decision
 * log can carry a number without ever carrying a teacher's words (G11).
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
 * How clearly did the model prefer its top answer?
 *
 * 'close' when the best alternative claims the SAME ordinal confidence as the
 * chosen intent — the model is effectively saying "it is one of these two", and
 * the policy refuses to act on a medium-confidence coin flip. Anything else is
 * 'clear'. Deriving this from ordinals rather than asking the model for a margin
 * keeps the one model-supplied signal down to a single field (D9).
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
 * Validate and authorize one model response.
 *
 * The order matters and is the reason this returns a reason code rather than
 * throwing: shape first (is this even a proposal?), then AUTHORIZATION (is this
 * an action this caller may use, right now?), then slot hygiene. A proposal that
 * fails any of them produces a passthrough, never an error — this endpoint sits
 * in front of a text box.
 *
 * @param {unknown} raw the parsed JSON the model returned
 * @param {object[]} descriptors the ROLE-FILTERED descriptor list used to build the prompt
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

  // ---- Gate 2b — GUARDRAIL G4, THE AUTHORIZATION BOUNDARY -------------------
  // The ONLY place an action id is authorized, and the only thing standing
  // between a model naming an action and the application acting on it.
  //
  // Membership is checked against the ROLE-FILTERED catalog built for THIS
  // request — not the registry, and not a list computed anywhere else. An action
  // that exists but is flagged off, deprecated, or outside this caller's role is
  // refused here exactly as firmly as one that was invented outright, because
  // from this endpoint's perspective they are the same thing: an id the caller
  // may not use.
  //
  // The Gemini responseSchema constrains `intent` to this same set, and that
  // constraint is a STRONG HINT, NOT A GUARANTEE — which is precisely why the
  // zod schema above no longer duplicates it. Deleting these four lines is the
  // single most consequential mistake available in this file, and the tests are
  // written so that doing so fails them.
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
