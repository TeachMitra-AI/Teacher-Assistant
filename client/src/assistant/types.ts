// Wire contracts for the action router. Mirrors server/src/assistant/contracts.js; the duplication is intentional
// (CommonJS server vs ESM client), so change both in the same commit. Types only, so it adds nothing to the bundle.
// Kept out of client/src/types.ts so deleting client/src/assistant/ removes the feature with no dangling references.

/** Contract version. Distinct from catalogVersion, which tracks which actions exist. */
export const ASSISTANT_CONTRACT_VERSION = 1;

/** Matches MAX_QUERY_LENGTH on the server; the router shares the coach's composer. */
export const MAX_UTTERANCE_LENGTH = 500;

// Declared by the server registry. The client never decides an effect and must not act on one above 'draft'.
export type ActionEffect = 'read' | 'draft' | 'write' | 'destructive';

/**
 * What the server decided. Only 'prefill', 'ask' and 'passthrough' are expected today. 'execute' must be downgraded to
 * 'prefill' so a newer server can't make an older client generate without review; 'suggest' is ignored.
 */
export type ActionDecision = 'execute' | 'prefill' | 'ask' | 'suggest' | 'passthrough';

/** Diagnostic only, never rendered; every value gives the same UX (a normal coaching answer). */
export type PassthroughReason =
  | 'not_an_action'
  | 'low_confidence'
  | 'disabled'
  | 'classifier_timeout'
  | 'classifier_error'
  | 'safety_blocked'
  | 'invalid_proposal'
  | 'budget_exhausted'
  | 'emergency_detected';

// Where a prefilled value came from. Drives the provenance markers, the "clear AI fields" undo (which resets everything
// except 'user') and the correction telemetry.
export type ProvenanceSource =
  | 'utterance'
  | 'memory'
  | 'profile'
  | 'default'
  | 'inferred'
  | 'user';

// Ordinal rather than a float, since LLMs are poorly calibrated numerically.
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type ActionStatus = 'active' | 'beta' | 'deprecated';

export type SlotType = 'enum' | 'vocab' | 'text' | 'number';

export type VocabularyId = 'GRADES' | 'SUBJECTS' | 'LANGUAGES';

/** One chip in a clarifying question; resolved client-side. */
export interface AskOption {
  label: string;
  value: string;
}

export interface SlotSpec {
  name: string;
  type: SlotType;
  /** Present when type is 'enum'. */
  values?: string[];
  /** Present when type is 'vocab'. */
  vocab?: VocabularyId;
  required: boolean;
  /** Used only when this is the single missing required slot. */
  ask?: string;
  /** Rendered as chips rather than a free-text prompt. */
  askOptions?: string[];
  min?: number;
  max?: number;
}

/**
 * The public projection of a server action descriptor. Server-internal fields (paramSchema, requiredRoles, featureFlag,
 * autoExecute) and any route are never sent: the client owns its routing table keyed by `id`, so an unknown id from a
 * newer server degrades gracefully in an older cached client.
 */
export interface CatalogAction {
  id: string;
  version: number;
  status: ActionStatus;
  domain: string;
  effect: ActionEffect;
  summary: string;
  /** Also the source of the suggestion chips, so what the app advertises and understands can't drift. */
  examples: string[];
  slots: SlotSpec[];
}

export interface CatalogResponse {
  /** 0 with an empty list means the assistant is disabled server-side; a valid inert state, not an error. */
  catalogVersion: number;
  actions: CatalogAction[];
}

// One remembered slot. Session memory is a typed store, not a transcript, so the teacher can inspect and correct it.
export interface MemorySlot {
  /** Canonical, already mapped to the app's vocabulary by the server. */
  value: string | number;
  /** The phrase it came from, for display. */
  raw?: string;
  source: ProvenanceSource;
  /** The turn that set it, for per-slot TTL. */
  turn: number;
}

export type SessionMemory = Record<string, MemorySlot>;

export interface PendingAsk {
  actionId: string;
  slot: string;
}

export interface InterpretRequest {
  utterance: string;
  catalogVersion?: number;
  /** The client holds session memory; the server stays stateless, like /api/coach. */
  memory?: SessionMemory;
  /** Set only when answering a clarifying question by free text; a chip answer never reaches the server. */
  pendingAsk?: PendingAsk | null;
  turn?: number;
  /** Monotonic; a response is discarded unless it's the newest in-flight request. */
  sequence?: number;
}

export interface AskPrompt {
  slot: string;
  question: string;
  options?: AskOption[];
}

/**
 * The server's trusted output. `provenance` and other metadata sit beside `params`, never inside it: the generation
 * endpoint's schema is strict and would reject unknown keys.
 */
export interface ResolvedAction {
  actionId: string;
  version: number;
  effect: ActionEffect;
  decision: ActionDecision;
  confidence: ConfidenceLevel;
  /** Already validated server-side against the action's real schema. */
  params: Record<string, unknown>;
  provenance: Record<string, ProvenanceSource>;
  missing: string[];
  /** Prefilled but uncertain (e.g. an ambiguous grade); shown as a field marker. */
  lowConfidenceFields?: string[];
  ask?: AskPrompt;
}

/** `actions` is a list from the start; clients execute actions[0] and ignore the rest until compound requests exist. */
export interface InterpretResponse {
  catalogVersion: number;
  /** true => submit to /api/coach exactly as the app does today. */
  passthrough: boolean;
  actions: ResolvedAction[];
  reason?: PassthroughReason;
  memoryUpdates?: SessionMemory;
  requestId: string;
}

/** A pending prefill handed to the target page through sessionStorage, not the URL, to keep the topic out of history and logs. */
export interface PrefillDraft {
  id: string;
  actionId: string;
  version: number;
  /** Immutable after creation, so reloading the Generator re-applies the same values. */
  initialParams: Record<string, unknown>;
  provenance: Record<string, ProvenanceSource>;
  lowConfidenceFields: string[];
  /** Only used to render "Filled in from: …"; never sent back. */
  utterance: string;
  /** Opaque server-minted correlation id, the one field sent back; joins telemetry to the decision. Empty for hand-written drafts. */
  requestId: string;
  createdAt: number;
  expiresAt: number;
  /** Set by "clear AI fields" so a refresh loads defaults instead of re-applying. */
  consumed: boolean;
}

// ---- Telemetry wire contracts ----
// Mirrors ASSISTANT_EVENT_NAMES / PREFILL_OUTCOMES in the server's contracts.js (pinned by a drift guard). The server
// re-validates them as closed enums, so these types are a compile-time convenience, not the control.

// Only the client can report these: whether a draft reached the form and what the teacher did with it exist only in
// the browser.
export type AssistantEventName = 'prefill_delivered' | 'prefill_outcome';

// 'abandoned' is absent on purpose: the server derives it from a delivered event with no outcome, since an unload
// beacon is unreliable on low-end mobile browsers and would undercount it.
export type PrefillOutcome = 'generated' | 'undone' | 'edited';

// Metadata only, so nothing here can hold an utterance, slot value or generated content. `corrections` carries field
// names and their previous provenance, never contents.
export interface AssistantEvent {
  name: AssistantEventName;
  actionId: string;
  /** Opaque server-minted correlation id. */
  requestId?: string;
  fieldCount?: number;
  lowConfidenceCount?: number;
  outcome?: PrefillOutcome;
  corrections?: { field: string; from: ProvenanceSource }[];
}

/** The batch envelope; bounded server-side (MAX_EVENT_BATCH in contracts.js). */
export interface AssistantEventsRequest {
  events: AssistantEvent[];
}
