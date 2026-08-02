// AI Action Router — `Event` retention for assistant telemetry (M8).
//
// An OPERATIONAL SCRIPT. Retention is a policy the project did not previously
// have at all: `Event` held rare incidents (safety flags, notable upstream
// failures, user approvals) where unbounded growth was harmless. Routine
// telemetry changes that, and spec §4.8 requires the policy to exist BEFORE
// telemetry is enabled — which is why this lands in M8 with the writers rather
// than later as cleanup.
//
// ─── WHY A SCRIPT AND NOT A SWEEPER ON THE REQUEST PATH ────────────────────
// Opportunistic pruning ("delete a few old rows whenever we write one") would
// put DELETE statements on the very path CHANGE-6 exists to keep clear. The
// backing store is single-writer SQLite serving every authenticated request; the
// entire point of the two-rows-per-session ceiling is to keep that path quiet.
// Trading a bounded, scheduled deletion for an unbounded, request-time one would
// undo the milestone's main safety property.
//
// ─── THE SCOPING RULE — READ BEFORE CHANGING ANYTHING HERE ─────────────────
// This script deletes ONLY the two `assistant_*` types. It must never be able to
// reach `ai_safety_flag`, `user_approved`, `user_rejected`, `ai_deadline_exceeded`
// or any other row: those are institutional records with different (and longer)
// retention needs, and a prune that widened by accident would destroy them
// silently and irrecoverably. The allow-list is an explicit `in` filter over the
// frozen ASSISTANT_EVENT_TYPES, never a prefix LIKE and never a bare date filter,
// and a test seeds a safety-flag row and asserts it survives.
//
// Usage:  npm run assistant:prune-events -- [--days 90] [--dry-run]

const { prisma } = require('../src/lib/db');
const { parseIntEnv } = require('../src/lib/config');
const {
  ASSISTANT_EVENT_TYPES,
  ASSISTANT_EVENT_RETENTION_DAYS,
} = require('../src/assistant/contracts');

/**
 * Retention in days, in precedence order: an explicit --days flag, then
 * ASSISTANT_EVENT_RETENTION_DAYS, then the documented default.
 *
 * The env var is read through the same clamp-and-warn helper the rest of the
 * server uses, so a typo produces a warning and the safe default rather than an
 * accidental `--days 0`. It is read here rather than in contracts.js because
 * contracts.js is a frozen, pure vocabulary module with no environment
 * dependency, and giving it one would make the wire contracts configurable.
 *
 * @param {string[]} argv
 * @param {Record<string, string|undefined>} [env]
 */
function parseArgs(argv, env = process.env) {
  const fromEnv = parseIntEnv(env.ASSISTANT_EVENT_RETENTION_DAYS, {
    name: 'ASSISTANT_EVENT_RETENTION_DAYS',
    defaultValue: ASSISTANT_EVENT_RETENTION_DAYS,
    min: 0,
    max: 3650,
  });

  const args = { days: fromEnv, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--days' && argv[i + 1]) args.days = Number(argv[i + 1]);
    if (argv[i] === '--dry-run') args.dryRun = true;
  }
  // A non-numeric --days must not silently become "delete everything". Falling
  // back to the documented default is the safe direction; 0 stays legal because
  // "prune everything assistant-written" is a legitimate operation when
  // decommissioning the feature, and it is still scoped to the two types.
  if (!Number.isFinite(args.days) || args.days < 0) args.days = fromEnv;
  return args;
}

/**
 * The `where` clause, built in one place and exported so a test can assert its
 * SHAPE rather than only its effect. A retention bug is not the kind of thing to
 * discover from its effect.
 */
function buildPruneWhere(cutoff) {
  return { type: { in: [...ASSISTANT_EVENT_TYPES] }, createdAt: { lt: cutoff } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cutoff = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
  const where = buildPruneWhere(cutoff);

  const doomed = await prisma.event.count({ where });

  console.log(`\nAI Action Router — assistant telemetry retention`);
  console.log('─'.repeat(64));
  console.log(`Retention        ${args.days} day(s)`);
  console.log(`Cutoff           ${cutoff.toISOString()}`);
  console.log(`Types in scope   ${ASSISTANT_EVENT_TYPES.join(', ')}`);
  console.log(`Rows to delete   ${doomed}`);

  if (args.dryRun) {
    console.log('\n--dry-run: nothing deleted.\n');
    return;
  }
  if (doomed === 0) {
    console.log('\nNothing to prune.\n');
    return;
  }

  const { count } = await prisma.event.deleteMany({ where });
  console.log(`Deleted          ${count}\n`);
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('assistant:prune-events failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { parseArgs, buildPruneWhere };
