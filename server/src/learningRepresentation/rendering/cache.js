// In-memory cache around render(), keyed on (representation, prompt, answer, render version).
// Shared across users: a hit needs a byte-for-byte match on prompt and answer, so nothing user-specific is reused.
// Only successful renders are cached, so a transient failure isn't sticky. Bumping a render version in schemas.js invalidates.
// Purely an optimization: a miss is the normal pipeline. State is per process and resets on deploy
// (same trade-off as assistant/budget.js), so expect a low hit rate when deploys are frequent.

const crypto = require('crypto');

const { getRenderVersion, hasRenderer } = require('./schemas');
const { render } = require('./renderer');

/** Cap on distinct cached renders, so the cache can't grow without bound (same idea as budget.js's MAX_TRACKED_USERS). */
const MAX_CACHE_ENTRIES = 2000;

/** How many entries to shed when the cap is hit, so eviction is not per-insert. */
const EVICTION_BATCH = 200;

/**
 * Build the cache key: a SHA-256 of the four NUL-delimited inputs. Hashing avoids delimiter collisions
 * in free text and keeps keys at 64 hex chars (prompt+answer can reach ~6500 chars). Exported for tests.
 *
 * @param {{representation: string, prompt: string, answer: string, version: number}} args
 * @returns {string}
 */
function buildCacheKey({ representation, prompt, answer, version }) {
  return crypto
    .createHash('sha256')
    .update(`${representation}\u0000${version}\u0000${prompt}\u0000${answer}`)
    .digest('hex');
}

/**
 * Create a bounded in-memory LRU-ish cache. A Map keeps insertion order, so delete-and-reinsert on
 * touch leaves the least-recently-touched entries at the front for eviction.
 *
 * @returns {{
 *   get: (key: string) => {representation: string, data: object}|undefined,
 *   set: (key: string, value: {representation: string, data: object}) => void,
 *   size: () => number,
 * }}
 */
function createRenderCache() {
  const entries = new Map();

  function evictIfNeeded() {
    if (entries.size < MAX_CACHE_ENTRIES) return;
    let shed = 0;
    for (const key of entries.keys()) {
      entries.delete(key);
      shed += 1;
      if (shed >= EVICTION_BATCH) break;
    }
  }

  function get(key) {
    const existing = entries.get(key);
    if (existing === undefined) return undefined;
    // Touch: re-insert to mark recently used, same as budget.js#consume.
    entries.delete(key);
    entries.set(key, existing);
    return existing;
  }

  function set(key, value) {
    evictIfNeeded();
    entries.delete(key);
    entries.set(key, value);
  }

  /** Empty the cache. Only tests use it: the route shares one singleton instance that would leak renders between cases. */
  function clear() {
    entries.clear();
  }

  return { get, set, clear, size: () => entries.size };
}

/**
 * Render, checking the cache first and populating it on a miss. Use this instead of calling render() directly.
 *
 * @param {object} args
 * @param {object} args.gemini forwarded to render() on a miss
 * @param {string} args.representation
 * @param {string} args.prompt
 * @param {string} args.answer
 * @param {string} args.requestId forwarded to render() on a miss
 * @param {ReturnType<typeof createRenderCache>} [args.cache] a missing cache always misses, never errors
 * @returns {Promise<
 *   {ok: true, representation: string, data: object, cached: boolean}
 *   |{ok: false, reason: string, metrics: object}
 * >}
 */
async function renderWithCache({ gemini, representation, prompt, answer, requestId, cache }) {
  // Bad representation ids are render()'s concern (invalid_representation); getRenderVersion() would throw for one.
  if (!cache || !hasRenderer(representation)) {
    const result = await render({ gemini, representation, prompt, answer, requestId });
    return result.ok
      ? { ok: true, representation: result.representation, data: result.data, cached: false }
      : result;
  }

  const key = buildCacheKey({ representation, prompt, answer, version: getRenderVersion(representation) });

  const hit = cache.get(key);
  if (hit) {
    return { ok: true, representation: hit.representation, data: hit.data, cached: true };
  }

  const result = await render({ gemini, representation, prompt, answer, requestId });
  if (!result.ok) return result; // never cache a failure — see module header

  cache.set(key, { representation: result.representation, data: result.data });
  return { ok: true, representation: result.representation, data: result.data, cached: false };
}

module.exports = {
  MAX_CACHE_ENTRIES,
  EVICTION_BATCH,
  buildCacheKey,
  createRenderCache,
  renderWithCache,
};
