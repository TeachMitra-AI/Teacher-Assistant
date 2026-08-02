// The Capability Registry.
//
// One place that answers: what can this application be asked to do, with what
// parameters, by whom? Contains no AI, no HTTP and no Express — a command
// palette, a permission matrix or a docs generator could consume it without the
// assistant existing at all. That is deliberate: the registry is the durable
// asset, and the AI router is one front end onto it.
//
// Registration is an EXPLICIT import list, never filesystem auto-discovery. The
// set of live capabilities must be visible in one file, in a diff, in a code
// review — not a consequence of what happens to be on disk.

const {
  EFFECTS,
  PHASE1_MAX_EFFECT,
  ACTION_STATUSES,
  SLOT_TYPES,
  VOCABULARIES,
} = require('../assistant/contracts');
const { isFlagEnabled } = require('../lib/flags');

const { generateAssessment } = require('./descriptors/generateAssessment');
const { openGenerator } = require('./descriptors/openGenerator');

/**
 * Every action the application knows about. Order is the order they appear in a
 * catalog response, which is also the order suggestion chips would render in.
 */
const DESCRIPTORS = [generateAssessment, openGenerator];

/**
 * Bumped BY HAND whenever a descriptor changes in a way an already-deployed
 * client must notice. Clients cache the catalog and compare this value; a
 * mismatch tells them to refetch.
 *
 * This matters more than it looks: the client is a PWA with service-worker
 * caching, so stale clients are routine rather than theoretical.
 */
const CATALOG_VERSION = 1;

/**
 * The response served when the assistant is switched off, or when the caller is
 * outside the current rollout. Version 0 with an empty list is a valid INERT
 * state, not an error — the client simply never routes, and the application
 * behaves exactly as it did before the feature existed.
 */
const DISABLED_CATALOG = Object.freeze({ catalogVersion: 0, actions: [] });

// ---- Startup validation ----------------------------------------------------

/**
 * Assert a descriptor list is internally coherent, throwing on the first
 * problem. Runs at module load (see the bottom of this file), so a malformed
 * descriptor stops the server at boot rather than surfacing as a strange
 * routing failure at 3pm on a school day. Exported separately so tests can
 * drive it with deliberately broken input.
 *
 * Three families of check:
 *   1. Identity      — ids unique and well-formed
 *   2. Phase 1 safety— nothing may auto-execute or exceed the effect ceiling
 *   3. Schema accord — the descriptor's slots and its paramSchema agree
 *
 * (3) is the one that earns its keep. A descriptor drifting from the schema it
 * references is invisible until a teacher's request is rejected: a slot the
 * schema does not accept would be stripped by `.strict()`, and a
 * schema-required field with no slot means the router can never assemble a
 * valid payload at all. Both are caught here, at boot, for free.
 *
 * @param {object[]} descriptors
 * @throws {Error} on the first violation found
 */
function validateDescriptors(descriptors) {
  if (!Array.isArray(descriptors) || descriptors.length === 0) {
    throw new Error('[registry] descriptor list must be a non-empty array.');
  }

  const seen = new Set();
  const effectCeiling = EFFECTS.indexOf(PHASE1_MAX_EFFECT);

  for (const d of descriptors) {
    const where = `[registry] action "${d && d.id}"`;

    if (!d || typeof d.id !== 'string' || d.id.trim() === '') {
      throw new Error('[registry] every descriptor needs a non-empty string id.');
    }
    if (seen.has(d.id)) {
      // Ids are permanent and never reused; a duplicate means two capabilities
      // are fighting over one name and lookup would silently pick one.
      throw new Error(`${where} is declared more than once.`);
    }
    seen.add(d.id);

    if (!Number.isInteger(d.version) || d.version < 1) {
      throw new Error(`${where} needs an integer version >= 1.`);
    }
    if (!ACTION_STATUSES.includes(d.status)) {
      throw new Error(`${where} has an unknown status "${d.status}".`);
    }
    if (!EFFECTS.includes(d.effect)) {
      throw new Error(`${where} has an unknown effect "${d.effect}".`);
    }

    // --- Phase 1 safety ceiling ---
    if (EFFECTS.indexOf(d.effect) > effectCeiling) {
      throw new Error(
        `${where} declares effect "${d.effect}", above the Phase 1 ceiling "${PHASE1_MAX_EFFECT}". ` +
          'Write and destructive actions are out of scope; see docs/ai-action-router-guardrails.md (G9).'
      );
    }
    if (d.autoExecute !== false) {
      throw new Error(
        `${where} must set autoExecute:false — Phase 1 never acts without the teacher pressing the button.`
      );
    }

    if (!Array.isArray(d.requiredRoles)) {
      throw new Error(`${where} needs a requiredRoles array (empty means any authenticated user).`);
    }
    if (typeof d.featureFlag !== 'string' || d.featureFlag.trim() === '') {
      throw new Error(`${where} needs a featureFlag name so it can be rolled out independently.`);
    }
    if (typeof d.summary !== 'string' || d.summary.trim() === '') {
      throw new Error(`${where} needs a summary — it is what the classifier reads.`);
    }
    if (!Array.isArray(d.examples) || d.examples.length < 5) {
      throw new Error(`${where} needs at least 5 examples (they feed the prompt, the chips and the evals).`);
    }
    if (!Array.isArray(d.slots)) {
      throw new Error(`${where} needs a slots array.`);
    }
    if (!d.paramSchema || typeof d.paramSchema.safeParse !== 'function') {
      throw new Error(`${where} needs a zod paramSchema.`);
    }

    validateSlotsAgainstSchema(d, where);
  }
}

/**
 * Check a descriptor's slots against the schema it references, in both
 * directions.
 * @param {object} d
 * @param {string} where prefix for error messages
 */
function validateSlotsAgainstSchema(d, where) {
  const shape = d.paramSchema.shape || {};
  const schemaKeys = Object.keys(shape);
  const slotNames = [];

  for (const slot of d.slots) {
    if (!slot || typeof slot.name !== 'string' || slot.name.trim() === '') {
      throw new Error(`${where} has a slot with no name.`);
    }
    if (slotNames.includes(slot.name)) {
      throw new Error(`${where} declares slot "${slot.name}" more than once.`);
    }
    slotNames.push(slot.name);

    if (!SLOT_TYPES.includes(slot.type)) {
      throw new Error(`${where} slot "${slot.name}" has an unknown type "${slot.type}".`);
    }
    if (typeof slot.required !== 'boolean') {
      throw new Error(`${where} slot "${slot.name}" needs an explicit required boolean.`);
    }
    if (slot.type === 'enum' && (!Array.isArray(slot.values) || slot.values.length < 2)) {
      throw new Error(`${where} slot "${slot.name}" is an enum and needs at least two values.`);
    }
    if (slot.type === 'vocab' && !VOCABULARIES.includes(slot.vocab)) {
      throw new Error(`${where} slot "${slot.name}" references unknown vocabulary "${slot.vocab}".`);
    }
    if (slot.type === 'number' && !(typeof slot.min === 'number' && typeof slot.max === 'number')) {
      throw new Error(`${where} slot "${slot.name}" is a number and needs min and max.`);
    }
    // A required slot is one the policy may have to ask about, and it cannot
    // ask without a question.
    if (slot.required && (typeof slot.ask !== 'string' || slot.ask.trim() === '')) {
      throw new Error(`${where} slot "${slot.name}" is required, so it needs an "ask" question.`);
    }
    if (slot.askOptions && slot.type !== 'enum') {
      throw new Error(`${where} slot "${slot.name}" has askOptions but is not an enum.`);
    }
    if (slot.askOptions && slot.askOptions.length !== slot.values.length) {
      throw new Error(`${where} slot "${slot.name}" has askOptions that do not cover its values.`);
    }

    // Direction 1: a slot the schema does not accept would be stripped by
    // `.strict()`, so the router would confidently fill a field that silently
    // never arrives.
    if (!schemaKeys.includes(slot.name)) {
      throw new Error(
        `${where} declares slot "${slot.name}", which its paramSchema does not accept. ` +
          'The descriptor and the schema have drifted.'
      );
    }
  }

  // Direction 2: a schema-required key with no slot means the router can never
  // assemble a payload the endpoint would accept, for any utterance.
  for (const key of schemaKeys) {
    const field = shape[key];
    const isOptional = typeof field.isOptional === 'function' ? field.isOptional() : false;
    if (!isOptional && !slotNames.includes(key)) {
      throw new Error(
        `${where} paramSchema requires "${key}", but no slot declares it. ` +
          'The router could never build a valid request for this action.'
      );
    }
  }
}

// ---- Lookup and filtering --------------------------------------------------

/** @param {string} id @returns {object|undefined} */
function getDescriptor(id) {
  return DESCRIPTORS.find((d) => d.id === id);
}

/**
 * Is this action available to this caller right now? Three independent gates,
 * all of which must pass:
 *   - status      : deprecated actions stay defined but stop being offered
 *   - featureFlag : per-action rollout, defaulting OFF
 *   - requiredRoles: empty means any authenticated user
 *
 * @param {object} descriptor
 * @param {string} role
 * @param {Record<string, string|undefined>} env
 */
function isVisible(descriptor, role, env) {
  if (descriptor.status === 'deprecated') return false;
  if (!isFlagEnabled(env, descriptor.featureFlag)) return false;
  if (descriptor.requiredRoles.length > 0 && !descriptor.requiredRoles.includes(role)) return false;
  return true;
}

/**
 * The descriptors a given role may currently use. This is the list the
 * classifier prompt is built from as well as the list the client is told about,
 * so an action a teacher could not perform never reaches their prompt — cheaper,
 * and one less way for a model to propose something it must then be refused.
 */
function listForRole(role, env) {
  return DESCRIPTORS.filter((d) => isVisible(d, role, env));
}

// ---- Public projection -----------------------------------------------------

/**
 * Strip a descriptor down to what a client is allowed to see.
 *
 * Removed entirely: paramSchema (server-internal validation), requiredRoles and
 * featureFlag (the client is told what it MAY use, never what it may not), and
 * autoExecute (a server policy decision).
 *
 * Slots are projected field by field rather than spread, so a field added to a
 * descriptor later cannot leak by accident. `defaultFrom` is dropped for the
 * same reason it exists server-side only: resolution happens on the server, and
 * publishing the strategy would invite the client to re-implement it.
 */
function toCatalogAction(descriptor) {
  return {
    id: descriptor.id,
    version: descriptor.version,
    status: descriptor.status,
    domain: descriptor.domain,
    effect: descriptor.effect,
    summary: descriptor.summary,
    examples: [...descriptor.examples],
    slots: descriptor.slots.map((slot) => {
      const projected = {
        name: slot.name,
        type: slot.type,
        required: slot.required,
      };
      if (slot.values) projected.values = [...slot.values];
      if (slot.vocab) projected.vocab = slot.vocab;
      if (slot.ask) projected.ask = slot.ask;
      if (slot.askOptions) projected.askOptions = [...slot.askOptions];
      if (typeof slot.min === 'number') projected.min = slot.min;
      if (typeof slot.max === 'number') projected.max = slot.max;
      return projected;
    }),
  };
}

/**
 * Build the catalog response for a caller.
 * @param {string} role
 * @param {Record<string, string|undefined>} env
 */
function buildCatalog(role, env) {
  return {
    catalogVersion: CATALOG_VERSION,
    actions: listForRole(role, env).map(toCatalogAction),
  };
}

// Self-validating: requiring this module is enough to prove the registry is
// coherent. A malformed descriptor therefore fails the server's boot and every
// test run that touches the registry, rather than waiting to be discovered.
validateDescriptors(DESCRIPTORS);

module.exports = {
  DESCRIPTORS,
  CATALOG_VERSION,
  DISABLED_CATALOG,
  validateDescriptors,
  getDescriptor,
  isVisible,
  listForRole,
  toCatalogAction,
  buildCatalog,
};
