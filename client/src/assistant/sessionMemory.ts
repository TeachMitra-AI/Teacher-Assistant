// AI Action Router — session slot memory (Phase 1, Milestone M6).
//
// A TYPED SLOT STORE, NEVER A CHAT TRANSCRIPT. Each entry holds a canonical
// value, where it came from, and the turn that set it. That shape is what makes
// memory cheap (constant token cost), deterministic, inspectable and — the
// deciding reason — correctable. A transcript grows every turn, is opaque to the
// teacher, and cannot be corrected when it is wrong.
//
// The server stays stateless, exactly like /api/coach: this store is sent on
// every /interpret request and the server holds nothing between calls.
//
// ─── THIS MODULE DELIBERATELY APPLIES NO TTL (decision D1, approved at M6) ──
// The spec gives each slot a lifetime (grade/subject/language for the session,
// format 3 turns, topic 2 turns) and M4 recorded that those numbers should reach
// the client "through the catalog rather than being re-declared in TypeScript".
// The approved resolution goes further and removes the problem instead of moving
// it: resolver.js already re-applies expiry to whatever the client sends,
// explicitly so that the pipeline does not depend on the client having done it.
// There is therefore nothing on the client that needs to know the numbers.
//
// This store is a dumb carrier. It keeps what the server returned, sends it
// back, and lets the one authority decide what is still fresh. A fourth home for
// the TTL table — after resolver.js, the catalog wire shape and a TypeScript
// copy — is exactly the duplication the guardrails say to stop and consolidate.
//
// Fail-soft like the draft store: sessionStorage is unavailable in private
// browsing on the target devices, and losing memory must cost prefill quality,
// never a working composer.

import type { MemorySlot, ProvenanceSource, SessionMemory } from './types';

const STORAGE_KEY = 'ta.assistant.memory.v1';

/**
 * A ceiling on slot count, not a policy on which slots matter.
 *
 * Phase 1 has five named slots and the server only ever returns those, so this
 * never binds today. It exists so that a future server returning an unexpected
 * key cannot grow storage without limit on a low-end device.
 */
const MAX_SLOTS = 12;

/** Turn numbering starts at 1, matching the server envelope's `turn` minimum. */
const FIRST_TURN = 1;

interface StoredSession {
  slots: SessionMemory;
  turn: number;
}

const EMPTY_SESSION: StoredSession = { slots: {}, turn: FIRST_TURN };

/** Reads without ever throwing — Safari in private mode throws on ACCESS, not only on write. */
function readRaw(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Writes without ever throwing. A failed write costs prefill quality and nothing else. */
function writeRaw(value: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Quota exhausted or storage disabled. The next request simply carries no
    // memory, which degrades to a slightly less complete prefill.
  }
}

/**
 * Defensive shape check on one stored slot.
 *
 * Strict about the three fields the server actually reads back (`value`,
 * `source`, `turn`) and forgiving about `raw`, which is display-only. A slot
 * that fails this is dropped rather than repaired: memory is an optimization,
 * and an optimization that cannot prove its own shape should not be sent to a
 * `.strict()`-adjacent endpoint.
 */
function toSlot(value: unknown): MemorySlot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  if (typeof raw.value !== 'string' && typeof raw.value !== 'number') return null;
  if (typeof raw.source !== 'string' || raw.source === '') return null;
  if (typeof raw.turn !== 'number' || !Number.isInteger(raw.turn) || raw.turn < 0) return null;

  const slot: MemorySlot = {
    value: raw.value,
    source: raw.source as ProvenanceSource,
    turn: raw.turn,
  };
  if (typeof raw.raw === 'string' && raw.raw !== '') slot.raw = raw.raw;
  return slot;
}

/** The whole stored session, or an empty one. Corrupt JSON and bad shapes both read as empty. */
function load(): StoredSession {
  const raw = readRaw();
  if (raw === null) return { ...EMPTY_SESSION, slots: {} };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_SESSION, slots: {} };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ...EMPTY_SESSION, slots: {} };
  }

  const record = parsed as Record<string, unknown>;
  const slots: SessionMemory = {};
  if (typeof record.slots === 'object' && record.slots !== null && !Array.isArray(record.slots)) {
    for (const [name, value] of Object.entries(record.slots as Record<string, unknown>)) {
      const slot = toSlot(value);
      if (slot) slots[name] = slot;
    }
  }

  const turn =
    typeof record.turn === 'number' && Number.isInteger(record.turn) && record.turn >= FIRST_TURN
      ? record.turn
      : FIRST_TURN;

  return { slots, turn };
}

/** Persists, keeping the most recently set MAX_SLOTS entries. */
function save(session: StoredSession): void {
  const names = Object.keys(session.slots);
  let slots = session.slots;

  if (names.length > MAX_SLOTS) {
    // Oldest-first by the turn that set it: the entries a teacher is least
    // likely to still mean are the ones that have not been mentioned recently.
    const keep = names
      .sort((a, b) => session.slots[a].turn - session.slots[b].turn)
      .slice(-MAX_SLOTS);
    slots = {};
    for (const name of keep) slots[name] = session.slots[name];
  }

  try {
    writeRaw(JSON.stringify({ slots, turn: session.turn }));
  } catch {
    // JSON.stringify cannot realistically throw on this shape, but this module
    // sits on the composer's path and nothing here may surface as an exception.
  }
}

/** Everything currently remembered, ready to send as the request's `memory`. */
export function readMemory(): SessionMemory {
  return load().slots;
}

/**
 * Applies the server's `memoryUpdates`.
 *
 * Whole-slot replacement, never a field-level merge: the server sends a complete
 * slot or it sends nothing, and half-merging two sources of a value is how a
 * canonical value ends up paired with the wrong provenance.
 *
 * Only ever called for a `prefill` response. `interpret.js` already refuses to
 * emit updates on an `ask`, because a turn that ended in a question has not
 * settled anything — this store must not invent them either.
 */
export function mergeMemory(updates: SessionMemory | undefined): void {
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) return;

  const session = load();
  let changed = false;
  for (const [name, value] of Object.entries(updates)) {
    const slot = toSlot(value);
    if (!slot) continue;
    session.slots[name] = slot;
    changed = true;
  }
  if (changed) save(session);
}

/** The turn number to send with the next request. */
export function currentTurn(): number {
  return load().turn;
}

/**
 * Claims the next turn number.
 *
 * Called once per gate-passing submission, so `turn` counts ROUTING turns rather
 * than conversation turns. That is the number the server's memory expiry is
 * expressed in, and it is the only consumer.
 */
export function advanceTurn(): number {
  const session = load();
  session.turn += 1;
  save(session);
  return session.turn;
}

/**
 * "New chat" — forget everything.
 *
 * Clearing memory is part of the contract the teacher can see: starting a new
 * conversation must not leave a previous class or subject silently influencing
 * the next worksheet.
 */
export function clearMemory(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do. The store was already unreachable.
  }
}

/** Test seams: the bounds are policy, and the tests assert the policy rather than re-declaring it. */
export const MEMORY_STORAGE_KEY = STORAGE_KEY;
export const MEMORY_MAX_SLOTS = MAX_SLOTS;
export const MEMORY_FIRST_TURN = FIRST_TURN;
