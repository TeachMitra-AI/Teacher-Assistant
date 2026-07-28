// AI Action Router — typed wrappers over the app's existing api() (M6).
//
// Thin on purpose. This module adds three things the shared client does not
// have, and nothing else: the assistant's request/response TYPES, a SHAPE CHECK
// on the response, and a client-side DEADLINE.
//
// ─── WHY THE DEADLINE IS A RACE AND NOT AN ABORT (approved decision D11) ────
// client/src/api.ts is on the untouched list (spec §2.6) and exposes no
// AbortSignal. The two ways to get one would be to edit that file — which the
// impact analysis forbids — or to call fetch() directly here, which would mean
// re-implementing the 401 refresh-and-retry that every other request in this app
// gets for free. Re-implementing an auth path to save a socket is a bad trade.
//
// So the request is raced against a timer. The socket stays open and the
// response is simply discarded; the sequence guard in RouterProvider already
// discards late responses, so this adds no new failure mode. It is honest rather
// than elegant, and the alternative was worse.
//
// ─── WHY A SHAPE CHECK ON A 200 ────────────────────────────────────────────
// The client is a PWA with service-worker caching, so a client one release
// behind its server is an everyday state rather than an edge case. A response
// that does not carry the fields the executor reads is treated as a passthrough,
// which is the same outcome as any other failure and requires no new UI.

import { api, ApiError } from '../api';
import type { CatalogResponse, InterpretRequest, InterpretResponse } from './types';

/**
 * Six seconds. The server's own budget is five (§4.5: a 3.5 s per-call timeout
 * inside a 5 s overall deadline), and it converts a timeout into a 200
 * passthrough rather than an error — so this is not a second timeout on the same
 * work. It is the point at which the NETWORK, not the model, has clearly failed,
 * and the teacher should stop waiting.
 */
const DEADLINE_MS = 6000;

/**
 * What a request to /interpret produced.
 *
 * `unavailable` and `rejected` differ in exactly one way: `unavailable` trips
 * the circuit breaker and `rejected` does not. A malformed request or an expired
 * session says nothing about whether the endpoint is healthy, and disabling the
 * feature for a minute over a 400 would turn one client bug into a minute of
 * degraded routing.
 */
export type InterpretOutcome =
  | { status: 'ok'; response: InterpretResponse }
  | { status: 'unavailable' }
  | { status: 'rejected' };

/** Marker for the deadline branch of the race — never thrown outward. */
const DEADLINE = Symbol('assistant-deadline');

/**
 * Races a request against the deadline.
 *
 * The timer is always cleared, including when the request wins, so a session of
 * routing does not accumulate pending timers on a low-end device.
 */
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

/** Does this look like the envelope the executor expects? */
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

/**
 * Is this failure the endpoint's health, or this request's validity?
 *
 * Status 0 is the shared client's network-error code. An unrecognised failure
 * counts as unavailable: the conservative direction is the one that stops the
 * teacher waiting, and a client defect that keeps throwing should stop costing
 * six seconds a turn even though nobody has diagnosed it yet.
 */
function isTransportFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  if (error.status === 0 || error.status === 429) return true;
  return error.status >= 500;
}

/**
 * The actions this caller may currently use.
 *
 * Best-effort by contract: every caller must work without it. Returns null on
 * any failure, and the caller carries on unrouted or uses what it already had.
 */
export async function fetchCatalog(): Promise<CatalogResponse | null> {
  try {
    const raced = await withDeadline(api<unknown>('/assistant/catalog'));
    if (raced === DEADLINE) return null;
    return isCatalogResponse(raced) ? raced : null;
  } catch {
    return null;
  }
}

/**
 * Ask the server what to do with a message.
 *
 * Never throws. Every failure is one of the two non-ok outcomes, because this
 * sits behind a text box: the teacher did not knowingly invoke the router and
 * must never see an error from it.
 */
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

/** Test seam: the deadline is policy, and the tests assert the policy rather than re-declaring it. */
export const INTERPRET_DEADLINE_MS = DEADLINE_MS;
