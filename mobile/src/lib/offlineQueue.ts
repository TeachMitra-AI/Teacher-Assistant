// Offline attendance save queue — the ONE offline feature this app builds,
// scoped exactly to Attendance's bulk-save per docs/mobile-app-plan.md §18 /
// §26 Phase 12. Not a general offline framework: one AsyncStorage-backed
// array of full-day snapshots, coalesced by user+class+date, synced one at a
// time against the existing bulk-upsert endpoint completely unchanged. The
// endpoint's own upsert-by-(studentId,date) semantics (server/src/routes/
// classroom.js) make a replayed POST naturally idempotent — no client-side
// dedup logic is needed beyond "don't queue two entries for the same day."
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';
import { saveAttendance } from '../api/classroomApi';
import { ApiError } from '../api/client';
import type { AttendanceStatus } from '../types';

const STORAGE_KEY = 'offlineQueue:attendance';
const INITIAL_RETRY_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

export interface QueuedAttendanceSave {
  // `${userId}:${classId}:${date}` — the coalescing key. A second offline
  // save for the same user+class+date replaces this entry in place rather
  // than appending a redundant one, since buildSaveMarks() already produces
  // a complete day snapshot (every active student, not a diff) — the newer
  // snapshot fully supersedes the older one by construction.
  key: string;
  userId: string;
  classId: string;
  date: string;
  marks: { studentId: string; status: AttendanceStatus }[];
  createdAt: number;
  updatedAt: number;
  attempts: number;
  nextRetryAt: number;
  // Set once a non-network (genuine server) failure is hit for this item.
  // Non-null means "stop auto-retrying — needs a manual Retry or Discard."
  permanentError: string | null;
}

// Exported so call sites (useMarkAttendanceScreen.ts) never hand-construct
// this format themselves — one definition of the coalescing key.
export function buildQueueKey(userId: string, classId: string, date: string): string {
  return `${userId}:${classId}:${date}`;
}

async function readQueue(): Promise<QueuedAttendanceSave[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Corrupt/unreadable storage is treated as an empty queue rather than a
    // crash — there is nothing recoverable to do with unparseable local data.
    return [];
  }
}

async function writeQueue(items: QueuedAttendanceSave[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

type Listener = () => void;
const listeners = new Set<Listener>();

// Lets a mounted screen react to queue changes (its own entry synced,
// errored, or was updated by a later save) without polling. Fired after
// every mutation below.
export function subscribeToQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  listeners.forEach((l) => l());
}

export async function getQueue(userId?: string): Promise<QueuedAttendanceSave[]> {
  const all = await readQueue();
  return userId ? all.filter((item) => item.userId === userId) : all;
}

export async function getQueuedItem(userId: string, classId: string, date: string): Promise<QueuedAttendanceSave | null> {
  const all = await readQueue();
  return all.find((item) => item.key === buildQueueKey(userId, classId, date)) ?? null;
}

// Enqueue (or coalesce into) a queued save. Called only when the online save
// fails with a network error (ApiError.status === 0) — see
// useMarkAttendanceScreen.ts. Resets attempts/backoff/error state on
// coalesce: a fresh edit deserves a fresh retry cycle, not a stale backoff
// or error inherited from whatever the previous attempt for this same
// class/date left behind.
export async function enqueueAttendanceSave(
  userId: string,
  classId: string,
  date: string,
  marks: { studentId: string; status: AttendanceStatus }[]
): Promise<void> {
  const all = await readQueue();
  const key = buildQueueKey(userId, classId, date);
  const now = Date.now();
  const existing = all.find((item) => item.key === key);
  const next: QueuedAttendanceSave = {
    key,
    userId,
    classId,
    date,
    marks,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    attempts: 0,
    nextRetryAt: 0,
    permanentError: null,
  };
  const rest = all.filter((item) => item.key !== key);
  await writeQueue([...rest, next]);
  notify();
}

export async function removeFromQueue(key: string): Promise<void> {
  const all = await readQueue();
  const next = all.filter((item) => item.key !== key);
  if (next.length !== all.length) {
    await writeQueue(next);
    notify();
  }
}

async function updateQueueItem(key: string, patch: Partial<QueuedAttendanceSave>): Promise<void> {
  const all = await readQueue();
  const next = all.map((item) => (item.key === key ? { ...item, ...patch } : item));
  await writeQueue(next);
  notify();
}

function nextBackoff(attempts: number): number {
  const delay = INITIAL_RETRY_DELAY_MS * 2 ** attempts;
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

async function syncOne(item: QueuedAttendanceSave): Promise<'synced' | 'network-retry' | 'permanent-error'> {
  try {
    await saveAttendance(item.classId, item.date, item.marks);
    return 'synced';
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) return 'network-retry';
    return 'permanent-error';
  }
}

// Serializes sync attempts — a NetInfo reconnect event and an AppState
// foreground event firing close together must never race each other into
// two concurrent upload loops for the same queue.
let syncing = false;

// Processes this user's queued items in creation order, one at a time (§18).
// A network failure on any item stops the whole pass (further items are
// almost certainly offline too — no point hammering them); a permanent
// (non-network) failure only stops retrying *that* item and moves on to the
// next, since it isn't a connectivity problem. Items already carrying a
// permanentError are skipped — they wait for an explicit retryQueuedItem().
export async function attemptSync(userId: string): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const now = Date.now();
    const pending = (await readQueue())
      .filter((item) => item.userId === userId && !item.permanentError && item.nextRetryAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const item of pending) {
      const result = await syncOne(item);
      if (result === 'synced') {
        await removeFromQueue(item.key);
        continue;
      }
      if (result === 'network-retry') {
        await updateQueueItem(item.key, {
          attempts: item.attempts + 1,
          nextRetryAt: Date.now() + nextBackoff(item.attempts),
        });
        break; // still offline — stop the pass rather than retrying every item in a row
      }
      // permanent-error
      await updateQueueItem(item.key, {
        permanentError: 'Could not sync this attendance save. It has not been lost — you can retry or discard it.',
      });
    }
  } finally {
    syncing = false;
  }
}

// Manual "Retry" action for an item that hit a permanent error — clears the
// error and attempts it immediately, independent of the automatic pass
// above (which deliberately skips permanent-error items).
export async function retryQueuedItem(key: string, userId: string): Promise<void> {
  await updateQueueItem(key, { permanentError: null, nextRetryAt: 0 });
  await attemptSync(userId);
}

// Manual "Discard" action — the UI is responsible for confirming this with
// the user first (it deletes unsynced attendance data).
export async function discardQueuedItem(key: string): Promise<void> {
  await removeFromQueue(key);
}

// Wires the two approved Phase 12 sync triggers — a NetInfo reconnect
// transition and an AppState foreground transition — to attemptSync() for
// whichever user is currently signed in. `getUserId` is read fresh on every
// event (a ref in the caller) rather than captured once, so this only needs
// to be started a single time for the app's lifetime, not re-subscribed on
// every login/logout. Deliberately no periodic timer (approved scope).
export function startAutoSync(getUserId: () => string | null): () => void {
  let wasConnected = true;

  const netSub = NetInfo.addEventListener((state) => {
    const isConnected = state.isConnected === true;
    if (isConnected && !wasConnected) {
      const userId = getUserId();
      if (userId) void attemptSync(userId);
    }
    wasConnected = isConnected;
  });

  function handleAppStateChange(next: AppStateStatus): void {
    if (next === 'active') {
      const userId = getUserId();
      if (userId) void attemptSync(userId);
    }
  }
  const appStateSub = AppState.addEventListener('change', handleAppStateChange);

  return () => {
    netSub();
    appStateSub.remove();
  };
}
