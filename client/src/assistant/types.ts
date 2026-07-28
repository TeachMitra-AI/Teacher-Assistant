// AI Action Router — frozen wire contracts (Phase 1, Milestone M0).
//
// SERVER COUNTERPART: server/src/assistant/contracts.js defines the same
// vocabularies and shapes for the backend. The two are a DELIBERATE, documented
// duplication (CommonJS server vs ESM client) rather than a shared package,
// which would need a monorepo restructure larger than this project — the same
// tradeoff already taken elsewhere in this codebase for small cross-runtime
// constants. If you change a value here, change it there in the same commit.
//
// Types only, no runtime values: everything below compiles away, so importing
// this file costs nothing in the bundle. That matters — the target devices are
// low-end Android on poor connections, and the router must not make the app
// slower for teachers who never use it.
//
// Deliberately NOT in client/src/types.ts. Keeping the router's types inside
// client/src/assistant/ is part of what makes the whole feature a deletable
// unit: removing the folder removes the feature, with no dangling references in
// shared files.

/** Contract version. Distinct from catalogVersion, which tracks WHICH actions exist. */
export const ASSISTANT_CONTRACT_VERSION = 1;

/** Matches MAX_QUERY_LENGTH on the server: the router shares the coach's composer. */
export const MAX_UTTERANCE_LENGTH = 500;

/**
 * What the application may do with an action. Declared by the server registry
 * and used here only for display and defensive checks — the client never
 * decides an effect, and must never act on one above 'draft' in Phase 1.
 */
export type ActionEffect = 'read' | 'draft' | 'write' | 'destructive';

/**
 * What the server decided.
 *
 * Phase 1 receives only 'prefill', 'ask' and 'passthrough'. The other two are
 * declared so the client can handle them defensively rather than crashing:
 *   - 'execute' must be DOWNGRADED to 'prefill' (a future server rollout must
 *     never be able to make an older client generate without teacher review).
 *   - 'suggest' is deferred to Phase 2 and should be ignored if it ever arrives.
 */
export type ActionDecision = 'execute' | 'prefill' | 'ask' | 'suggest' | 'passthrough';

/** Diagnostic only — never rendered. Every value produces the same UX: a normal coaching answer. */
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

/**
 * Where a prefilled value came from. Drives the provenance markers, the
 * "clear AI fields" undo (which resets everything except 'user'), and the
 * correction telemetry that gates launch.
 */
export type ProvenanceSource =
  | 'utterance'
  | 'memory'
  | 'profile'
  | 'default'
  | 'inferred'
  | 'user';

/** Ordinal, never a float — LLMs are poorly calibrated numerically. */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export type ActionStatus = 'active' | 'beta' | 'deprecated';

export type SlotType = 'enum' | 'vocab' | 'text' | 'number';

export type VocabularyId = 'GRADES' | 'SUBJECTS' | 'LANGUAGES';

/** One chip in a clarifying question. Selecting one is resolved entirely client-side. */
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
 * The public projection of a server action descriptor. Note what is absent:
 * paramSchema, requiredRoles, featureFlag and autoExecute are server-internal
 * and never sent — the client is told what it may use, never what it may not.
 *
 * Also absent: any route or path. The client owns its own routing table (see
 * assistant/handlers/), keyed by `id`. That one-way coupling is what makes a
 * server-side action rollout safe against an older, service-worker-cached
 * client: an unknown id degrades gracefully instead of breaking.
 */
export interface CatalogAction {
  id: string;
  version: number;
  status: ActionStatus;
  domain: string;
  effect: ActionEffect;
  summary: string;
  /** Doubles as the source of visible suggestion chips, so what the app advertises and what it understands cannot drift. */
  examples: string[];
  slots: SlotSpec[];
}

export interface CatalogResponse {
  /** 0 with an empty list means the assistant is disabled server-side — a valid inert state, not an error. */
  catalogVersion: number;
  actions: CatalogAction[];
}

/**
 * One remembered slot. Session memory is a typed store, never a chat
 * transcript: cheap, deterministic, and — the deciding reason — inspectable and
 * correctable by the teacher.
 */
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
  /** The client holds session memory; the server stays stateless, mirroring /api/coach. */
  memory?: SessionMemory;
  /** Set only when answering a clarifying question by FREE TEXT — a chip answer never reaches the server. */
  pendingAsk?: PendingAsk | null;
  turn?: number;
  /** Monotonic. A response is discarded unless it is the newest in-flight request. */
  sequence?: number;
}

export interface AskPrompt {
  slot: string;
  question: string;
  options?: AskOption[];
}

/**
 * The server's trusted output.
 *
 * `provenance` and every other piece of router metadata are SIBLINGS of
 * `params`, never inside it — the generation endpoint's schema is strict and
 * rejects unknown keys, so folding metadata into params would make every
 * generation request fail.
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
  /** Prefilled but uncertain (e.g. an ambiguous grade) — surfaced as a field marker. */
  lowConfidenceFields?: string[];
  ask?: AskPrompt;
}

/**
 * `actions` is a list from day one although Phase 1 never returns more than one.
 * Documented contract: Phase 1 clients execute actions[0] and ignore the rest.
 * One array literal now avoids a breaking envelope change when compound
 * requests arrive in Phase 4.
 */
export interface InterpretResponse {
  catalogVersion: number;
  /** true => submit to /api/coach exactly as the app does today. */
  passthrough: boolean;
  actions: ResolvedAction[];
  reason?: PassthroughReason;
  memoryUpdates?: SessionMemory;
  requestId: string;
}

/**
 * A pending prefill, handed from the executor to the target page through
 * sessionStorage rather than the URL. The teacher's topic text must never enter
 * the URL, because that would put it in browser history, referrer headers and
 * every access log between the client and the server.
 */
export interface PrefillDraft {
  id: string;
  actionId: string;
  version: number;
  /**
   * IMMUTABLE after creation. Refresh semantics depend on this: reloading the
   * Generator re-applies these values, which is strictly better than today's
   * behaviour (a refresh currently loses everything).
   */
  initialParams: Record<string, unknown>;
  provenance: Record<string, ProvenanceSource>;
  lowConfidenceFields: string[];
  /** Kept only to render "Filled in from: …" — never sent back to the server. */
  utterance: string;
  createdAt: number;
  expiresAt: number;
  /** Set by "clear AI fields", so a later refresh loads plain defaults instead of re-applying. */
  consumed: boolean;
}
