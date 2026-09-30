// Session slot memory: a typed store (value, source, turn per slot) rather than a chat transcript, so it stays cheap,
// inspectable and correctable. Sent on every /interpret request; the server holds nothing between calls.
// No TTL is applied here: resolver.js already re-applies slot expiry to whatever the client sends, so this store just
// carries what the server returned and lets that one authority decide what is stale.
// Fails soft: if sessionStorage is unavailable (private browsing), memory is lost but the composer keeps working.

import type { MemorySlot, ProvenanceSource, SessionMemory } from './types';

const STORAGE_KEY = 'ta.assistant.memory.v1';

// A ceiling on slot count so an unexpected server key can't grow storage without limit.
const MAX_SLOTS = 12;

// Turn numbering starts at 1, matching the server envelope's `turn` minimum.
const FIRST_TURN = 1;

interface StoredSession {
  slots: SessionMemory;
  turn: number;
}

const EMPTY_SESSION: StoredSession = { slots: {}, turn: FIRST_TURN };

// Never throws; Safari in private mode throws on access, not only on write.
function readRaw(): string | null {
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

// Never throws; a failed write only costs prefill quality.
function writeRaw(value: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Quota exhausted or storage disabled; the next request just carries no memory.
  }
}

// Strict about the fields the server reads back (`value`, `source`, `turn`), lenient about display-only `raw`. A bad
// slot is dropped rather than repaired.
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

// Corrupt JSON and bad shapes both read as an empty session.
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

// Keeps the most recently set MAX_SLOTS entries.
function save(session: StoredSession): void {
  const names = Object.keys(session.slots);
  let slots = session.slots;

  if (names.length > MAX_SLOTS) {
    // Drop the least recently set first.
    const keep = names
      .sort((a, b) => session.slots[a].turn - session.slots[b].turn)
      .slice(-MAX_SLOTS);
    slots = {};
    for (const name of keep) slots[name] = session.slots[name];
  }

  try {
    writeRaw(JSON.stringify({ slots, turn: session.turn }));
  } catch {
    // Shouldn't throw on this shape, but nothing here may surface as an exception on the composer's path.
  }
}

export function readMemory(): SessionMemory {
  return load().slots;
}

// Whole-slot replacement, never a field merge, so a value isn't paired with the wrong provenance. Only called for a
// `prefill` response; the server emits no updates on an `ask` and neither should we.
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

export function currentTurn(): number {
  return load().turn;
}

// Claims the next turn number. Called once per gate-passing submission, so `turn` counts routing turns, which is what
// the server's memory expiry is expressed in.
export function advanceTurn(): number {
  const session = load();
  session.turn += 1;
  save(session);
  return session.turn;
}

// "New chat": starting a new conversation mustn't let a previous class or subject influence the next worksheet.
export function clearMemory(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Store was already unreachable.
  }
}

// Test seams: tests assert the bounds rather than redeclare them.
export const MEMORY_STORAGE_KEY = STORAGE_KEY;
export const MEMORY_MAX_SLOTS = MAX_SLOTS;
export const MEMORY_FIRST_TURN = FIRST_TURN;
