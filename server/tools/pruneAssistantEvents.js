// Operational script: `Event` retention for assistant telemetry. `Event` used to hold only rare incidents, where
// unbounded growth was harmless; routine telemetry needs a retention policy, which has to exist before it is enabled.
// It's a script, not a sweeper on the request path: pruning there would put DELETEs on the path the two-rows-per-session
// ceiling keeps quiet on single-writer SQLite.
// Scoping rule: it deletes only the two `assistant_*` types. It must never reach `ai_safety_flag`, `user_approved`,
// `user_rejected`, `ai_deadline_exceeded` or any other row, which are institutional records with longer retention.
// The allow-list is an explicit `in` filter over the frozen ASSISTANT_EVENT_TYPES, never a prefix LIKE or a bare date
// filter, and a test seeds a safety-flag row and asserts it survives.
// Usage:  npm run assistant:prune-events -- [--days 90] [--dry-run]

const { prisma } = require('../src/lib/db');
const { parseIntEnv } = require('../src/lib/config');
const {
  ASSISTANT_EVENT_TYPES,
  ASSISTANT_EVENT_RETENTION_DAYS,
} = require('../src/assistant/contracts');

/**
 * Retention in days, in precedence order: an explicit --days flag, then ASSISTANT_EVENT_RETENTION_DAYS, then the
 * default. The env var goes through the clamp-and-warn helper, so a typo warns and uses the default instead of
 * becoming `--days 0`. It's read here, not in contracts.js, which is a pure vocabulary module.
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
  // A non-numeric --days must not become "delete everything", so it falls back to the default. 0 stays legal: pruning
  // everything assistant-written is valid when decommissioning, and it's still scoped to the two types.
  if (!Number.isFinite(args.days) || args.days < 0) args.days = fromEnv;
  return args;
}

/**
 * The `where` clause, built in one place and exported so a test can assert its shape, not just its effect.
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
