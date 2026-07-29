// Milestone M8 — POST /api/assistant/events, end to end.
//
// Three things are worth proving here, and they are the three things that could
// actually hurt someone:
//
//   1. PRIVACY (G11). This endpoint is the only place a client POSTs telemetry,
//      which makes it the only place teacher-authored text could be smuggled
//      into the database. The schema has no free-text field by construction;
//      these tests attack that claim directly rather than trusting it.
//
//   2. VOLUME (CHANGE-6 / finding D). `Event` is a RARE-INCIDENT table on
//      single-writer SQLite. The design promises at most two rows per routed
//      session, and a promise nobody counted is a hope.
//
//   3. INERTNESS. Flags off must mean zero rows, not "few rows".
//
// Flags are manipulated through process.env and restored afterwards, matching
// assistant.catalog.test.js — the route reads them per request, so this works
// against the shared app instance without rebuilding it.

const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { MAX_EVENT_BATCH } = require('../src/assistant/contracts');

const ASSISTANT_ENV_KEYS = [
  'ASSISTANT_ENABLED',
  'ASSISTANT_ACTION_GENERATE_ASSESSMENT',
  'ASSISTANT_ACTION_OPEN_GENERATOR',
  'ASSISTANT_ALLOWED_ROLES',
  'ASSISTANT_ALLOWED_SCHOOL_CODES',
];

const ASSISTANT_TYPES = ['assistant_prefill_delivered', 'assistant_prefill_outcome'];

let fixtures;
let teacherToken;
let savedEnv;

function enableAssistant() {
  process.env.ASSISTANT_ENABLED = 'true';
  process.env.ASSISTANT_ACTION_GENERATE_ASSESSMENT = 'true';
  process.env.ASSISTANT_ACTION_OPEN_GENERATOR = 'true';
  process.env.ASSISTANT_ALLOWED_ROLES = 'teacher';
  delete process.env.ASSISTANT_ALLOWED_SCHOOL_CODES;
}

function clearAssistantEnv() {
  for (const key of ASSISTANT_ENV_KEYS) delete process.env[key];
}

/** Every assistant row this user has written, newest last. */
async function assistantRows() {
  return prisma.event.findMany({
    where: { userId: fixtures.teacherA.id, type: { in: ASSISTANT_TYPES } },
    orderBy: { createdAt: 'asc' },
  });
}

async function clearAssistantRows() {
  await prisma.event.deleteMany({ where: { type: { in: ASSISTANT_TYPES } } });
}

function post(body, token = teacherToken) {
  const req = request(app).post('/api/assistant/events');
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send(body);
}

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'asstev');
  teacherToken = await loginAs(app, fixtures.schoolA, fixtures.teacherA, fixtures.PASSWORD);
  savedEnv = Object.fromEntries(ASSISTANT_ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await clearAssistantRows();
});

beforeEach(async () => {
  clearAssistantEnv();
  await clearAssistantRows();
});

describe('authentication and the rollout gate', () => {
  test('requires a token', async () => {
    const res = await request(app)
      .post('/api/assistant/events')
      .send({ events: [{ name: 'prefill_delivered', actionId: 'generate_assessment', fieldCount: 8 }] });
    expect(res.status).toBe(401);
  });

  test('is INERT with the flags off — accepts the call and writes nothing', async () => {
    // Not a 404 and not a 403: the client posts telemetry without knowing or
    // caring whether it is inside the rollout, exactly as it fetches a catalog
    // that may be empty. Silence is the correct inert behaviour.
    const res = await post({
      events: [{ name: 'prefill_delivered', actionId: 'generate_assessment', fieldCount: 8 }],
    });

    expect(res.status).toBe(204);
    expect(await assistantRows()).toHaveLength(0);
  });

  test('writes nothing when the caller\'s role is outside the rollout', async () => {
    enableAssistant();
    process.env.ASSISTANT_ALLOWED_ROLES = 'super_admin';

    await post({ events: [{ name: 'prefill_delivered', actionId: 'generate_assessment', fieldCount: 8 }] });

    expect(await assistantRows()).toHaveLength(0);
  });
});

describe('the envelope', () => {
  beforeEach(() => enableAssistant());

  test('rejects an unknown event name rather than storing it', async () => {
    const res = await post({ events: [{ name: 'something_new', actionId: 'generate_assessment' }] });

    expect(res.status).toBe(400);
    expect(await assistantRows()).toHaveLength(0);
  });

  test('rejects an unknown key — the shape a leak would take', async () => {
    const res = await post({
      events: [
        {
          name: 'prefill_delivered',
          actionId: 'generate_assessment',
          fieldCount: 8,
          utterance: 'Generate a Class 5 fractions worksheet',
        },
      ],
    });

    expect(res.status).toBe(400);
    expect(await assistantRows()).toHaveLength(0);
  });

  test('rejects an empty batch and a missing batch', async () => {
    expect((await post({ events: [] })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });

  test('rejects a batch larger than the cap', async () => {
    const events = Array.from({ length: MAX_EVENT_BATCH + 1 }, () => ({
      name: 'prefill_delivered',
      actionId: 'generate_assessment',
      fieldCount: 1,
    }));

    expect((await post({ events })).status).toBe(400);
    expect(await assistantRows()).toHaveLength(0);
  });

  test('rejects an outcome value outside the closed set', async () => {
    const res = await post({
      events: [{ name: 'prefill_outcome', actionId: 'generate_assessment', outcome: 'abandoned' }],
    });

    // `abandoned` is derived server-side from a delivery with no outcome, and is
    // deliberately NOT emittable. A client claiming it is a client to distrust.
    expect(res.status).toBe(400);
  });

  test('rejects a provenance value outside the closed set', async () => {
    const res = await post({
      events: [
        {
          name: 'prefill_outcome',
          actionId: 'generate_assessment',
          outcome: 'edited',
          corrections: [{ field: 'grade', from: 'telepathy' }],
        },
      ],
    });

    expect(res.status).toBe(400);
  });
});

describe('what actually gets stored', () => {
  beforeEach(() => enableAssistant());

  test('stores a delivery with its counts and its correlation id', async () => {
    await post({
      events: [
        {
          name: 'prefill_delivered',
          actionId: 'generate_assessment',
          requestId: '3f1c8a2d-6b4e-4c9a-9d2f-7e5a1b3c8d40',
          fieldCount: 8,
          lowConfidenceCount: 1,
        },
      ],
    });

    const rows = await assistantRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('assistant_prefill_delivered');
    expect(rows[0].userId).toBe(fixtures.teacherA.id);
    expect(rows[0].schoolId).toBe(fixtures.schoolA.id);
    expect(JSON.parse(rows[0].metadata)).toEqual({
      actionId: 'generate_assessment',
      requestId: '3f1c8a2d-6b4e-4c9a-9d2f-7e5a1b3c8d40',
      fieldCount: 8,
      lowConfidenceCount: 1,
    });
  });

  test('collapses many corrections into ONE outcome row', async () => {
    // The volume guarantee. Six corrections, one row — writing a row per
    // correction is the single easiest way to reintroduce the sustained write
    // stream CHANGE-6 exists to prevent.
    const corrections = ['grade', 'subject', 'topic', 'format', 'difficulty', 'questionCount'].map(
      (field) => ({ field, from: 'utterance' })
    );

    await post({
      events: [
        {
          name: 'prefill_outcome',
          actionId: 'generate_assessment',
          requestId: '3f1c8a2d-6b4e-4c9a-9d2f-7e5a1b3c8d40',
          outcome: 'generated',
          fieldCount: 8,
          corrections,
        },
      ],
    });

    const rows = await assistantRows();
    expect(rows).toHaveLength(1);

    const metadata = JSON.parse(rows[0].metadata);
    expect(metadata.correctedCount).toBe(6);
    expect(metadata.corrections).toHaveLength(6);
    expect(metadata.outcome).toBe('generated');
  });

  test('a full routed session costs exactly TWO rows', async () => {
    // The headline guarantee, asserted end to end rather than reasoned about.
    await post({
      events: [
        {
          name: 'prefill_delivered',
          actionId: 'generate_assessment',
          requestId: '8a2d6f1c-4e9b-4a3c-8d7f-2b5e9c1a4d63',
          fieldCount: 8,
          lowConfidenceCount: 0,
        },
        {
          name: 'prefill_outcome',
          actionId: 'generate_assessment',
          requestId: '8a2d6f1c-4e9b-4a3c-8d7f-2b5e9c1a4d63',
          outcome: 'generated',
          fieldCount: 8,
          corrections: [
            { field: 'grade', from: 'utterance' },
            { field: 'topic', from: 'memory' },
          ],
        },
      ],
    });

    expect(await assistantRows()).toHaveLength(2);
  });

  test('drops a field name the registry does not declare, keeping the row', async () => {
    // A bounded string is not enough on its own — a topic fits in 60 characters.
    // Unknown names are dropped rather than rejecting the whole event, because
    // losing one correction is immaterial and losing the outcome row would break
    // the denominator.
    await post({
      events: [
        {
          name: 'prefill_outcome',
          actionId: 'generate_assessment',
          outcome: 'edited',
          corrections: [
            { field: 'grade', from: 'utterance' },
            { field: 'Fractions and decimals', from: 'utterance' },
          ],
        },
      ],
    });

    const rows = await assistantRows();
    expect(rows).toHaveLength(1);

    const metadata = JSON.parse(rows[0].metadata);
    expect(metadata.corrections).toEqual([{ field: 'grade', from: 'utterance' }]);
    expect(metadata.correctedCount).toBe(1);
  });
});

describe('privacy — G11, attacked directly', () => {
  beforeEach(() => enableAssistant());

  test('no accepted payload can carry teacher text into a row', async () => {
    const teacherText = 'Generate a Class 5 fractions worksheet about photosynthesis';

    // Every field an attacker could reach, loaded with content. The strict
    // envelope rejects the unknown keys outright; the ones that ARE accepted are
    // enums and integers, so none of them can hold this string.
    await post({
      events: [
        {
          name: 'prefill_delivered',
          actionId: teacherText,
          requestId: teacherText,
          fieldCount: 8,
        },
      ],
    });
    await post({
      events: [
        {
          name: 'prefill_outcome',
          actionId: 'generate_assessment',
          outcome: 'edited',
          corrections: [{ field: teacherText, from: 'utterance' }],
        },
      ],
    });

    const rows = await assistantRows();
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('photosynthesis');
    expect(serialized).not.toContain('fractions');
    expect(serialized).not.toContain('Class 5');
  });

  test('bounds actionId and requestId so neither becomes a smuggling channel', async () => {
    const long = 'x'.repeat(300);

    expect((await post({ events: [{ name: 'prefill_delivered', actionId: long }] })).status).toBe(400);
    expect(
      (await post({ events: [{ name: 'prefill_delivered', actionId: 'a', requestId: long }] })).status
    ).toBe(400);
  });

  test('drops an event whose actionId is not a registered action', async () => {
    // REGRESSION GUARD for a real hole this suite found. `actionId` was bounded
    // at 60 characters and nothing else, and 60 characters is ample room for a
    // topic — teacher text posted through it reached a stored row. The bound is
    // now backed by registry membership.
    const res = await post({
      events: [
        {
          name: 'prefill_delivered',
          actionId: 'a fractions worksheet for class 5',
          fieldCount: 8,
        },
      ],
    });

    // Accepted at the envelope (it is a syntactically fine id) and dropped by
    // the writer, so a stale client's telemetry never becomes a 400 storm.
    expect(res.status).toBe(204);
    expect(await assistantRows()).toHaveLength(0);
  });

  test('rejects a requestId that is not the UUID shape the server mints', async () => {
    // The second half of the same hole: a free-form correlation id is a free
    // text field wearing a technical name.
    const res = await post({
      events: [
        {
          name: 'prefill_delivered',
          actionId: 'generate_assessment',
          requestId: 'fractions-for-class-5',
          fieldCount: 8,
        },
      ],
    });

    expect(res.status).toBe(400);
    expect(await assistantRows()).toHaveLength(0);
  });
});

describe('the error contract', () => {
  beforeEach(() => enableAssistant());

  test('never returns a 5xx, even for a payload designed to be awkward', async () => {
    const awkward = [
      { events: null },
      { events: 'not-an-array' },
      { events: [null] },
      { events: [{ name: 'prefill_delivered' }] },
      { events: [{ name: 'prefill_outcome', actionId: 'a', corrections: 'nope' }] },
      { events: [{ name: 'prefill_delivered', actionId: 'a', fieldCount: -5 }] },
      { events: [{ name: 'prefill_delivered', actionId: 'a', fieldCount: 1.5 }] },
    ];

    for (const body of awkward) {
      const res = await post(body);
      expect(res.status).toBeLessThan(500);
    }
  });
});
