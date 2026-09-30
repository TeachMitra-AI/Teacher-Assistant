// Turns the model's untrusted raw-string proposal into params the application will stand behind.
// Deterministic: no AI, HTTP, database or clock; profile, memory and turn arrive as arguments.
// In order: canonicalize raw strings into our vocabularies (in code, never in a prompt); merge with
// precedence utterance > memory > profile > default (first hit wins, never blended); record provenance for
// every value; validate against the same zod schema the real endpoint uses, never a copy.
// Provenance, confidence and other router metadata are returned as siblings of `params`: the generation
// schema is `.strict()`, so metadata inside params would 400.

const { mapVocabulary } = require('../actions/vocab');
const { VOCAB_STATUS } = require('../actions/vocab/shared');

/**
 * How many turns a remembered slot stays usable; `null` lasts the session. `topic` is short because a stale
 * topic yields a confident, plausible, wrong worksheet. The client owns memory and the server is stateless,
 * so expiry is re-applied here to whatever the client sends.
 */
const MEMORY_TTL_TURNS = Object.freeze({
  grade: null,
  subject: null,
  language: null,
  format: 3,
  topic: 2,
});

/** TTL for unlisted slots: the shortest, so a new slot has to earn a longer memory. */
const DEFAULT_MEMORY_TTL_TURNS = 2;

/** Effects for which a remembered value may never satisfy a required slot. */
const MEMORY_RESTRICTED_EFFECTS = Object.freeze(['write', 'destructive']);

/**
 * Is a remembered slot still usable this turn? A value set on turn T works for turns T+1..T+ttl.
 * A missing or nonsensical turn counts as expired.
 */
function isMemoryFresh(slotName, entry, turn) {
  const ttl = slotName in MEMORY_TTL_TURNS ? MEMORY_TTL_TURNS[slotName] : DEFAULT_MEMORY_TTL_TURNS;
  if (ttl === null) return true;
  if (!Number.isInteger(turn) || !Number.isInteger(entry.turn)) return false;
  return turn - entry.turn <= ttl;
}

/**
 * Would the action's own schema accept this value for this field? Checked per field, since a legitimate
 * prefill is often incomplete (no topic yet) and a whole-object parse can't tell that from invalid;
 * this lets a bad value drop while the rest survive.
 */
function fieldAccepts(paramSchema, key, value) {
  const field = paramSchema.shape ? paramSchema.shape[key] : undefined;
  if (!field) return false;
  return field.safeParse(value).success;
}

/**
 * Canonicalize a slot's raw value. Returns the vocabulary result shape (actions/vocab/shared.js)
 * for every slot type, so callers branch on one shape.
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
    // Case-insensitive, since the model sometimes returns "Worksheet". Anything outside the closed set is
    // unmapped rather than guessed.
    const match = (slot.values || []).find((value) => value.toLowerCase() === trimmed.toLowerCase());
    return match
      ? { status: VOCAB_STATUS.MAPPED, value: match, raw }
      : { status: VOCAB_STATUS.UNMAPPED, raw };
  }

  if (slot.type === 'number') {
    const digits = /-?\d+/.exec(trimmed);
    const parsed = digits ? Number(digits[0]) : NaN;
    // Out of range is dropped, not clamped: clamping "50 questions" to 30 would look like agreement.
    const withinBounds =
      Number.isInteger(parsed) &&
      (typeof slot.min !== 'number' || parsed >= slot.min) &&
      (typeof slot.max !== 'number' || parsed <= slot.max);
    return withinBounds
      ? { status: VOCAB_STATUS.MAPPED, value: parsed, raw }
      : { status: VOCAB_STATUS.UNMAPPED, raw };
  }

  // Free text: the schema validates length below, so only non-emptiness is checked here.
  return { status: VOCAB_STATUS.MAPPED, value: trimmed, raw };
}

/**
 * Resolve a descriptor's `defaultFrom`: 'prefs.defaultGrade' reads the teacher's saved preference,
 * 'const:medium' is a literal coerced to the slot's type (a string "10" would fail `z.number()`).
 */
function readDefault(slot, profile) {
  const from = slot.defaultFrom;
  if (typeof from !== 'string' || from === '') return undefined;

  if (from.startsWith('prefs.')) {
    const key = from.slice('prefs.'.length);
    const value = profile ? profile[key] : undefined;
    // Profile values come from the same pickers as the vocabularies, so they're used as-is (still schema-validated below).
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
 * Turn a proposal's raw slots into validated params, provenance and the signals the policy needs.
 *
 * @param {object} args
 * @param {object} args.descriptor the action descriptor (registry-owned, trusted)
 * @param {Record<string, string>} [args.slots] the model's raw slot strings (untrusted)
 * @param {Record<string, string>} [args.recovered] canonical values that slotRecovery.js read from this turn's utterance
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
function resolveSlots({
  descriptor,
  slots = {},
  recovered = {},
  memory = {},
  profile = {},
  turn = 1,
} = {}) {
  const params = {};
  const provenance = {};
  const missing = [];
  const lowConfidenceFields = [];
  const contradictions = [];
  const memoryUpdates = {};

  const rawSlots = slots && typeof slots === 'object' && !Array.isArray(slots) ? slots : {};
  const recoveredSlots =
    recovered && typeof recovered === 'object' && !Array.isArray(recovered) ? recovered : {};
  const sessionMemory = memory && typeof memory === 'object' && !Array.isArray(memory) ? memory : {};
  const preferences = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : {};
  const memoryRestricted = MEMORY_RESTRICTED_EFFECTS.includes(descriptor.effect);

  // Only descriptor slot names are written into `params`, and the registry proves at boot that each is a schema key.
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
      // Two distinct readings were stated. Leave the slot unfilled and report the contradiction so the policy
      // asks one question showing both. Don't fall through to memory, which would hide that two things were said.
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
      // Spans several canonical values ("class 5-6", "primary"). Prefill the teacher's own words and flag the
      // field; the schema drops a phrase it won't accept.
      if (accept(fromUtterance.raw, 'utterance')) {
        lowConfidenceFields.push(slot.name);
        continue;
      }
    }

    // 1b. Recovery: slotRecovery.js read a value the model didn't report, using the same mappers. It keeps
    // provenance 'utterance', since only who noticed changed, and a new provenance would change a wire contract.
    // Ranked below the model, which saw the whole sentence (so Gemini is never overwritten), and above memory,
    // so a value said now beats a stale one. Remembered like any other utterance value.
    const recoveredValue = recoveredSlots[slot.name];
    if (recoveredValue !== undefined && accept(recoveredValue, 'utterance')) {
      memoryUpdates[slot.name] = { value: recoveredValue, source: 'utterance', turn };
      continue;
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

  // A complete set is checked against the whole schema, the object the endpoint would receive.
  // An incomplete set is reported as incomplete rather than invalid.
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
