// The telemetry module's own unit tests. The endpoint is covered in test/assistant.events.test.js; this checks the
// structural part of the privacy rule: buildMetadata builds its result from an explicit key list, so an event with an
// unexpected key can't leak it even if upstream let it through.

// describe/test/expect/vi and the hooks are globals (`globals: true` in vitest.config.js); vitest is ESM-only, so requiring it would fail.

const {
  writeAssistantEvents,
  isKnownSlotName,
  isKnownActionId,
  KNOWN_SLOT_NAMES,
  KNOWN_ACTION_IDS,
  EVENT_TYPE_BY_NAME,
} = require('../../src/assistant/telemetry');
const { prisma } = require('../../src/lib/db');

const CONTEXT = { userId: 'user-1', schoolId: 'school-1', requestId: 'req-1' };

/** Capture what would be written, without touching the database. */
function captureWrites() {
  const written = [];
  const spy = vi.spyOn(prisma.event, 'create').mockImplementation(async ({ data }) => {
    written.push(data);
    return { id: 'x', ...data };
  });
  return { written, spy };
}

let capture;

beforeEach(() => {
  capture = captureWrites();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the allow-lists are derived from the registry, not hardcoded', () => {
  test('knows the slots the generator descriptor declares', () => {
    // If this list were hardcoded, a new action would silently drop its corrections. Deriving it means adding an action touches no core file.
    for (const slot of ['format', 'topic', 'grade', 'subject', 'questionCount']) {
      expect(KNOWN_SLOT_NAMES).toContain(slot);
    }
    expect(isKnownSlotName('grade')).toBe(true);
    expect(isKnownSlotName('Fractions')).toBe(false);
  });

  test('knows the registered action ids', () => {
    expect(KNOWN_ACTION_IDS).toContain('generate_assessment');
    expect(isKnownActionId('generate_assessment')).toBe(true);
    expect(isKnownActionId('a worksheet about fractions')).toBe(false);
  });

  test('maps every wire name to a prefixed Event type', () => {
    // The prefix is what lets retention scope itself without being able to reach
    // safety flags or user-approval records.
    for (const type of Object.values(EVENT_TYPE_BY_NAME)) {
      expect(type.startsWith('assistant_')).toBe(true);
    }
  });
});

describe('metadata is built from an explicit key list', () => {
  test('ignores a key nobody declared, rather than spreading it through', async () => {
    // The structural privacy rule: a "spread then delete the dangerous keys" writer fails when someone invents a new
    // dangerous key, where this one has nowhere to put an unknown key. The route's strict envelope would already reject
    // this payload; the point is that the writer is safe if called from elsewhere.
    await writeAssistantEvents(
      [
        {
          name: 'prefill_delivered',
          actionId: 'generate_assessment',
          fieldCount: 8,
          utterance: 'Generate a Class 5 fractions worksheet',
          topic: 'Fractions',
        },
      ],
      CONTEXT
    );

    const [row] = capture.written;
    expect(JSON.parse(row.metadata)).toEqual({ actionId: 'generate_assessment', fieldCount: 8 });
    expect(row.metadata).not.toContain('Fractions');
  });

  test('keeps only registry-declared field names in corrections', async () => {
    await writeAssistantEvents(
      [
        {
          name: 'prefill_outcome',
          actionId: 'generate_assessment',
          outcome: 'edited',
          corrections: [
            { field: 'grade', from: 'utterance' },
            { field: 'photosynthesis in class 7', from: 'utterance' },
          ],
        },
      ],
      CONTEXT
    );

    const metadata = JSON.parse(capture.written[0].metadata);
    expect(metadata.corrections).toEqual([{ field: 'grade', from: 'utterance' }]);
    expect(metadata.correctedCount).toBe(1);
  });

  test('drops an outcome value outside the closed set', async () => {
    await writeAssistantEvents(
      [{ name: 'prefill_outcome', actionId: 'generate_assessment', outcome: 'exfiltrated' }],
      CONTEXT
    );

    expect(JSON.parse(capture.written[0].metadata).outcome).toBeUndefined();
  });

  test('carries the caller identity so a per-school rate is computable', async () => {
    await writeAssistantEvents(
      [{ name: 'prefill_delivered', actionId: 'generate_assessment', fieldCount: 4 }],
      CONTEXT
    );

    expect(capture.written[0].userId).toBe('user-1');
    expect(capture.written[0].schoolId).toBe('school-1');
  });
});

describe('failure posture', () => {
  test('never throws when the database write fails', async () => {
    capture.spy.mockRejectedValue(new Error('SQLITE_BUSY: database is locked'));

    // Telemetry sits behind a teacher's form. A measurement that can break the
    // thing it measures is worth less than no measurement.
    const result = await writeAssistantEvents(
      [{ name: 'prefill_delivered', actionId: 'generate_assessment', fieldCount: 8 }],
      CONTEXT
    );

    expect(result).toEqual({ written: 0, failed: 1 });
  });

  test('drops an unknown event name instead of writing an unqueryable row', async () => {
    const result = await writeAssistantEvents(
      [{ name: 'prefill_smuggled', actionId: 'generate_assessment' }],
      CONTEXT
    );

    expect(result).toEqual({ written: 0, failed: 1 });
    expect(capture.written).toHaveLength(0);
  });

  test('one bad event does not lose the rest of the batch', async () => {
    const result = await writeAssistantEvents(
      [
        { name: 'prefill_delivered', actionId: 'not_an_action', fieldCount: 8 },
        { name: 'prefill_delivered', actionId: 'generate_assessment', fieldCount: 8 },
      ],
      CONTEXT
    );

    expect(result).toEqual({ written: 1, failed: 1 });
  });
});

describe('volume', () => {
  test('writes exactly one row per event — never one per correction', async () => {
    // Six corrections arrive collapsed into one outcome event and must stay one row.
    const corrections = KNOWN_SLOT_NAMES.slice(0, 6).map((field) => ({ field, from: 'utterance' }));

    await writeAssistantEvents(
      [
        { name: 'prefill_delivered', actionId: 'generate_assessment', fieldCount: 8 },
        { name: 'prefill_outcome', actionId: 'generate_assessment', outcome: 'generated', corrections },
      ],
      CONTEXT
    );

    expect(capture.written).toHaveLength(2);
  });
});
