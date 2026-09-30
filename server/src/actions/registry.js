// The capability registry: what the app can be asked to do, with which parameters, by whom. No AI, HTTP or Express.
// Registration is an explicit import list, not filesystem discovery, so the live set is visible in one file and in review.

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

/** Every known action, in catalog order. */
const DESCRIPTORS = [generateAssessment, openGenerator];

/**
 * Bumped by hand when a descriptor changes in a way a deployed client must notice; clients cache the
 * catalog and refetch on a mismatch. Stale clients are routine since the client is a PWA.
 */
const CATALOG_VERSION = 1;

/** Served when the assistant is off or the caller is outside the rollout. Version 0 with no actions is a valid inert state. */
const DISABLED_CATALOG = Object.freeze({ catalogVersion: 0, actions: [] });

/**
 * Assert a descriptor list is coherent, throwing on the first problem. Runs at module load so a malformed
 * descriptor stops boot. Exported so tests can pass broken input.
 *
 * Checks: ids are unique and well-formed; nothing auto-executes or exceeds the effect ceiling; the slots
 * and paramSchema agree. The last catches a slot the `.strict()` schema would strip, and a required
 * schema field with no slot, which would make a valid payload impossible to assemble.
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

    // Safety ceiling
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
 * Check a descriptor's slots against its referenced schema, in both directions.
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

    // A slot the schema doesn't accept would be stripped by `.strict()`, so the router would fill a field that never arrives.
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

/** @param {string} id @returns {object|undefined} */
function getDescriptor(id) {
  return DESCRIPTORS.find((d) => d.id === id);
}

/**
 * Is this action available to this caller now? All gates must pass:
 *   - status: deprecated actions stay defined but aren't offered
 *   - featureFlag: per-action rollout, default off
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
 * The descriptors a role may currently use. Both the classifier prompt and the client catalog are built
 * from this, so an action a teacher can't perform never reaches their prompt.
 */
function listForRole(role, env) {
  return DESCRIPTORS.filter((d) => isVisible(d, role, env));
}

/**
 * Strip a descriptor to what a client may see: no paramSchema, requiredRoles, featureFlag or autoExecute,
 * and no `defaultFrom` (resolution stays on the server). Slots are projected field by field so a new
 * descriptor field can't leak by accident.
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

// Self-validating: requiring this module proves the registry is coherent, so a bad descriptor fails boot and tests.
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
