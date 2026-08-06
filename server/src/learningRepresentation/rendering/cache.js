// Request-level render cache — AI Learning Representation System, Phase E
// (docs/learning-representation-system-adr.md, §13 Phase E). Frozen
// architecture, agreed before implementation began:
//
//   - Wraps render() (rendering/renderer.js) from the OUTSIDE. render.js
//     itself is not modified — it is already a pure function of its
//     explicit arguments, which is what makes it wrappable without any
//     internal change. This module is purely additive.
//   - Keyed on EXACTLY render()'s real inputs: representation, prompt,
//     answer, and the representation's current render version (schemas.js).
//     Nothing more (no grade, no language, no curriculum) — none of those
//     are actual render() inputs today, and adding speculative fields to
//     the key would be premature. The day any of them becomes a real input,
//     the key must grow to match, or the cache would silently serve output
//     that was never generated for the new input.
//   - A version bump on a RENDER_SPECS entry IS the invalidation mechanism
//     (see schemas.js's header) — no separate purge/expiry logic exists or
//     is needed for correctness.
//   - GLOBAL, not per-user. Unlike assistant/budget.js's counters, which
//     are inherently per-user (rationing an individual's usage), this cache
//     is shared across every teacher. That is safe specifically because a
//     hit requires a LITERAL, byte-for-byte match on prompt AND answer —
//     structurally the same guarantee ADR §11 already relies on (rendering
//     is grounded in the exact answer given), so sharing a hit across two
//     teachers who happened to ask the identical question and received the
//     identical answer introduces no grounding risk. This is a narrower,
//     safer claim than topic-level caching (deferred — see the ADR
//     discussion) would be able to make.
//
// ─── ONLY SUCCESSFUL RENDERS ARE EVER CACHED ───────────────────────────────
// A render() failure (timeout, safety block, invalid content) is NEVER
// written to the cache. Caching a failure would mean a transient upstream
// hiccup becomes a PERMANENT one for that exact input until the process
// restarts — worse than not caching at all. Every miss, including a
// previous failure for the identical input, gets a fresh attempt.
//
// ─── THIS IS AN OPTIMIZATION ONLY — READ THIS BEFORE CHANGING THAT ────────
// A cache miss is not a degraded path; it IS the pipeline's normal
// behaviour with caching subtracted out. Losing every entry can never
// affect correctness, grounding, or any teacher's data — at worst, latency
// and cost temporarily revert to exactly what they were before this module
// existed. That property is what makes the trade-offs below acceptable
// rather than merely tolerated.
//
// ─── WHERE THE STATE LIVES, AND WHAT THAT COSTS (mirrors
//     assistant/budget.js's own header, same trade-offs, same reasoning) ──
// In process memory. Two honest consequences, neither hidden:
//
//   1. IT RESETS WHEN THE SERVER RESTARTS. A deploy empties the cache.
//   2. IT IS PER PROCESS. If this app is ever run as more than one
//      instance, each instance warms its own cache independently.
//
// Both were accepted knowingly, for the same reason budget.js's identical
// trade-offs were: express-rate-limit's default MemoryStore already has
// exactly these two properties and has backed this app's rate limiters
// since before this project existed, so this introduces no new class of
// weakness — it matches an already-accepted one. A persistent (e.g.
// SQLite-backed) cache was considered and rejected for V1: this app's own
// telemetry design (assistant/telemetry.js's CHANGE-6) exists specifically
// because a naive per-event write pattern once threatened to turn a
// low-volume table into a sustained write stream on single-writer SQLite —
// a cache is inherently higher-volume than that, and avoiding the same
// mistake here was judged not worth the schema/migration/eviction-script
// surface it would cost, against a benefit (durable reuse across restarts)
// that is mostly already realized in-memory anyway: the primary reuse
// pattern this cache targets — the same teacher re-triggering the same
// panel within one session (a refresh, a retry, quickly revisiting a
// turn) — operates on a timescale of seconds to minutes, almost always
// well inside one process's uptime.
//
// ─── DEPLOY CADENCE AND HIT RATE (read before drawing conclusions from
//     Phase F metrics) ─────────────────────────────────────────────────
// This cache's realized benefit is proportional to how long the process
// stays up between restarts, and on this app's deployment platform
// (Railway; filesystem already documented elsewhere as ephemeral) restarts
// are a normal, frequent operational event, not an exception. During a
// period of frequent deploys the cache may rarely get the chance to warm
// up, and the observed hit rate will be low as a DIRECT, EXPECTED
// consequence of deploy frequency — not a sign this mechanism is broken or
// poorly designed. Whoever reviews cache-hit telemetry in Phase F should
// read a low hit rate alongside deploy frequency for that period, the same
// way budget.js's reset-on-restart is read alongside deploy frequency
// rather than treated as a stable daily allowance.
//
// If the deployment model ever becomes multi-instance or a persistent
// cache becomes clearly worth its cost, this is the point to revisit —
// exactly the same caveat budget.js already states for itself.

const crypto = require('crypto');

const { getRenderVersion, hasRenderer } = require('./schemas');
const { render } = require('./renderer');

/**
 * Largest number of DISTINCT (representation, prompt, answer, version)
 * combinations tracked at once. Bounded so the cache can never become a
 * memory-growth vector, mirroring assistant/budget.js's MAX_TRACKED_USERS —
 * same reasoning, different axis (distinct requests instead of distinct
 * users).
 */
const MAX_CACHE_ENTRIES = 2000;

/** How many entries to shed when the cap is hit, so eviction is not per-insert. */
const EVICTION_BATCH = 200;

/**
 * Build the cache key for one render. Pure and exported separately so it is
 * testable in isolation from the cache's storage/eviction behaviour.
 *
 * A SHA-256 digest of the four inputs, NUL-delimited, rather than naive
 * string concatenation: prompt/answer are teacher-authored free text that
 * could in principle contain any delimiter a human might pick, and hashing
 * both avoids any delimiter-collision risk AND keeps the Map's keys a fixed
 * 64 hex characters instead of growing with every prompt/answer stored
 * (prompt+answer together can be up to ~6500 characters — see
 * routes/learningRepresentation.js's MAX_PROMPT_LENGTH/MAX_ANSWER_LENGTH).
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
 * Create a bounded, in-memory, LRU-ish render cache.
 *
 * Same Map-ordering trick assistant/budget.js uses for eviction: a `Map`
 * preserves insertion order, so deleting and re-inserting an entry on every
 * touch moves it to the end, leaving the least-recently-touched entries at
 * the front for eviction.
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

  /**
   * Empty the cache. Not used by any request path — this exists for tests
   * that exercise the route through the real, shared app instance (e.g.
   * test/routes/learningRepresentation.test.js), where the cache is a
   * singleton constructed once in index.js and would otherwise leak
   * successful renders between test cases that reuse the same
   * prompt/answer fixture text.
   */
  function clear() {
    entries.clear();
  }

  return { get, set, clear, size: () => entries.size };
}

/**
 * Render, checking the cache first and populating it on a genuine miss.
 * The function callers should use in place of a direct render() call once
 * a cache instance exists — render() itself is never modified.
 *
 * @param {object} args
 * @param {object} args.gemini forwarded to render() on a miss
 * @param {string} args.representation
 * @param {string} args.prompt
 * @param {string} args.answer
 * @param {string} args.requestId forwarded to render() on a miss
 * @param {ReturnType<typeof createRenderCache>} [args.cache] optional — a
 *   missing cache (e.g. app assembled without one) degrades to "always
 *   miss", never to an error.
 * @returns {Promise<
 *   {ok: true, representation: string, data: object, cached: boolean}
 *   |{ok: false, reason: string, metrics: object}
 * >}
 */
async function renderWithCache({ gemini, representation, prompt, answer, requestId, cache }) {
  // Bad representation ids are render()'s own concern (invalid_representation)
  // — never build a cache key for one, since getRenderVersion() would throw
  // on a representation with no RENDER_SPECS entry.
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
