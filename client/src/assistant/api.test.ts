import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { INTERPRET_DEADLINE_MS, fetchCatalog, postInterpret } from './api';
import type { InterpretResponse } from './types';

// The shared api() is mocked, ApiError is not: the classification of a failure
// depends on the real error class, and stubbing it would test the stub.
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, api: vi.fn() };
});

const { api } = await import('../api');
const mockedApi = vi.mocked(api);

const response: InterpretResponse = {
  catalogVersion: 1,
  passthrough: false,
  actions: [],
  requestId: 'req-1',
};

const request = { utterance: 'make a worksheet' };

beforeEach(() => {
  mockedApi.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('postInterpret — the request', () => {
  it('posts to the interpret endpoint with the envelope it was given', async () => {
    mockedApi.mockResolvedValue(response);
    await postInterpret({
      utterance: 'make a worksheet',
      catalogVersion: 1,
      memory: {},
      pendingAsk: null,
      turn: 3,
      sequence: 7,
    });

    expect(mockedApi).toHaveBeenCalledWith('/assistant/interpret', {
      method: 'POST',
      body: {
        utterance: 'make a worksheet',
        catalogVersion: 1,
        memory: {},
        pendingAsk: null,
        turn: 3,
        sequence: 7,
      },
    });
  });
});

describe('postInterpret — outcomes', () => {
  it('returns the response on a well-formed 200', async () => {
    mockedApi.mockResolvedValue(response);
    await expect(postInterpret(request)).resolves.toEqual({ status: 'ok', response });
  });

  it('rejects a 200 whose body is not the envelope this build reads', async () => {
    // A service-worker-cached client meeting a newer server is an everyday
    // state, not an edge case. An unreadable body is treated as a passthrough.
    mockedApi.mockResolvedValue({ passthrough: true });
    await expect(postInterpret(request)).resolves.toEqual({ status: 'rejected' });
  });

  it.each([
    ['a network error', 0],
    ['a rate limit', 429],
    ['a server error', 500],
    ['a bad gateway', 502],
  ])('treats %s as unavailable, which trips the breaker', async (_label, status) => {
    mockedApi.mockRejectedValue(new ApiError('failed', status));
    await expect(postInterpret(request)).resolves.toEqual({ status: 'unavailable' });
  });

  it.each([
    ['a malformed request', 400],
    ['an expired session', 401],
    ['a forbidden call', 403],
    ['a missing route', 404],
  ])('treats %s as rejected, which does NOT trip the breaker', async (_label, status) => {
    // None of these says anything about whether the endpoint is healthy, and
    // disabling routing for a minute over a 400 would turn one client bug into a
    // minute of degraded behaviour.
    mockedApi.mockRejectedValue(new ApiError('failed', status));
    await expect(postInterpret(request)).resolves.toEqual({ status: 'rejected' });
  });

  it('treats an unrecognised failure as unavailable', async () => {
    mockedApi.mockRejectedValue(new TypeError('undefined is not a function'));
    await expect(postInterpret(request)).resolves.toEqual({ status: 'unavailable' });
  });

  it('never throws, whatever the shared client does', async () => {
    mockedApi.mockRejectedValue('a bare string');
    await expect(postInterpret(request)).resolves.toEqual({ status: 'unavailable' });
  });
});

describe('postInterpret — the deadline', () => {
  it('gives up once the deadline passes and reports unavailable', async () => {
    vi.useFakeTimers();
    mockedApi.mockImplementation(() => new Promise(() => {}));

    const pending = postInterpret(request);
    await vi.advanceTimersByTimeAsync(INTERPRET_DEADLINE_MS + 1);

    await expect(pending).resolves.toEqual({ status: 'unavailable' });
  });

  it('does not fire for a response that arrives in time', async () => {
    vi.useFakeTimers();
    mockedApi.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(response), INTERPRET_DEADLINE_MS - 1000))
    );

    const pending = postInterpret(request);
    await vi.advanceTimersByTimeAsync(INTERPRET_DEADLINE_MS - 1000);

    await expect(pending).resolves.toEqual({ status: 'ok', response });
  });

  it('sits outside the server budget rather than duplicating it', () => {
    // The server's own deadline is 5 s and it converts a timeout into a 200
    // passthrough, so this is the point at which the NETWORK has failed.
    expect(INTERPRET_DEADLINE_MS).toBeGreaterThan(5000);
  });
});

describe('fetchCatalog', () => {
  it('returns a well-formed catalog', async () => {
    const catalog = { catalogVersion: 1, actions: [] };
    mockedApi.mockResolvedValue(catalog);
    await expect(fetchCatalog()).resolves.toEqual(catalog);
    expect(mockedApi).toHaveBeenCalledWith('/assistant/catalog');
  });

  it('returns null on a malformed payload', async () => {
    mockedApi.mockResolvedValue({ actions: 'nope' });
    await expect(fetchCatalog()).resolves.toBeNull();
  });

  it('returns null rather than throwing on any failure', async () => {
    mockedApi.mockRejectedValue(new ApiError('offline', 0));
    await expect(fetchCatalog()).resolves.toBeNull();
  });

  it('returns null when it exceeds the deadline', async () => {
    vi.useFakeTimers();
    mockedApi.mockImplementation(() => new Promise(() => {}));

    const pending = fetchCatalog();
    await vi.advanceTimersByTimeAsync(INTERPRET_DEADLINE_MS + 1);

    await expect(pending).resolves.toBeNull();
  });
});
