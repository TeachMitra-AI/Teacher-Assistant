// Wire contracts for the AI Action Router: the request/response shapes exchanged with the client and the
// closed vocabularies they use. No logic lives here.
// The client mirrors every constant and shape in client/src/assistant/types.ts. Change both together.

/** Contract version; bump when a shape changes in a way a deployed client would misread. Separate from the registry's catalogVersion. */
const ASSISTANT_CONTRACT_VERSION = 1;

/** Longest accepted utterance. Matches MAX_QUERY_LENGTH in index.js so the router never rejects what /api/coach would accept. */
const MAX_UTTERANCE_LENGTH = 500;

/**
 * What an action may do once resolved. The registry declares it and it caps the decision policy
 * at any confidence, so model output can't escalate its own consequences.
 */
const EFFECTS = Object.freeze(['read', 'draft', 'write', 'destructive']);

/** The highest effect any action may declare today; enforced by the registry at startup. */
const PHASE1_MAX_EFFECT = 'draft';

/**
 * What the app decided to do with an utterance. Only 'prefill', 'ask' and 'passthrough' are sent today.
 * 'execute' is reserved for auto-execute actions; clients downgrade it to 'prefill'. 'suggest' is deferred.
 */
const DECISIONS = Object.freeze(['execute', 'prefill', 'ask', 'suggest', 'passthrough']);

/** The decisions the policy may currently return. */
const PHASE1_DECISIONS = Object.freeze(['prefill', 'ask', 'passthrough']);

/** Why a turn fell back to the coach. Diagnostic only: every reason gives the teacher the same coaching answer. */
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

/** Where a resolved value came from. Drives the prefill UI, "clear AI fields", and the correction metric. */
const PROVENANCE_SOURCES = Object.freeze([
  'utterance', // stated in this message — strongest
  'memory', // carried from an earlier turn in this session
  'profile', // the teacher's saved preferences
  'default', // the action descriptor's own default
  'inferred', // derived rather than stated (e.g. subject implied by topic)
  'user', // the teacher edited this field after prefill
]);

/** Model-reported confidence. Ordinal because LLMs are better calibrated on buckets than on numbers. */
const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);

/** Lifecycle of an action descriptor. Actions are deprecated, never deleted — cached catalogs exist in the wild. */
const ACTION_STATUSES = Object.freeze(['active', 'beta', 'deprecated']);

/**
 * How a slot is validated:
 *   enum   - closed set defined on the slot
 *   vocab  - controlled vocabulary with a fuzzy mapper (grade, subject, language)
 *   text   - bounded free text
 *   number - integer within min/max
 */
const SLOT_TYPES = Object.freeze(['enum', 'vocab', 'text', 'number']);

/** Vocabulary ids a slot may reference; mappers are in src/actions/vocab/. */
const VOCABULARIES = Object.freeze(['GRADES', 'SUBJECTS', 'LANGUAGES']);

/** Non-action intents the classifier may return, kept apart so "no matching action" isn't confused with an unknown id. */
const NON_ACTION_INTENTS = Object.freeze(['unknown', 'coach_question']);

// Telemetry vocabularies. These are wire contracts validated as closed enums before anything reaches the
// database; the closure is the privacy control.

/**
 * What the client may report about a delivered prefill. The set is closed so there is nowhere to put
 * teacher content, and the server rejects anything else.
 *   prefill_delivered - the draft was applied to the form; the denominator of the edit rate. Only the
 *                       client can report it, since the server can't know the teacher saw the draft.
 *   prefill_outcome   - what the teacher did next, with a count of corrected fields (two rows per session at most).
 */
const ASSISTANT_EVENT_NAMES = Object.freeze(['prefill_delivered', 'prefill_outcome']);

/**
 * How a delivered prefill ended. `abandoned` is derived at query time (a delivery with no outcome),
 * since an unload beacon is unreliable on low-end mobile browsers.
 *   generated - Generate was pressed with AI-filled fields
 *   undone    - "Clear AI fields" was pressed; the strongest sign the routing was wrong
 *   edited    - fields were corrected but no generation followed
 */
const PREFILL_OUTCOMES = Object.freeze(['generated', 'undone', 'edited']);

/** Largest batch POST /api/assistant/events accepts; bounds the database work one request can cause. */
const MAX_EVENT_BATCH = 20;

/** Longest `Event.metadata` JSON the writers persist. A backstop so a careless new field can't turn the table into a blob store. */
const MAX_EVENT_METADATA_LENGTH = 2000;

/**
 * `Event.type` values this feature writes. The shared prefix lets the prune script match only these
 * and never `ai_safety_flag`, `user_approved` or the reliability rows.
 */
const ASSISTANT_EVENT_TYPE_PREFIX = 'assistant_';
const ASSISTANT_EVENT_TYPES = Object.freeze([
  'assistant_prefill_delivered',
  'assistant_prefill_outcome',
]);

/**
 * How long assistant telemetry is kept. Pruned by tools/pruneAssistantEvents.js, outside the
 * request path, to keep deletes off the write path on single-writer SQLite.
 */
const ASSISTANT_EVENT_RETENTION_DAYS = 90;

// Shapes. These typedefs document the contract; runtime validation is done by the zod schemas
// (proposalSchema.js and each action's paramSchema), so there is a single source of truth.

/**
 * @typedef {object} SlotSpec
 * @property {string} name
 * @property {'enum'|'vocab'|'text'|'number'} type
 * @property {string[]} [values] present when type is 'enum'
 * @property {'GRADES'|'SUBJECTS'|'LANGUAGES'} [vocab] present when type is 'vocab'
 * @property {boolean} required
 * @property {string|null} [defaultFrom] e.g. 'prefs.defaultGrade', 'memory.grade', 'const:medium'
 * @property {string} [ask] question used only when this is the single missing required slot
 * @property {string[]} [askOptions] rendered as chips; a chip answer is resolved client-side
 * @property {boolean} [sensitive] never cached, never logged
 * @property {number} [min] type 'number'
 * @property {number} [max] type 'number'
 */

/**
 * The registry's record of an action. Server-internal: `paramSchema`, `requiredRoles`, `featureFlag`
 * and `autoExecute` are never projected into a catalog response. It carries no route or handler name;
 * coupling to the client is by id only, so a new action is safe for an already-deployed client.
 *
 * @typedef {object} ActionDescriptor
 * @property {string} id permanent; never renamed, never reused
 * @property {number} version bumped on breaking slot changes
 * @property {'active'|'beta'|'deprecated'} status
 * @property {string} domain grouping for UI and telemetry
 * @property {'read'|'draft'|'write'|'destructive'} effect caps the decision policy
 * @property {string[]} requiredRoles NOT projected
 * @property {string} featureFlag NOT projected
 * @property {boolean} autoExecute must be false for every action today; NOT projected
 * @property {string} summary one line, feeds the classifier prompt
 * @property {string[]} examples at least 5, including Hinglish; feeds prompt, chips and evals
 * @property {SlotSpec[]} slots
 * @property {object} paramSchema zod schema reference (never a copy); NOT projected
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
 * One remembered slot. Session memory is a typed store rather than a transcript: constant token
 * cost, deterministic, and inspectable and correctable by the teacher.
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
 * @property {{actionId: string, slot: string}|null} [pendingAsk] set only when answering a clarifying question by free text
 * @property {number} [turn]
 * @property {number} [sequence] monotonic; supports the client's stale-response guard
 */

/**
 * What the model returned. Untrusted: every field is re-validated, and `intent` is re-checked against the
 * role-filtered catalog. Slots are raw strings ("class 5"); canonicalization happens in code.
 *
 * @typedef {object} IntentProposal
 * @property {string} intent an action id, or one of NON_ACTION_INTENTS
 * @property {'high'|'medium'|'low'} confidence
 * @property {{intent: string, confidence: string}[]} [alternatives] max 2
 * @property {Record<string, string>} slots raw, uncanonicalized
 */

/**
 * The application's trusted output. `params` holds only values that passed the action's real paramSchema.
 * Provenance, confidence and other router metadata are siblings of `params`, never inside it: the
 * generation schema is `.strict()`, so merging them in would make every generation request fail with a 400.
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
 * `actions` is a list so compound requests can be added without changing the envelope; clients
 * currently execute actions[0] and ignore the rest.
 *
 * @typedef {object} InterpretResponse
 * @property {number} catalogVersion
 * @property {boolean} passthrough true => the client submits to /api/coach exactly as it does today
 * @property {ResolvedAction[]} actions empty when passthrough is true
 * @property {string} [reason] a PASSTHROUGH_REASONS value; diagnostic only, never displayed
 * @property {Record<string, MemorySlot>} [memoryUpdates] slots the client should remember
 * @property {string} requestId correlation id, also present in server logs
 */

/**
 * One telemetry event as the client sends it. Every field is metadata; no field can hold an
 * utterance, slot value, generated content or model output. `requestId` is the UUID from the
 * interpret response, echoed back to join an Event row to its decision log line.
 *
 * @typedef {object} AssistantTelemetryEvent
 * @property {string} name an ASSISTANT_EVENT_NAMES value
 * @property {string} actionId the action the prefill belonged to
 * @property {string} [requestId] correlation id from the interpret response
 * @property {number} [fieldCount] how many fields the prefill filled
 * @property {number} [lowConfidenceCount] how many were marked uncertain
 * @property {string} [outcome] a PREFILL_OUTCOMES value; prefill_outcome only
 * @property {{field: string, from: string}[]} [corrections] field names and their previous
 *   PROVENANCE_SOURCES value, never the values themselves
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
  ASSISTANT_EVENT_NAMES,
  PREFILL_OUTCOMES,
  MAX_EVENT_BATCH,
  MAX_EVENT_METADATA_LENGTH,
  ASSISTANT_EVENT_TYPE_PREFIX,
  ASSISTANT_EVENT_TYPES,
  ASSISTANT_EVENT_RETENTION_DAYS,
};
