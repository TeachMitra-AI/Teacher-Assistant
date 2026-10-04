// Offline check-in/check-out queue, the web counterpart to mobile's offlineQueue.ts. The PWA only caches the app shell, not
// failed API writes, so this mirrors mobile's shape (coalescing key, exponential backoff, a permanentError distinction,
// serialized sync) on localStorage and browser sync triggers. Deliberately narrow: only a network error (ApiError.status
// === 0) from checkIn()/checkOut() is queued (see CheckInTab.tsx); a real rejection (already checked in, outside geofence,
// validation) would just fail again.
import { ApiError } from '../api';
import { checkIn, checkOut, type AttendanceEvidenceInput, type AttendanceActionResult } from './teacherAttendanceApi';

const STORAGE_KEY = 'attendance:offlineQueue';
const INITIAL_RETRY_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

export type QueuedActionKind = 'check-in' | 'check-out';

export interface QueuedAttendanceAction {
  // `${userId}:${date}:${kind}`: a second offline attempt for the same key replaces this entry, since newer evidence supersedes older.
  key: string;
  userId: string;
  date: string; // "YYYY-MM-DD", the device's local date when queued
  kind: QueuedActionKind;
  evidence: AttendanceEvidenceInput;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  nextRetryAt: number;
  // Set once a non-network (server) failure is hit; non-null means stop auto-retrying until a manual Retry or Discard.
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
    // Corrupt storage is treated as an empty queue; there's nothing recoverable in unparseable data.
    return [];
  }
}

function writeQueue(items: QueuedAttendanceAction[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

type Listener = () => void;
const listeners = new Set<Listener>();

// Lets a mounted component react to queue changes without polling; fired after every mutation.
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

/** Enqueues, or coalesces into an existing entry (only called after a network failure; see CheckInTab.tsx). Coalescing resets attempts, backoff and error state so a fresh attempt gets a fresh retry cycle. */
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

async function syncOne(
  item: QueuedAttendanceAction
): Promise<
  | { result: 'synced'; attendance: AttendanceActionResult }
  | { result: 'network-retry' }
  | { result: 'permanent-error'; message?: string }
> {
  try {
    const attendance = item.kind === 'check-in' ? await checkIn(item.evidence) : await checkOut(item.evidence);
    return { result: 'synced', attendance };
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) return { result: 'network-retry' };
    // Carry the server's real reason (e.g. "You have already checked in today.") when there is one, instead of
    // always showing the same generic string regardless of why the sync permanently failed.
    return { result: 'permanent-error', message: err instanceof ApiError ? err.message : undefined };
  }
}

// Serializes sync attempts so an 'online' event and a visibility change firing together can't run two upload loops.
let syncing = false;

/**
 * Processes this user's queued items in creation order. A network failure stops the pass (later items are likely offline
 * too); a permanent failure only stops retrying that item. Items with a permanentError are skipped until an explicit
 * retryQueuedAction().
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
        break; // still offline: stop the pass
      }
      updateQueueItem(item.key, {
        permanentError:
          outcome.message ??
          'Could not sync this attendance action. It has not been lost — you can retry or discard it.',
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

// The UI must confirm with the user first, since this discards unsynced evidence.
export function discardQueuedAction(key: string): void {
  removeFromQueue(key);
}

/**
 * Wires the two web sync triggers (`window.online` and the page becoming visible) to attemptSync() for the signed-in user.
 * `getUserId` is read on every event, so this only needs starting once. No periodic timer, matching mobile's startAutoSync.
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
