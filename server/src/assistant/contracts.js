// AI Action Router — frozen wire contracts (Phase 1, Milestone M0).
//
// This module is the single server-side definition of the shapes exchanged
// between the client and the two assistant endpoints, plus the closed
// vocabularies those shapes are built from. It contains NO logic: no HTTP, no
// Gemini, no registry, no policy. It exists so that both tracks of the project
// (server pipeline, client executor) can be built in parallel against a shape
// that was agreed once and cannot drift silently.
//
// Why a "freeze": the milestone plan builds the client prefill path (M3) before
// the classifier exists (M5). That only works if the object the classifier will
// eventually produce is pinned down first — otherwise M3 is built against a
// guess. Changing anything here after M0 costs a coordination round trip
// between both tracks, so it is deliberately a conscious act.
//
// CLIENT COUNTERPART: client/src/assistant/types.ts mirrors every constant and
// shape below as TypeScript types. The two are a DELIBERATE, documented
// duplication (CommonJS server vs ESM client — see the guardrails document,
// CHANGE-11) rather than a shared package, which would require a monorepo
// restructure larger than this project. If you change a value here, change it
// there in the same commit.

/**
 * Contract version. Bumped only when a shape below changes in a way an already
 * deployed client would misread. Distinct from the registry's catalogVersion
 * (which tracks WHICH actions exist, not what the envelope looks like).
 */
const ASSISTANT_CONTRACT_VERSION = 1;

/**
 * Longest utterance the interpret endpoint accepts. Matches MAX_QUERY_LENGTH in
 * index.js on purpose: the router sits in front of the same composer that feeds
 * /api/coach, so a message the coach would accept must never be rejected by the
 * router for being too long.
 */
const MAX_UTTERANCE_LENGTH = 500;

/**
 * What the application may do with a resolved action. This is the safety spine
 * of the whole design: an action's effect is declared by the registry and CAPS
 * what the decision policy is allowed to return, at any confidence, so no model
 * output can ever escalate its own consequences.
 *
 * Phase 1 ships only 'read' and 'draft' actions. 'write' and 'destructive' are
 * defined here so the policy can be written and tested against the complete
 * ladder now, rather than being retrofitted when those actions arrive.
 */
const EFFECTS = Object.freeze(['read', 'draft', 'write', 'destructive']);

/** The highest effect any Phase 1 action may declare. Enforced by the registry at startup (M2). */
const PHASE1_MAX_EFFECT = 'draft';

/**
 * What the application decided to do about an utterance.
 *
 * Phase 1 emits only 'prefill', 'ask' and 'passthrough' (see PHASE1_DECISIONS).
 * The other two are defined but never sent:
 *   - 'execute'  — reserved for a future action with autoExecute enabled. The
 *                  client must defensively downgrade it to 'prefill' so a
 *                  server-side rollout can never surprise an older client into
 *                  generating without review.
 *   - 'suggest'  — deferred to Phase 2 (CHANGE-4). With only two actions it can
 *                  offer nothing useful, but keeping the value defined means
 *                  introducing it later is additive rather than breaking.
 */
const DECISIONS = Object.freeze(['execute', 'prefill', 'ask', 'suggest', 'passthrough']);

/** The subset of DECISIONS the Phase 1 policy is permitted to return. */
const PHASE1_DECISIONS = Object.freeze(['prefill', 'ask', 'passthrough']);

/**
 * Why a turn fell back to the coach. DIAGNOSTIC ONLY — these strings are logged
 * and returned for debugging, but every one of them produces the same teacher
 * experience (a normal coaching answer), so none is ever displayed.
 */
const PASSTHROUGH_REASONS = Object.freeze([
  'not_an_action', // the utterance is a coaching question, not a command
  'low_confidence', // understood something, but not well enough to act on
  'disabled', // kill switch, per-action flag, role or school gate
  'classifier_timeout', // the routing budget elapsed — a decision, not an error
  'classifier_error', // upstream failure, malformed response, network
  'safety_blocked', // Gemini's own input/output filters
  'invalid_proposal', // model returned an unknown action id or an unusable shape
  'budget_exhausted', // per-user daily interpret budget spent
  'emergency_detected', // active-emergency utterance: routed straight to the coach
]);

/**
 * Where a resolved parameter's value came from. Recorded per field and carried
 * to the client. Not decoration — provenance drives the prefill UI, the undo
 * behaviour ("clear AI fields" resets only non-user values), and the correction
 * metric that gates launch (which SOURCE produces the most teacher edits).
 */
const PROVENANCE_SOURCES = Object.freeze([
  'utterance', // stated in this message — strongest
  'memory', // carried from an earlier turn in this session
  'profile', // the teacher's saved preferences
  'default', // the action descriptor's own default
  'inferred', // derived rather than stated (e.g. subject implied by topic)
  'user', // the teacher edited this field after prefill
]);

/**
 * Model-reported confidence. Deliberately ORDINAL rather than a float: LLMs are
 * poorly calibrated at self-reported numeric confidence but adequately ordered
 * at categorical confidence, and three buckets is all the resolution the
 * decision policy needs.
 */
const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);

/** Lifecycle of an action descriptor. Actions are deprecated, never deleted — cached catalogs exist in the wild. */
const ACTION_STATUSES = Object.freeze(['active', 'beta', 'deprecated']);

/**
 * How a slot's value is validated and canonicalized.
 *   enum   — a closed set defined inline on the slot
 *   vocab  — a controlled vocabulary with a fuzzy mapper (grade, subject, language)
 *   text   — free text, length-bounded
 *   number — integer within min/max
 */
const SLOT_TYPES = Object.freeze(['enum', 'vocab', 'text', 'number']);

/** Controlled-vocabulary identifiers a slot may reference. Mappers land in src/actions/vocab/ (M4). */
const VOCABULARIES = Object.freeze(['GRADES', 'SUBJECTS', 'LANGUAGES']);

/**
 * Intent values the classifier may return that are NOT action ids. Kept
 * separate from the catalog so the proposal validator can distinguish "the
 * model correctly reported it has no action for this" from "the model returned
 * an id that does not exist", which are different outcomes worth different
 * telemetry.
 */
const NON_ACTION_INTENTS = Object.freeze(['unknown', 'coach_question']);

// ---- Shapes -----------------------------------------------------------------
// JSDoc typedefs rather than runtime validators: the runtime validation that
// matters happens against zod schemas (proposalSchema.js in M5, and each
// action's own paramSchema, which is REFERENCED from the real route — never
// copied). These typedefs document the contract and give editors autocomplete
// without creating a second source of truth for validation.

/**
 * @typedef {object} SlotSpec
 * @property {string} name
 * @property {'enum'|'vocab'|'text'|'number'} type
 * @property {string[]} [values] present when type is 'enum'
 * @property {'GRADES'|'SUBJECTS'|'LANGUAGES'} [vocab] present when type is 'vocab'
 * @property {boolean} required
 * @property {string|null} [defaultFrom] e.g. 'prefs.defaultGrade', 'memory.grade', 'const:medium'
 * @property {string} [ask] question used ONLY when this is the single missing required slot
 * @property {string[]} [askOptions] rendered as chips; a chip answer is resolved client-side (CHANGE-3)
 * @property {boolean} [sensitive] never cached, never logged
 * @property {number} [min] type 'number'
 * @property {number} [max] type 'number'
 */

/**
 * The registry's own record of an action. Server-internal: `paramSchema`,
 * `requiredRoles`, `featureFlag` and `autoExecute` are NEVER projected into a
 * catalog response — the client is told what it may use, never what it may not.
 *
 * Deliberately carries no route, path or handler name: the server never tells
 * the client where to navigate. Coupling is by id only, which is what makes
 * shipping a new action to an already-deployed (PWA-cached) client safe.
 *
 * @typedef {object} ActionDescriptor
 * @property {string} id permanent; never renamed, never reused
 * @property {number} version bumped on breaking slot changes
 * @property {'active'|'beta'|'deprecated'} status
 * @property {string} domain grouping for UI and telemetry
 * @property {'read'|'draft'|'write'|'destructive'} effect caps the decision policy
 * @property {string[]} requiredRoles NOT projected
 * @property {string} featureFlag NOT projected
 * @property {boolean} autoExecute must be false for every Phase 1 action; NOT projected
 * @property {string} summary one line, feeds the classifier prompt
 * @property {string[]} examples >=5 incl. Hinglish; feeds prompt, chips and evals
 * @property {SlotSpec[]} slots
 * @property {object} paramSchema zod schema REFERENCE (never a copy); NOT projected
 */

/**
 * The public projection of a descriptor.
 * @typedef {Omit<ActionDescriptor, 'requiredRoles'|'featureFlag'|'autoExecute'|'paramSchema'>} CatalogAction
 */

/**
 * @typedef {object} CatalogResponse
 * @property {number} catalogVersion 0 together with an empty list means the assistant is disabled
 * @property {CatalogAction[]} actions
 */

/**
 * One remembered slot. Session memory is a TYPED STORE, never a chat transcript:
 * constant token cost, deterministic, and — the deciding reason — inspectable
 * and correctable by the teacher, which a transcript is not.
 *
 * @typedef {object} MemorySlot
 * @property {string|number} value canonical, already mapped to the app's vocabulary
 * @property {string} [raw] the phrase it came from, for display
 * @property {'utterance'|'memory'|'profile'|'default'|'inferred'|'user'} source
 * @property {number} turn the turn that set it, for per-slot TTL
 */

/**
 * @typedef {object} InterpretRequest
 * @property {string} utterance <= MAX_UTTERANCE_LENGTH
 * @property {number} [catalogVersion] the version the client holds; a mismatch tells it to refetch
 * @property {Record<string, MemorySlot>} [memory] client-held session memory (the server stays stateless)
 * @property {{actionId: string, slot: string}|null} [pendingAsk] set only when answering a clarifying question by FREE TEXT
 * @property {number} [turn]
 * @property {number} [sequence] monotonic; supports the client's stale-response guard (CHANGE-9)
 */

/**
 * What the model returned. UNTRUSTED — every field is re-validated before use,
 * and `intent` is re-checked against the role-filtered catalog even though the
 * Gemini responseSchema constrains it, because a schema constraint is a strong
 * hint and not a guarantee.
 *
 * Slots are RAW STRINGS ("class 5", not "Class 3-5"). Canonicalization is the
 * application's job, in code, where it is testable and fixable without touching
 * a prompt.
 *
 * @typedef {object} IntentProposal
 * @property {string} intent an action id, or one of NON_ACTION_INTENTS
 * @property {'high'|'medium'|'low'} confidence
 * @property {{intent: string, confidence: string}[]} [alternatives] max 2
 * @property {Record<string, string>} slots raw, uncanonicalized
 */

/**
 * The application's trusted output. `params` contains ONLY values that passed
 * the action's real paramSchema.
 *
 * IMPORTANT: provenance, confidence and every other piece of router metadata
 * are SIBLINGS of `params`, never inside it. The generation schema is
 * `.strict()` and rejects unknown keys, so merging metadata into params to
 * "keep it together" makes every downstream generation request fail with a 400.
 *
 * @typedef {object} ResolvedAction
 * @property {string} actionId
 * @property {number} version
 * @property {'read'|'draft'|'write'|'destructive'} effect
 * @property {'execute'|'prefill'|'ask'|'suggest'|'passthrough'} decision
 * @property {'high'|'medium'|'low'} confidence
 * @property {Record<string, unknown>} params validated against the action's own schema
 * @property {Record<string, string>} provenance one PROVENANCE_SOURCES value per param
 * @property {string[]} missing required slots still unfilled
 * @property {string[]} [lowConfidenceFields] prefilled but flagged in the UI (e.g. an ambiguous grade)
 * @property {{slot: string, question: string, options?: {label: string, value: string}[]}} [ask]
 */

/**
 * `actions` is a LIST from day one even though Phase 1 never returns more than
 * one. Documented contract: Phase 1 clients execute actions[0] and ignore the
 * rest. This costs one array literal now and avoids a breaking envelope change
 * when compound requests arrive in Phase 4.
 *
 * @typedef {object} InterpretResponse
 * @property {number} catalogVersion
 * @property {boolean} passthrough true => the client submits to /api/coach exactly as it does today
 * @property {ResolvedAction[]} actions empty when passthrough is true
 * @property {string} [reason] a PASSTHROUGH_REASONS value; diagnostic only, never displayed
 * @property {Record<string, MemorySlot>} [memoryUpdates] slots the client should remember
 * @property {string} requestId correlation id, also present in server logs
 */

module.exports = {
  ASSISTANT_CONTRACT_VERSION,
  MAX_UTTERANCE_LENGTH,
  EFFECTS,
  PHASE1_MAX_EFFECT,
  DECISIONS,
  PHASE1_DECISIONS,
  PASSTHROUGH_REASONS,
  PROVENANCE_SOURCES,
  CONFIDENCE_LEVELS,
  ACTION_STATUSES,
  SLOT_TYPES,
  VOCABULARIES,
  NON_ACTION_INTENTS,
};
