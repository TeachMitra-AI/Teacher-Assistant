// Per-user daily interpret budget. Exceeding it produces a `budget_exhausted` passthrough, never an error.
// State is in process memory: it resets on restart and is per instance, so the effective limit is
// (limit x instances). That matches express-rate-limit's default MemoryStore; revisit if we go multi-instance.
// Built by a factory so tests get their own counter.

/**
 * Cap on tracked users. When reached, the least-recently-touched entries are evicted, which gives
 * them a fresh budget; under-enforcing is the safe direction since the IP rate limiter still applies.
 */
const MAX_TRACKED_USERS = 10000;

/** How many entries to shed when the cap is hit, so eviction is not per-insert. */
const EVICTION_BATCH = 1000;

/** UTC calendar day as a key ("2026-07-29"), so the reset doesn't depend on server timezone (05:30 IST). */
function dayKeyFor(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * Create a per-user daily budget counter.
 *
 * @param {object} options
 * @param {number} options.limit calls per user per day; from ASSISTANT_DAILY_BUDGET_PER_USER
 * @param {() => number} [options.now] injectable clock, so the tests own time
 * @returns {{
 *   consume: (userId: string) => boolean,
 *   peek: (userId: string) => number,
 *   size: () => number,
 *   limit: number
 * }}
 */
function createBudgetCounter({ limit, now = Date.now } = {}) {
  // Map insertion order gives least-recently-touched eviction: re-inserting on touch moves an entry to the end.
  const entries = new Map();

  function evictIfNeeded() {
    if (entries.size < MAX_TRACKED_USERS) return;
    let shed = 0;
    for (const key of entries.keys()) {
      entries.delete(key);
      shed += 1;
      if (shed >= EVICTION_BATCH) break;
    }
  }

  /**
   * Spend one unit of the user's daily budget; returns true if within budget.
   * Check and consume are one step so no path can forget to consume. A turn that ends before the
   * classifier still spends a unit, which is acceptable. A missing user id is allowed through.
   */
  function consume(userId) {
    if (!userId) return true;

    // Zero means nobody may route. Checked before the new-entry path, which would grant a free first call.
    if (limit <= 0) return false;

    const today = dayKeyFor(now());
    const existing = entries.get(userId);

    // New user, or an entry from a previous day: replace it so old callers don't accumulate.
    if (!existing || existing.dayKey !== today) {
      evictIfNeeded();
      entries.delete(userId);
      entries.set(userId, { dayKey: today, count: 1 });
      return true;
    }

    if (existing.count >= limit) {
      // Not re-inserted, so an over-budget user can't keep refreshing their eviction position.
      return false;
    }

    existing.count += 1;
    // Re-insert to mark it recently touched.
    entries.delete(userId);
    entries.set(userId, existing);
    return true;
  }

  /** Units spent today. Read-only, for tests and inspection. */
  function peek(userId) {
    const existing = entries.get(userId);
    if (!existing || existing.dayKey !== dayKeyFor(now())) return 0;
    return existing.count;
  }

  return {
    consume,
    peek,
    size: () => entries.size,
    limit,
  };
}

module.exports = {
  createBudgetCounter,
  dayKeyFor,
  MAX_TRACKED_USERS,
  EVICTION_BATCH,
};
