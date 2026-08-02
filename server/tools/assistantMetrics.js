// AI Action Router — the field-edit rate, computed from telemetry (M8).
//
// An OPERATIONAL SCRIPT, not application code. It is here rather than behind an
// admin endpoint because routes/admin.js is on the explicitly-untouched list
// (spec §2.3), and because this number is read during a rollout decision by
// someone with shell access, not by a teacher in a browser.
//
// ─── WHY THIS NUMBER IS THE LAUNCH GATE ────────────────────────────────────
// Decision D16: instrument the CORRECTION signal, not model confidence. A router
// reporting "high confidence" on every utterance while teachers rewrite half the
// fields is a bad router that looks excellent in its own logs. The honest metric
// is the share of prefilled fields a teacher changes before generating.
//
//   field-edit rate = corrected fields / delivered fields
//
// Launch gate: < 20%. Sustained < 15% before auto-generation is even discussed.
//
// ─── WHY `abandoned` IS DERIVED HERE AND NOT EMITTED ───────────────────────
// A delivered prefill with no outcome row IS the abandonment. Emitting it would
// mean an unload beacon, and beacons are unreliable on exactly the low-end
// mobile browsers this product targets — so an emitted `abandoned` would
// undercount, which reads as good news. Deriving it from absence cannot.
//
// Read-only. This script never writes or deletes anything.
//
// Usage:  npm run assistant:metrics -- [--days 30] [--school DPS001]

const { prisma } = require('../src/lib/db');
const { ASSISTANT_EVENT_RETENTION_DAYS } = require('../src/assistant/contracts');

const DELIVERED = 'assistant_prefill_delivered';
const OUTCOME = 'assistant_prefill_outcome';

/** Minimal flag parsing — no dependency for a script with two options. */
function parseArgs(argv) {
  const args = { days: ASSISTANT_EVENT_RETENTION_DAYS, school: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--days' && argv[i + 1]) args.days = Number(argv[i + 1]);
    if (argv[i] === '--school' && argv[i + 1]) args.school = argv[i + 1];
  }
  if (!Number.isFinite(args.days) || args.days <= 0) args.days = ASSISTANT_EVENT_RETENTION_DAYS;
  return args;
}

/** Rows store metadata as a JSON string, matching the convention used elsewhere. */
function parseMetadata(row) {
  try {
    const parsed = JSON.parse(row.metadata || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Turn raw rows into the metrics.
 *
 * Exported and pure so its arithmetic is unit-tested rather than eyeballed in a
 * terminal — a metric that gates a launch should not be the one number in the
 * project nobody wrote a test for.
 *
 * @param {{type: string, metadata: string|null}[]} rows
 */
function computeMetrics(rows) {
  const delivered = [];
  const outcomes = [];
  for (const row of rows) {
    if (row.type === DELIVERED) delivered.push(parseMetadata(row));
    else if (row.type === OUTCOME) outcomes.push(parseMetadata(row));
  }

  const deliveredFields = delivered.reduce((sum, meta) => sum + (meta.fieldCount || 0), 0);
  const correctedFields = outcomes.reduce((sum, meta) => sum + (meta.correctedCount || 0), 0);
  const lowConfidenceFields = delivered.reduce((sum, meta) => sum + (meta.lowConfidenceCount || 0), 0);

  const outcomeMix = { generated: 0, undone: 0, edited: 0 };
  for (const meta of outcomes) {
    if (meta.outcome in outcomeMix) outcomeMix[meta.outcome] += 1;
  }

  // Abandonment by absence: a delivered row whose requestId never appears on an
  // outcome row. Deliveries with no requestId at all (a hand-written draft, or a
  // client older than this field) cannot be joined and are excluded from the
  // denominator rather than assumed abandoned — counting "we cannot tell" as a
  // failure would make the number pessimistic in a way that is just as dishonest
  // as a beacon making it optimistic.
  const outcomeRequestIds = new Set(outcomes.map((meta) => meta.requestId).filter(Boolean));
  const joinable = delivered.filter((meta) => Boolean(meta.requestId));
  const abandoned = joinable.filter((meta) => !outcomeRequestIds.has(meta.requestId)).length;

  // WHICH provenance produces the corrections is the diagnostic half. Edits
  // concentrated in `utterance` mean the classifier is misreading teachers;
  // edits concentrated in `profile` or `default` mean the defaults are stale.
  // Those call for opposite fixes, and the aggregate rate cannot tell them apart.
  const correctionsByField = {};
  const correctionsBySource = {};
  for (const meta of outcomes) {
    for (const correction of meta.corrections || []) {
      correctionsByField[correction.field] = (correctionsByField[correction.field] || 0) + 1;
      correctionsBySource[correction.from] = (correctionsBySource[correction.from] || 0) + 1;
    }
  }

  return {
    prefillsDelivered: delivered.length,
    deliveredFields,
    correctedFields,
    lowConfidenceFields,
    // Null rather than 0 when nothing was delivered: a rate over an empty
    // denominator is undefined, and printing "0.0%" for it would look like a
    // perfect score in the exact situation where there is no evidence at all.
    fieldEditRate: deliveredFields > 0 ? correctedFields / deliveredFields : null,
    outcomeMix,
    abandoned,
    joinableDeliveries: joinable.length,
    correctionsByField,
    correctionsBySource,
  };
}

function formatRate(rate) {
  return rate === null ? 'n/a (no prefills delivered)' : `${(rate * 100).toFixed(1)}%`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const since = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);

  const where = { type: { in: [DELIVERED, OUTCOME] }, createdAt: { gte: since } };
  if (args.school) {
    const school = await prisma.school.findUnique({ where: { code: args.school }, select: { id: true } });
    if (!school) {
      console.error(`No school with code "${args.school}".`);
      process.exitCode = 1;
      return;
    }
    where.schoolId = school.id;
  }

  const rows = await prisma.event.findMany({ where, select: { type: true, metadata: true } });
  const metrics = computeMetrics(rows);

  console.log(`\nAI Action Router — telemetry, last ${args.days} day(s)${args.school ? ` · school ${args.school}` : ''}`);
  console.log('─'.repeat(64));
  console.log(`Prefills delivered      ${metrics.prefillsDelivered}`);
  console.log(`Fields delivered        ${metrics.deliveredFields}`);
  console.log(`Fields corrected        ${metrics.correctedFields}`);
  console.log(`FIELD-EDIT RATE         ${formatRate(metrics.fieldEditRate)}   (launch gate: < 20%)`);
  console.log(`Low-confidence fields   ${metrics.lowConfidenceFields}`);
  console.log('');
  console.log(`Outcome — generated     ${metrics.outcomeMix.generated}`);
  console.log(`Outcome — edited only   ${metrics.outcomeMix.edited}`);
  console.log(`Outcome — undone        ${metrics.outcomeMix.undone}   (a flatly wrong routing)`);
  console.log(`Outcome — abandoned     ${metrics.abandoned} of ${metrics.joinableDeliveries} joinable (derived, not emitted)`);

  const bySource = Object.entries(metrics.correctionsBySource).sort((a, b) => b[1] - a[1]);
  if (bySource.length > 0) {
    console.log('\nCorrections by provenance (which SOURCE teachers rewrite):');
    for (const [source, count] of bySource) console.log(`  ${source.padEnd(12)} ${count}`);
  }

  const byField = Object.entries(metrics.correctionsByField).sort((a, b) => b[1] - a[1]);
  if (byField.length > 0) {
    console.log('\nCorrections by field:');
    for (const [field, count] of byField) console.log(`  ${field.padEnd(14)} ${count}`);
  }
  console.log('');
}

// Importable for tests, runnable as a script — the same pattern seed.js uses.
if (require.main === module) {
  main()
    .catch((error) => {
      console.error('assistant:metrics failed:', error.message);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { computeMetrics, parseArgs, DELIVERED, OUTCOME };
