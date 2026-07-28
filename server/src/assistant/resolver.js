// The resolver (Milestone M4).
//
// Takes the model's untrusted, raw-string proposal and turns it into a
// parameter object the application is willing to stand behind. Deterministic:
// no AI, no HTTP, no database, no clock. Everything it needs — the teacher's
// profile, their session memory, the turn number — arrives as an argument, so
// the whole module is exercisable from a unit test with no fixtures and no
// server. That is the point of building it before the classifier.
//
// Four responsibilities, in order:
//
//   1. CANONICALIZE  raw strings -> the application's own vocabularies, in code
//                    (decision D10). "class 5" becomes "Class 3-5" here, never
//                    in a prompt.
//   2. MERGE         utterance > memory > profile > registry default. First hit
//                    wins; sources are never blended.
//   3. PROVENANCE    record where every single value came from. This is
//                    infrastructure, not decoration: it drives the prefill UI,
//                    the undo behaviour, the decision policy, and the
//                    field-edit rate that gates launch.
//   4. VALIDATE      against the SAME zod schema the real endpoint uses. Never
//                    a copy (G1, G2).
//
// GUARDRAIL G3, which will bite whoever forgets it: provenance, confidence and
// every other piece of router metadata are returned as SIBLINGS of `params`.
// The generation schema is `.strict()`, so metadata folded into params makes
// every downstream generation request fail with a 400.

const { mapVocabulary } = require('../actions/vocab');
const { VOCAB_STATUS } = require('../actions/vocab/shared');

/**
 * How long a remembered slot stays usable, in turns, by how fast it goes stale.
 * `null` means session-lived: it expires when the tab does, not on a turn count.
 *
 * `topic` is the short one on purpose. A stale topic is worse than no topic,
 * because it produces a confident, plausible, WRONG worksheet — the teacher
 * asked for something else three turns ago and gets that instead (architecture
 * §6.3 rule 2).
 *
 * The client owns session memory in Phase 1 and the server is stateless, so
 * these are applied to whatever memory the client SENDS. A stale or older
 * client can present an expired slot; expiry is re-applied here so the pipeline
 * does not depend on the client having done it.
 *
 * NOTE FOR M6: the client will need the same numbers to expire its own store.
 * Publish them through the catalog rather than re-declaring them in TypeScript
 * — this project already carries three documented duplications, and the
 * guardrails say to stop and consolidate rather than add a fourth.
 */
const MEMORY_TTL_TURNS = Object.freeze({
  grade: null,
  subject: null,
  language: null,
  format: 3,
  topic: 2,
});

/**
 * TTL for a slot not named above. Deliberately the SHORTEST of the configured
 * values rather than session-lived: a new slot should have to earn a long
 * memory, not inherit one by being forgotten about here.
 */
const DEFAULT_MEMORY_TTL_TURNS = 2;

/**
 * Effects for which a remembered value may never satisfy a required slot
 * (architecture §6.3 rule 3). Module-private: the rule is asserted through
 * `resolveSlots` against a synthetic `write` action, which is the only way it
 * can be observed in Phase 1 anyway — no such action exists in the registry.
 */
const MEMORY_RESTRICTED_EFFECTS = Object.freeze(['write', 'destructive']);

/**
 * Is a remembered slot still usable on this turn?
 *
 * A value set on turn T is usable on turns T+1 … T+ttl. Anything with a missing
 * or nonsensical turn number is treated as expired: memory is an optimization,
 * and an optimization that cannot prove its own freshness should not be used.
 */
function isMemoryFresh(slotName, entry, turn) {
  const ttl = slotName in MEMORY_TTL_TURNS ? MEMORY_TTL_TURNS[slotName] : DEFAULT_MEMORY_TTL_TURNS;
  if (ttl === null) return true;
  if (!Number.isInteger(turn) || !Number.isInteger(entry.turn)) return false;
  return turn - entry.turn <= ttl;
}

/**
 * Would the action's own schema accept this value for this field?
 *
 * Per FIELD rather than per object, and that distinction is load-bearing: a
 * perfectly legitimate prefill is often INCOMPLETE (no topic yet — the form is
 * the question), which a whole-object parse cannot tell apart from invalid.
 * Validating field by field lets a bad value be dropped while everything else
 * survives, which is exactly the "drop offending slots, downgrade" behaviour
 * the spec's validation gate 3 calls for.
 *
 * Uses the same `.shape` access the registry's startup validation already
 * relies on, against the same schema object the endpoint validates with.
 *
 * Module-private: every drop-don't-guess case is asserted through
 * `resolveSlots`, which is where the behaviour actually matters.
 */
function fieldAccepts(paramSchema, key, value) {
  const field = paramSchema.shape ? paramSchema.shape[key] : undefined;
  if (!field) return false;
  return field.safeParse(value).success;
}

/**
 * Read a slot's raw utterance value into a canonical one.
 *
 * Returns the vocabulary result contract (see actions/vocab/shared.js) for
 * every slot type, so the caller has one shape to branch on regardless of
 * whether the value came from a mapper, an enum or a number.
 */
function canonicalizeSlot(slot, raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { status: VOCAB_STATUS.UNMAPPED, raw };
  }
  const trimmed = raw.trim();

  if (slot.type === 'vocab') {
    return mapVocabulary(slot.vocab, trimmed);
  }

  if (slot.type === 'enum') {
    // Case-insensitive because a model that has been told the values will still
    // occasionally return "Worksheet". Anything not in the closed set is
    // UNMAPPED rather than guessed at: "test paper" is not a format, and the
    // right outcome is one chip question, not a coin flip (spec §7.4).
    const match = (slot.values || []).find((value) => value.toLowerCase() === trimmed.toLowerCase());
    return match
      ? { status: VOCAB_STATUS.MAPPED, value: match, raw }
      : { status: VOCAB_STATUS.UNMAPPED, raw };
  }

  if (slot.type === 'number') {
    const digits = /-?\d+/.exec(trimmed);
    const parsed = digits ? Number(digits[0]) : NaN;
    // Out of range is DROPPED, never clamped. Clamping "50 questions" to 30
    // looks like the application understood and agreed; dropping it leaves the
    // registry default, which is honest and visible in the form.
    const withinBounds =
      Number.isInteger(parsed) &&
      (typeof slot.min !== 'number' || parsed >= slot.min) &&
      (typeof slot.max !== 'number' || parsed <= slot.max);
    return withinBounds
      ? { status: VOCAB_STATUS.MAPPED, value: parsed, raw }
      : { status: VOCAB_STATUS.UNMAPPED, raw };
  }

  // 'text' — free text. Length bounds belong to the schema, which validates
  // every candidate value a few lines further down, so there is nothing to
  // enforce here beyond "is there anything at all".
  return { status: VOCAB_STATUS.MAPPED, value: trimmed, raw };
}

/**
 * Resolve a descriptor's `defaultFrom` reference.
 *
 *   'prefs.defaultGrade' -> the teacher's saved preference
 *   'const:medium'       -> a literal, coerced to the slot's type
 *
 * The numeric coercion is not cosmetic: `const:10` reaching the schema as the
 * string "10" fails `z.number()`, and the field would silently go unfilled.
 */
function readDefault(slot, profile) {
  const from = slot.defaultFrom;
  if (typeof from !== 'string' || from === '') return undefined;

  if (from.startsWith('prefs.')) {
    const key = from.slice('prefs.'.length);
    const value = profile ? profile[key] : undefined;
    // Profile values are the application's own stored settings, chosen from the
    // same pickers the vocabularies feed, so they are used as-is rather than
    // pushed back through a mapper. They are still schema-validated below like
    // every other candidate.
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  }

  if (from.startsWith('const:')) {
    const literal = from.slice('const:'.length);
    if (slot.type === 'number') {
      const parsed = Number(literal);
      return Number.isInteger(parsed) ? parsed : undefined;
    }
    return literal;
  }

  return undefined;
}

/**
 * Turn a proposal's raw slots into validated params, provenance and the signals
 * the policy needs.
 *
 * @param {object} args
 * @param {object} args.descriptor the action descriptor (registry-owned, trusted)
 * @param {Record<string, string>} [args.slots] the model's RAW slot strings (untrusted)
 * @param {Record<string, {value: unknown, source?: string, turn?: number}>} [args.memory] client session memory
 * @param {Record<string, unknown>} [args.profile] the teacher's saved preferences
 * @param {number} [args.turn] the current turn number, for memory expiry
 * @returns {{
 *   params: Record<string, unknown>,
 *   provenance: Record<string, string>,
 *   missing: string[],
 *   lowConfidenceFields: string[],
 *   contradictions: {slot: string, readings: string[]}[],
 *   memoryUpdates: Record<string, {value: unknown, source: string, turn: number}>,
 *   complete: boolean
 * }}
 */
function resolveSlots({ descriptor, slots = {}, memory = {}, profile = {}, turn = 1 } = {}) {
  const params = {};
  const provenance = {};
  const missing = [];
  const lowConfidenceFields = [];
  const contradictions = [];
  const memoryUpdates = {};

  const rawSlots = slots && typeof slots === 'object' && !Array.isArray(slots) ? slots : {};
  const sessionMemory = memory && typeof memory === 'object' && !Array.isArray(memory) ? memory : {};
  const preferences = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : {};
  const memoryRestricted = MEMORY_RESTRICTED_EFFECTS.includes(descriptor.effect);

  // Only slot names are ever written into `params`, and the registry has
  // already proven at boot that every slot name is a key the schema accepts.
  // That is what makes a `.strict()` violation structurally impossible here
  // rather than merely unlikely.
  for (const slot of descriptor.slots) {
    const accept = (value, source) => {
      if (!fieldAccepts(descriptor.paramSchema, slot.name, value)) return false;
      params[slot.name] = value;
      provenance[slot.name] = source;
      return true;
    };

    // --- 1. The utterance. Strongest source; explicit always beats remembered.
    const fromUtterance = canonicalizeSlot(slot, rawSlots[slot.name]);

    if (fromUtterance.status === VOCAB_STATUS.CONTRADICTION) {
      // Two distinct readings were stated. Never resolved by guessing — a wrong
      // guess here produces a plausible-looking wrong worksheet that may not be
      // noticed until it is printed. The slot is left unfilled and the
      // contradiction reported; the policy turns it into one question showing
      // both readings. Deliberately no fall-through to memory: quietly using a
      // remembered value would hide the fact that the teacher said two things.
      contradictions.push({ slot: slot.name, readings: [...fromUtterance.readings] });
      if (slot.required) missing.push(slot.name);
      continue;
    }

    if (fromUtterance.status === VOCAB_STATUS.MAPPED && accept(fromUtterance.value, 'utterance')) {
      // Only confidently-mapped utterance values are remembered. An ambiguous
      // phrase must not be carried into later turns as though it were settled.
      memoryUpdates[slot.name] = { value: fromUtterance.value, source: 'utterance', turn };
      continue;
    }

    if (fromUtterance.status === VOCAB_STATUS.AMBIGUOUS) {
      // Understood, but it spans canonical values ("class 5-6", "primary").
      // Prefill the teacher's OWN words and flag the field, which is both more
      // honest than picking one and safe: the fields this can happen to are
      // free text in the schema, and a raw phrase that the schema will not
      // accept is dropped by the same validation as everything else.
      if (accept(fromUtterance.raw, 'utterance')) {
        lowConfidenceFields.push(slot.name);
        continue;
      }
    }

    // --- 2. Session memory, if it is still fresh and permitted here.
    const remembered = sessionMemory[slot.name];
    const memoryUsable =
      remembered &&
      typeof remembered === 'object' &&
      isMemoryFresh(slot.name, remembered, turn) &&
      !(memoryRestricted && slot.required);

    if (memoryUsable && accept(remembered.value, 'memory')) continue;

    // --- 3. The teacher's profile defaults.
    // --- 4. The registry's own constant.
    const fallback = readDefault(slot, preferences);
    if (fallback !== undefined) {
      const source = slot.defaultFrom.startsWith('prefs.') ? 'profile' : 'default';
      if (accept(fallback, source)) continue;
    }

    // --- Nothing filled it.
    if (slot.required) missing.push(slot.name);
  }

  // A completed parameter set is asserted against the whole schema, not just
  // field by field, because that is the object the endpoint would actually
  // receive. An incomplete one legitimately cannot pass — the form is the
  // question — so it is reported incomplete rather than invalid.
  const complete = missing.length === 0 && descriptor.paramSchema.safeParse(params).success;

  return { params, provenance, missing, lowConfidenceFields, contradictions, memoryUpdates, complete };
}

module.exports = {
  MEMORY_TTL_TURNS,
  DEFAULT_MEMORY_TTL_TURNS,
  isMemoryFresh,
  canonicalizeSlot,
  readDefault,
  resolveSlots,
};
