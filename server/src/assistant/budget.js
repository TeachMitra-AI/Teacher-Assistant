// Per-user daily interpret budget (Phase 1, Milestone M9).
//
// This is the counter M5 deliberately left unbuilt. Stage 7 of the pipeline has
// checked a budget since M5, but through an injectable seam that counted nothing
// (decision D1) — because inventing per-user state at M5 would have meant either
// a migration (forbidden in Phase 1, D4/G18) or a process-local cache nobody had
// agreed to. M9 supplies the cache, with the agreement recorded below.
//
// ─── WHERE THE STATE LIVES, AND WHAT THAT COSTS ────────────────────────────
// In process memory. A Map of userId -> { dayKey, count }. Two honest
// consequences, neither hidden:
//
//   1. IT RESETS WHEN THE SERVER RESTARTS. A deploy hands every teacher a fresh
//      budget.
//   2. IT IS PER PROCESS. If this app is ever run as more than one instance, the
//      effective ceiling is (limit x instances), not (limit).
//
// Both were accepted knowingly (approval A1). The alternatives were a migration
// or a new datastore, and the deciding argument is that express-rate-limit's
// default MemoryStore — which has ALREADY backed the /api/coach and /api/auth
// limiters since before this project existed — has exactly these two properties.
// M9 therefore introduces no new class of weakness; it matches the established
// one. If the deployment ever becomes multi-instance, this control degrades to
// per-instance and must be revisited BEFORE that happens, not after.
//
// ─── WHY IT IS A FACTORY AND NOT A MODULE SINGLETON ────────────────────────
// Approval A4. The server test suite runs with fileParallelism: false and shares
// one required src/index.js per worker, so module-level mutable state would leak
// between test files and make failures depend on execution order. Constructing
// the counter in index.js and injecting it (exactly as geminiFast is handled)
// keeps every test able to build its own.
//
// ─── WHAT IT PROTECTS ──────────────────────────────────────────────────────
// Upstream capacity, not accounting accuracy. Exceeding the budget produces a
// `budget_exhausted` passthrough — a normal coaching answer — never an error.

/**
 * Largest number of users tracked at once.
 *
 * A Map keyed by user id grows with the number of DISTINCT callers, which is
 * bounded by the roll of the schools using the product — but "bounded by
 * something else's size" is not a bound. This one is explicit so the counter can
 * never become a memory-growth vector, and it sits far above any realistic
 * single-instance population.
 *
 * When it is reached, the least-recently-touched entries are evicted, which
 * hands those users a fresh budget. That is UNDER-enforcement, and it is the
 * right direction to fail: the IP rate limiter still stands in front, and a
 * teacher wrongly denied routing is a worse outcome than a teacher wrongly
 * allowed thirty more classifications.
 */
const MAX_TRACKED_USERS = 10000;

/** How many entries to shed when the cap is hit, so eviction is not per-insert. */
const EVICTION_BATCH = 1000;

/**
 * The UTC calendar day, as a comparable key.
 *
 * UTC rather than local time, so the boundary does not move with the server's
 * timezone configuration. For this product's users that puts the reset at 05:30
 * IST — before the school day rather than in the middle of it, which is the
 * useful side of the boundary to land on.
 *
 * @param {number} timestamp epoch milliseconds
 * @returns {string} e.g. "2026-07-29"
 */
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
  // A Map preserves insertion order, which is what makes least-recently-touched
  // eviction possible without a second data structure: re-inserting on every
  // touch moves an entry to the end, so the oldest live at the front.
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
   * Spend one unit of this user's daily budget.
   *
   * CHECK AND CONSUME ARE ONE OPERATION (approval A2). Splitting them into
   * "check now, consume later once we know a model call really happened" would
   * be more accurate and would introduce the one failure mode a budget must not
   * have: a path that forgets to consume, and a counter that silently stops
   * counting. The cost of combining them is that a turn which ends before the
   * classifier — an emergency, an empty catalog — still spends a unit. Those are
   * rare, and over-enforcement degrades to a coaching answer, which this
   * architecture treats as always safe.
   *
   * A missing user id is allowed through rather than counted: the caller is
   * authenticated by the time this runs, so an absent id is a bug in our code,
   * and failing a teacher's request over it would be the wrong response to it.
   *
   * @param {string} userId
   * @returns {boolean} true if the call is within budget (and has been counted)
   */
  function consume(userId) {
    if (!userId) return true;

    // A limit of zero means nobody may route. Checked BEFORE the new-entry path
    // below, which would otherwise hand every first-time caller one free call —
    // found by the integration test that asserted an exhausted budget spends no
    // model call, and worth fixing even though parseIntEnv clamps the env var at
    // a minimum of 1: a control that is wrong at its own boundary teaches nobody
    // to trust it, and a future caller may not come through the env.
    if (limit <= 0) return false;

    const today = dayKeyFor(now());
    const existing = entries.get(userId);

    // A new user, or one whose entry is from a previous day. Either way the
    // stale entry is replaced rather than kept, which is why the map does not
    // accumulate yesterday's callers.
    if (!existing || existing.dayKey !== today) {
      evictIfNeeded();
      entries.delete(userId);
      entries.set(userId, { dayKey: today, count: 1 });
      return true;
    }

    if (existing.count >= limit) {
      // Deliberately NOT re-inserted: a user who is already over budget should
      // not keep refreshing their position in the eviction order by continuing
      // to call. Being evicted is the only way they get a fresh budget early,
      // and they should not be able to postpone it.
      return false;
    }

    existing.count += 1;
    // Re-insert to mark it recently touched.
    entries.delete(userId);
    entries.set(userId, existing);
    return true;
  }

  /**
   * How much of today's budget this user has spent. Read-only; for tests and for
   * operational inspection. Never used to make a decision.
   */
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
