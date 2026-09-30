// Typed wrappers over api() for the assistant endpoints, with a response shape check and a client-side deadline.
// The deadline is a race, not an abort: api() takes no AbortSignal, and calling fetch() directly would mean
// re-implementing its 401 refresh-and-retry. The late response is simply dropped (RouterProvider's seq guard
// already ignores stale ones). A 200 with an unexpected shape counts as a passthrough, since a cached PWA client
// can easily be a release behind the server.

import { api, ApiError } from '../api';
import type {
  AssistantEventsRequest,
  CatalogResponse,
  InterpretRequest,
  InterpretResponse,
} from './types';

// Just above the server's 5s budget, so it only fires when the network has failed rather than the model.
const DEADLINE_MS = 6000;

/**
 * `unavailable` trips the circuit breaker; `rejected` doesn't. A 400 or an expired session says nothing
 * about whether the endpoint is healthy.
 */
export type InterpretOutcome =
  | { status: 'ok'; response: InterpretResponse }
  | { status: 'unavailable' }
  | { status: 'rejected' };

// Sentinel for the deadline branch of the race; never thrown.
const DEADLINE = Symbol('assistant-deadline');

// Clears the timer even when the request wins, so timers don't pile up on low-end devices.
async function withDeadline<T>(work: Promise<T>): Promise<T | typeof DEADLINE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<typeof DEADLINE>((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE), DEADLINE_MS);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isInterpretResponse(value: unknown): value is InterpretResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return (
    typeof raw.catalogVersion === 'number' &&
    typeof raw.passthrough === 'boolean' &&
    Array.isArray(raw.actions) &&
    typeof raw.requestId === 'string'
  );
}

function isCatalogResponse(value: unknown): value is CatalogResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return typeof raw.catalogVersion === 'number' && Array.isArray(raw.actions);
}

// Unknown failures count as transport failures: better to stop the teacher waiting than keep paying the deadline every turn.
function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.status === 0 || error.status === 429) return true;
  return error.status >= 500;
}

/** Best-effort: returns null on any failure and callers must work without it. */
export async function fetchCatalog(): Promise<CatalogResponse | null> {
  try {
    const raced = await withDeadline(api<unknown>('/assistant/catalog'));
    if (raced === DEADLINE) return null;
    return isCatalogResponse(raced) ? raced : null;
  } catch {
    return null;
  }
}

/** Never throws: the teacher didn't knowingly invoke the router, so they should never see an error from it. */
export async function postInterpret(body: InterpretRequest): Promise<InterpretOutcome> {
  try {
    const raced = await withDeadline(
      api<unknown>('/assistant/interpret', { method: 'POST', body })
    );
    if (raced === DEADLINE) return { status: 'unavailable' };
    return isInterpretResponse(raced) ? { status: 'ok', response: raced } : { status: 'rejected' };
  } catch (error) {
    return isTransportFailure(error) ? { status: 'unavailable' } : { status: 'rejected' };
  }
}

/**
 * Sends a batch of telemetry events. Never throws and never retries; a failed batch is dropped so telemetry
 * can't degrade the edit path. No deadline race, since nothing waits on the response. The payload is metadata only.
 */
export async function postAssistantEvents(body: AssistantEventsRequest): Promise<boolean> {
  if (body.events.length === 0) return true;
  try {
    await api<unknown>('/assistant/events', { method: 'POST', body });
    return true;
  } catch {
    return false;
  }
}

// Exposed so tests assert the policy instead of redeclaring it.
export const INTERPRET_DEADLINE_MS = DEADLINE_MS;
