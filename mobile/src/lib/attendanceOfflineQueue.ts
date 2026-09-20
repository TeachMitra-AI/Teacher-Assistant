// Offline check-in/check-out queue — same shape as lib/offlineQueue.ts (this
// app's "one offline feature" pattern), applied to Teacher Attendance.
// Scope, deliberately narrow: only enqueues when checkIn()/checkOut() fails
// with a NETWORK error (ApiError.status === 0) — see CheckInScreen.tsx. A
// real rejection (already checked in, outside geofence, validation error) is
// never queued; retrying it would just fail again the same way.
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus } from 'react-native';
import { ApiError } from '../api/client';
import { checkIn, checkOut, type AttendanceEvidenceInput, type AttendanceActionResult } from '../api/teacherAttendanceApi';

const STORAGE_KEY = 'offlineQueue:attendance';
const INITIAL_RETRY_DELAY_MS = 5000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

export type QueuedActionKind = 'check-in' | 'check-out';

export interface QueuedAttendanceAction {
  // `${userId}:${date}:${kind}` — a second offline attempt for the same
  // user+date+kind replaces this entry in place (the newer evidence
  // supersedes the older).
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

async function readQueue(): Promise<QueuedAttendanceAction[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: QueuedAttendanceAction[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeToQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  listeners.forEach((l) => l());
}

export async function getQueue(userId?: string): Promise<QueuedAttendanceAction[]> {
  const all = await readQueue();
  return userId ? all.filter((item) => item.userId === userId) : all;
}

export async function getQueuedAction(userId: string, date: string, kind: QueuedActionKind): Promise<QueuedAttendanceAction | null> {
  const all = await readQueue();
  return all.find((item) => item.key === buildQueueKey(userId, date, kind)) ?? null;
}

/**
 * Enqueue (or coalesce into) a queued action. Called only when the online
 * attempt fails with a network error. Resets attempts/backoff/error state on
 * coalesce: a fresh attempt deserves a fresh retry cycle.
 */
export async function enqueueAction(
  userId: string,
  date: string,
  kind: QueuedActionKind,
  evidence: AttendanceEvidenceInput
): Promise<void> {
  const all = await readQueue();
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

async function updateQueueItem(key: string, patch: Partial<QueuedAttendanceAction>): Promise<void> {
  const all = await readQueue();
  const next = all.map((item) => (item.key === key ? { ...item, ...patch } : item));
  await writeQueue(next);
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

// Serializes sync attempts — a NetInfo reconnect and an AppState foreground
// transition firing close together must never race each other into two
// concurrent upload loops for the same queue.
let syncing = false;

/**
 * Processes this user's queued items in creation order, one at a time. A
 * network failure on any item stops the whole pass (further items are
 * almost certainly offline too); a permanent failure only stops retrying
 * *that* item and moves on. Items already carrying a permanentError are
 * skipped — they wait for an explicit retryQueuedAction().
 */
export async function attemptSync(userId: string): Promise<void> {
  if (syncing) return;
  syncing = true;
  try {
    const now = Date.now();
    const pending = (await readQueue())
      .filter((item) => item.userId === userId && !item.permanentError && item.nextRetryAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt);

    for (const item of pending) {
      const outcome = await syncOne(item);
      if (outcome.result === 'synced') {
        await removeFromQueue(item.key);
        continue;
      }
      if (outcome.result === 'network-retry') {
        await updateQueueItem(item.key, {
          attempts: item.attempts + 1,
          nextRetryAt: Date.now() + nextBackoff(item.attempts),
        });
        break; // still offline — stop the pass rather than retrying every item in a row
      }
      await updateQueueItem(item.key, {
        permanentError: 'Could not sync this attendance action. It has not been lost — you can retry or discard it.',
      });
    }
  } finally {
    syncing = false;
  }
}

export async function retryQueuedAction(key: string, userId: string): Promise<void> {
  await updateQueueItem(key, { permanentError: null, nextRetryAt: 0 });
  await attemptSync(userId);
}

// UI is responsible for confirming this with the user first — it discards
// unsynced evidence.
export async function discardQueuedAction(key: string): Promise<void> {
  await removeFromQueue(key);
}

/**
 * Wires the two approved sync triggers — a NetInfo reconnect transition and
 * an AppState foreground transition — to attemptSync() for whichever user is
 * currently signed in. `getUserId` is read fresh on every event rather than
 * captured once, so this only needs to be started once for the app's
 * lifetime.
 */
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
