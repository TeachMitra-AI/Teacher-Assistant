// Milestone M8 — the two operational scripts.
//
// These are the least glamorous files in the milestone and two of the most
// consequential:
//
//   assistantMetrics.js    computes the number that GATES THE LAUNCH. A metric
//                          nobody tested is the one number in a project that can
//                          be quietly wrong forever, because nothing contradicts
//                          it.
//
//   pruneAssistantEvents.js DELETES ROWS. Its scoping rule is the only thing
//                          standing between a retention run and the safety-flag
//                          and user-approval records, which have entirely
//                          different retention needs and no backup.

const { computeMetrics } = require('../../tools/assistantMetrics');
const { parseArgs, buildPruneWhere } = require('../../tools/pruneAssistantEvents');
const { prisma } = require('../../src/lib/db');
const {
  ASSISTANT_EVENT_TYPES,
  ASSISTANT_EVENT_RETENTION_DAYS,
} = require('../../src/assistant/contracts');

const DELIVERED = 'assistant_prefill_delivered';
const OUTCOME = 'assistant_prefill_outcome';

/** Shorthand for a row as the script reads it. */
function row(type, metadata) {
  return { type, metadata: JSON.stringify(metadata) };
}

describe('the field-edit rate', () => {
  test('is corrected fields over delivered fields', () => {
    const metrics = computeMetrics([
      row(DELIVERED, { actionId: 'generate_assessment', requestId: 'r1', fieldCount: 8 }),
      row(OUTCOME, { actionId: 'generate_assessment', requestId: 'r1', outcome: 'generated', correctedCount: 2 }),
    ]);

    expect(metrics.deliveredFields).toBe(8);
    expect(metrics.correctedFields).toBe(2);
    expect(metrics.fieldEditRate).toBeCloseTo(0.25);
  });

  test('is null rather than zero when nothing was delivered', () => {
    // A rate over an empty denominator is undefined. Printing "0.0%" for it
    // would look like a perfect score in exactly the situation where there is no
    // evidence at all — the failure mode this project keeps calling out.
    expect(computeMetrics([]).fieldEditRate).toBeNull();
  });

  test('aggregates across sessions rather than averaging rates', () => {
    // Averaging per-session rates would weight a 1-field session as heavily as
    // an 8-field one and quietly flatter a bad router.
    const metrics = computeMetrics([
      row(DELIVERED, { requestId: 'r1', fieldCount: 8 }),
      row(OUTCOME, { requestId: 'r1', outcome: 'generated', correctedCount: 0 }),
      row(DELIVERED, { requestId: 'r2', fieldCount: 2 }),
      row(OUTCOME, { requestId: 'r2', outcome: 'generated', correctedCount: 2 }),
    ]);

    expect(metrics.fieldEditRate).toBeCloseTo(2 / 10);
  });

  test('survives a corrupt metadata string without throwing', () => {
    const metrics = computeMetrics([{ type: DELIVERED, metadata: '{not json' }, { type: OUTCOME, metadata: null }]);

    expect(metrics.prefillsDelivered).toBe(1);
    expect(metrics.fieldEditRate).toBeNull();
  });
});

describe('abandonment is derived from absence', () => {
  test('counts a delivery with no matching outcome', () => {
    const metrics = computeMetrics([
      row(DELIVERED, { requestId: 'r1', fieldCount: 8 }),
      row(OUTCOME, { requestId: 'r1', outcome: 'generated', correctedCount: 1 }),
      row(DELIVERED, { requestId: 'r2', fieldCount: 8 }),
    ]);

    expect(metrics.abandoned).toBe(1);
    expect(metrics.joinableDeliveries).toBe(2);
  });

  test('excludes unjoinable deliveries instead of assuming they were abandoned', () => {
    // A hand-written draft, or one written by a client older than M8, carries no
    // requestId. Counting "we cannot tell" as a failure would be pessimistic in
    // exactly the way a beacon would be optimistic.
    const metrics = computeMetrics([row(DELIVERED, { fieldCount: 8 })]);

    expect(metrics.abandoned).toBe(0);
    expect(metrics.joinableDeliveries).toBe(0);
  });
});

describe('the diagnostic breakdown', () => {
  test('separates corrections by provenance, which is what makes the rate actionable', () => {
    // Edits concentrated in `utterance` mean the classifier is misreading
    // teachers; edits concentrated in `default` mean the defaults are stale.
    // Those call for opposite fixes and the aggregate cannot tell them apart.
    const metrics = computeMetrics([
      row(DELIVERED, { requestId: 'r1', fieldCount: 8 }),
      row(OUTCOME, {
        requestId: 'r1',
        outcome: 'generated',
        correctedCount: 3,
        corrections: [
          { field: 'grade', from: 'utterance' },
          { field: 'subject', from: 'utterance' },
          { field: 'language', from: 'profile' },
        ],
      }),
    ]);

    expect(metrics.correctionsBySource).toEqual({ utterance: 2, profile: 1 });
    expect(metrics.correctionsByField.grade).toBe(1);
  });

  test('counts the outcome mix', () => {
    const metrics = computeMetrics([
      row(OUTCOME, { outcome: 'generated' }),
      row(OUTCOME, { outcome: 'generated' }),
      row(OUTCOME, { outcome: 'undone' }),
      row(OUTCOME, { outcome: 'edited' }),
    ]);

    expect(metrics.outcomeMix).toEqual({ generated: 2, undone: 1, edited: 1 });
  });
});

describe('retention scoping — the rule that protects other people\'s rows', () => {
  test('the where clause names ONLY the two assistant types', () => {
    const where = buildPruneWhere(new Date());

    // Asserted on the SHAPE, not only the effect. A retention bug is not the
    // kind of thing to discover from its effect.
    expect(where.type.in).toEqual([...ASSISTANT_EVENT_TYPES]);
    expect(where.type.in).toHaveLength(2);
    for (const type of where.type.in) expect(type.startsWith('assistant_')).toBe(true);
  });

  test('defaults to the documented retention window', () => {
    expect(parseArgs([], {}).days).toBe(ASSISTANT_EVENT_RETENTION_DAYS);
  });

  test('reads the environment, and falls back safely on a typo', () => {
    expect(parseArgs([], { ASSISTANT_EVENT_RETENTION_DAYS: '30' }).days).toBe(30);
    // A bad value must not silently become "delete everything".
    expect(parseArgs([], { ASSISTANT_EVENT_RETENTION_DAYS: 'ninety' }).days).toBe(
      ASSISTANT_EVENT_RETENTION_DAYS
    );
  });

  test('an explicit --days flag wins over the environment', () => {
    expect(parseArgs(['--days', '7'], { ASSISTANT_EVENT_RETENTION_DAYS: '30' }).days).toBe(7);
  });

  test('--dry-run is off unless asked for', () => {
    expect(parseArgs([], {}).dryRun).toBe(false);
    expect(parseArgs(['--dry-run'], {}).dryRun).toBe(true);
  });
});

describe('retention, actually executed against the database', () => {
  const OTHER_TYPES = ['ai_safety_flag', 'user_approved', 'ai_deadline_exceeded'];

  afterEach(async () => {
    await prisma.event.deleteMany({
      where: { type: { in: [...ASSISTANT_EVENT_TYPES, ...OTHER_TYPES] } },
    });
  });

  test('deletes aged assistant rows and leaves every other type untouched', async () => {
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

    // Tracked by ID rather than by counting rows of each type: other suites in
    // this run legitimately create safety-flag and approval rows, and a count
    // would make this test's verdict depend on what else ran first. The suite
    // shares one SQLite file (fileParallelism: false), so isolation has to come
    // from the assertion, not from the table being empty.
    const doomedIds = [];
    const protectedIds = [];
    for (const type of ASSISTANT_EVENT_TYPES) {
      const row = await prisma.event.create({ data: { type, metadata: '{}', createdAt: old } });
      doomedIds.push(row.id);
    }
    for (const type of OTHER_TYPES) {
      const row = await prisma.event.create({ data: { type, metadata: '{}', createdAt: old } });
      protectedIds.push(row.id);
    }

    const where = buildPruneWhere(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000));
    await prisma.event.deleteMany({ where });

    // THE ASSERTION THIS WHOLE FILE EXISTS FOR. These rows are institutional
    // records — a prune that widened by accident would destroy them silently
    // and irrecoverably. Note they are the same age as the deleted ones, so
    // only the type filter can be what saved them.
    const survivors = await prisma.event.findMany({ where: { id: { in: protectedIds } } });
    expect(survivors).toHaveLength(OTHER_TYPES.length);

    const pruned = await prisma.event.findMany({ where: { id: { in: doomedIds } } });
    expect(pruned).toHaveLength(0);
  });

  test('leaves assistant rows that are still inside the window', async () => {
    await prisma.event.create({ data: { type: ASSISTANT_EVENT_TYPES[0], metadata: '{}' } });

    await prisma.event.deleteMany({
      where: buildPruneWhere(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)),
    });

    expect(await prisma.event.count({ where: { type: ASSISTANT_EVENT_TYPES[0] } })).toBe(1);
  });
});
