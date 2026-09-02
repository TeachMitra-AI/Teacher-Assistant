// Offline check-in/check-out queue — the web counterpart to mobile's
// offlineQueue.ts (that file's own header comment: "the ONE offline feature
// this app builds"). client/ has no prior offline-write pattern to reuse —
// its PWA setup only caches the app shell for offline *loading*, not
// failed API writes — so this mirrors mobile's proven shape (coalescing
// key, exponential backoff, a permanentError distinction for non-network
// failures, serialized sync) rather than inventing a new one, built on
// localStorage and browser-native sync triggers instead of AsyncStorage/
// NetInfo/AppState.
//
// Scope, deliberately narrow: only enqueues when checkIn()/checkOut() fails
// with a NETWORK error (ApiError.status === 0) — see CheckInTab.tsx. A real
// rejection (already checked in, outside geofence, validation error) is
// never queued; retrying it would just fail again the same way.
import { ApiError } from '../api';
import { checkIn, checkOut, type AttendanceEvidenceInput, type AttendanceActionResult } from './teacherAttendanceApi';

const STORAGE_KEY = 'attendance:offlineQueue';
const INITIAL_RETRY_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

export type QueuedActionKind = 'check-in' | 'check-out';

export interface QueuedAttendanceAction {
  // `${userId}:${date}:${kind}` — a second offline attempt for the same
  // user+date+kind replaces this entry in place (the newer evidence
  // supersedes the older), same reasoning as mobile's buildQueueKey.
  key: string;
  userId: string;
  date: string; // "YYYY-MM-DD", the device's local date when queued
  kind: QueuedActionKind;
  evidence: AttendanceEvidenceInput;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  nextRetryAt: number;
  // Set once a non-network (genuine server) failure is hit for this item.
  // Non-null means "stop auto-retrying — needs a manual Retry or Discard."
  permanentError: string | null;
}

export function buildQueueKey(userId: string, date: string, kind: QueuedActionKind): string {
  return `${userId}:${date}:${kind}`;
}

function readQueue(): QueuedAttendanceAction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt/unreadable storage is treated as an empty queue rather than a
    // crash — there is nothing recoverable to do with unparseable local data.
    return [];
  }
}

function writeQueue(items: QueuedAttendanceAction[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

type Listener = () => void;
const listeners = new Set<Listener>();

// Lets a mounted component react to queue changes without polling. Fired
// after every mutation below.
export function subscribeToQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  listeners.forEach((l) => l());
}

export function getQueue(userId?: string): QueuedAttendanceAction[] {
  const all = readQueue();
  return userId ? all.filter((item) => item.userId === userId) : all;
}

export function getQueuedAction(userId: string, date: string, kind: QueuedActionKind): QueuedAttendanceAction | null {
  return readQueue().find((item) => item.key === buildQueueKey(userId, date, kind)) ?? null;
}

/**
 * Enqueue (or coalesce into) a queued action. Called only when the online
 * attempt fails with a network error — see CheckInTab.tsx. Resets attempts/
 * backoff/error state on coalesce: a fresh attempt deserves a fresh retry
 * cycle, not one inherited from whatever the previous attempt left behind.
 */
export function enqueueAction(userId: string, date: string, kind: QueuedActionKind, evidence: AttendanceEvidenceInput): void {
  const all = readQueue();
  const key = buildQueueKey(userId, date, kind);
  const now = Date.now();
  const existing = all.find((item) => item.key === key);
  const next: QueuedAttendanceAction = {
    key,
    userId,
    date,
    kind,
    evidence,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    attempts: 0,
    nextRetryAt: 0,
    permanentError: null,
  };
  const rest = all.filter((item) => item.key !== key);
  writeQueue([...rest, next]);
  notify();
}

export function removeFromQueue(key: string): void {
  const all = readQueue();
  const next = all.filter((item) => item.key !== key);
  if (next.length !== all.length) {
    writeQueue(next);
    notify();
  }
}

function updateQueueItem(key: string, patch: Partial<QueuedAttendanceAction>): void {
  const all = readQueue();
  const next = all.map((item) => (item.key === key ? { ...item, ...patch } : item));
  writeQueue(next);
  notify();
}

function nextBackoff(attempts: number): number {
  const delay = INITIAL_RETRY_DELAY_MS * 2 ** attempts;
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

async function syncOne(item: QueuedAttendanceAction): Promise<{ result: 'synced'; attendance: AttendanceActionResult } | { result: 'network-retry' | 'permanent-error' }> {
  try {
    const attendance = item.kind === 'check-in' ? await checkIn(item.evidence) : await checkOut(item.evidence);
    return { result: 'synced', attendance };
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) return { result: 'network-retry' };
    return { result: 'permanent-error' };
  }
}

// Serializes sync attempts — a browser 'online' event and a visibility
// -change event firing close together must never race each other into two
// concurrent upload loops for the same queue.
let syncing = false;

/**
 * Processes this user's queued items in creation order, one at a time. A
 * network failure on any item stops the whole pass (further items are
 * almost certainly offline too); a permanent failure only stops retrying
 * *that* item and moves on, since it isn't a connectivity problem. Items
 * already carrying a permanentError are skipped — they wait for an
 * explicit retryQueuedAction().
 */
export async function attemptSync(userId: string): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const now = Date.now();
    const pending = readQueue()
      .filter((item) => item.userId === userId && !item.permanentError && item.nextRetryAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const item of pending) {
      const outcome = await syncOne(item);
      if (outcome.result === 'synced') {
        removeFromQueue(item.key);
        continue;
      }
      if (outcome.result === 'network-retry') {
        updateQueueItem(item.key, {
          attempts: item.attempts + 1,
          nextRetryAt: Date.now() + nextBackoff(item.attempts),
        });
        break; // still offline — stop the pass rather than retrying every item in a row
      }
      updateQueueItem(item.key, {
        permanentError: 'Could not sync this attendance action. It has not been lost — you can retry or discard it.',
      });
    }
  } finally {
    syncing = false;
  }
}

export async function retryQueuedAction(key: string, userId: string): Promise<void> {
  updateQueueItem(key, { permanentError: null, nextRetryAt: 0 });
  await attemptSync(userId);
}

// UI is responsible for confirming this with the user first — it discards
// unsynced evidence.
export function discardQueuedAction(key: string): void {
  removeFromQueue(key);
}

/**
 * Wires the two sync triggers this app has available on the web — a
 * `window.online` event and the page becoming visible again — to
 * attemptSync() for whichever user is currently signed in. `getUserId` is
 * read fresh on every event rather than captured once, so this only needs
 * to be started once for the app's lifetime. Deliberately no periodic
 * timer, same scope discipline as mobile's startAutoSync.
 */
export function startAutoSync(getUserId: () => string | null): () => void {
  function trigger() {
    const userId = getUserId();
    if (userId) void attemptSync(userId);
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') trigger();
  }

  window.addEventListener('online', trigger);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    window.removeEventListener('online', trigger);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}
