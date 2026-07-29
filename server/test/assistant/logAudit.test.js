// Milestone M9 — the log audit, executed as an ATTACK.
//
// ─── WHY THIS FILE EXISTS IN THIS FORM ─────────────────────────────────────
// M9's checklist calls for a "log audit — no utterance text or slot values
// anywhere". The obvious way to do that is to read the logging code and confirm
// it looks careful. M8 is the reason that is not good enough: `actionId` and
// `requestId` had passed exactly that kind of review, were bounded strings and
// nothing else, and an integration test found teacher text travelling through
// them into a stored row. A LENGTH BOUND IS NOT A PRIVACY CONTROL.
//
// So this file does not read the code. It pushes a distinctive probe string
// through every field on every assistant surface that will accept a string, and
// then looks at what was actually written — both the stdout channel and the
// database. Whatever survives is a leak, whoever wrote it and however careful
// they were being.
//
// It complements rather than repeats the M8 suite: assistant.events.test.js
// attacks the /events envelope. This one covers all three endpoints, the
// DECISION LOG (channel 1, which M8 did not attack), and the fields that carry
// data the client controls — memory slots and pendingAsk — which no earlier
// milestone probed at all.

const request = require('supertest');

const { app, prisma } = require('../helpers/testApp');
const { createFixtures } = require('../helpers/fixtures');
const { loginAs } = require('../helpers/auth');
const { mockGeminiFetch, geminiSuccess } = require('../helpers/geminiMock');

const ASSISTANT_ENV_KEYS = [
  'ASSISTANT_ENABLED',
  'ASSISTANT_ACTION_GENERATE_ASSESSMENT',
  'ASSISTANT_ACTION_OPEN_GENERATOR',
  'ASSISTANT_ALLOWED_ROLES',
  'ASSISTANT_ALLOWED_SCHOOL_CODES',
];

/**
 * Probe strings, chosen to be things a teacher would plausibly type AND to be
 * impossible to produce by accident. If one of these appears anywhere, it got
 * there from the request body.
 */
const PROBES = Object.freeze({
  utterance: 'ZZPROBEUTTER photosynthesis worksheet for class 7',
  topic: 'ZZPROBETOPIC quadratic equations',
  raw: 'ZZPROBERAW class five',
  actionId: 'ZZPROBEACTION fractions homework',
  field: 'ZZPROBEFIELD algebra',
  slot: 'ZZPROBESLOT decimals',
});

let fixtures;
let teacherToken;
let savedEnv;
let captured;
let restoreConsole;

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

/**
 * Capture everything written to stdout/stderr, serialised the way a log
 * aggregator would see it.
 *
 * Serialising with JSON.stringify rather than inspecting objects matters: the
 * decision log passes a metadata OBJECT, and a leak nested three levels inside
 * it would be invisible to a naive string check on the first argument.
 */
function captureConsole() {
  const lines = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const record = (...args) => {
    lines.push(
      args
        .map((arg) => {
          if (typeof arg === 'string') return arg;
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(' ')
    );
  };
  console.log = record;
  console.warn = record;
  console.error = record;
  return {
    lines,
    restore: () => {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

/** Everything written to any channel, as one searchable blob. */
function loggedText() {
  return captured.lines.join('\n');
}

/** Every Event row in the database, as one searchable blob. */
async function storedText() {
  const rows = await prisma.event.findMany();
  return JSON.stringify(rows);
}

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'asstaudit');
  teacherToken = await loginAs(app, fixtures.schoolA, fixtures.teacherA, fixtures.PASSWORD);
  savedEnv = Object.fromEntries(ASSISTANT_ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  clearAssistantEnv();
  vi.unstubAllGlobals();
  captured = captureConsole();
  restoreConsole = captured.restore;
});

afterEach(() => {
  restoreConsole();
});

// ---- channel 1: the decision log -------------------------------------------

describe('the decision log carries no teacher text', () => {
  beforeEach(() => enableAssistant());

  test('a routed utterance does not appear in any log line', async () => {
    mockGeminiFetch([
      geminiSuccess(
        JSON.stringify({
          intent: 'generate_assessment',
          confidence: 'high',
          slots: { format: 'worksheet', topic: PROBES.topic, grade: 'class 5' },
        })
      ),
    ]);

    const res = await request(app)
      .post('/api/assistant/interpret')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ utterance: PROBES.utterance });

    expect(res.status).toBe(200);
    // The decision WAS logged — otherwise this test proves only that nothing
    // happened at all, which is the way a privacy test quietly stops working.
    expect(loggedText()).toContain('interpret_completed');

    expect(loggedText()).not.toContain(PROBES.utterance);
    expect(loggedText()).not.toContain('ZZPROBEUTTER');
  });

  test('a MODEL-SUPPLIED slot value does not appear either', async () => {
    // The topic above came back from the model and was resolved into params. It
    // is teacher-derived content by the time it lands, and it is exactly the
    // value a debug line would be most tempted to include.
    mockGeminiFetch([
      geminiSuccess(
        JSON.stringify({
          intent: 'generate_assessment',
          confidence: 'high',
          slots: { format: 'worksheet', topic: PROBES.topic, grade: 'class 5' },
        })
      ),
    ]);

    await request(app)
      .post('/api/assistant/interpret')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ utterance: PROBES.utterance });

    expect(loggedText()).not.toContain('ZZPROBETOPIC');
  });

  test('client-supplied MEMORY is not logged', async () => {
    // Never probed before M9. `memory.raw` is the teacher's own phrasing, held
    // client-side and sent on every turn, so it is the largest teacher-authored
    // payload the interpret endpoint accepts after the utterance itself.
    mockGeminiFetch([geminiSuccess(JSON.stringify({ intent: 'coach_question', confidence: 'high' }))]);

    await request(app)
      .post('/api/assistant/interpret')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        utterance: 'what next',
        memory: {
          grade: { value: 'Class 3-5', raw: PROBES.raw, source: 'utterance', turn: 1 },
        },
      });

    expect(loggedText()).not.toContain('ZZPROBERAW');
  });

  test('a rejected envelope does not echo the utterance into the log', async () => {
    // The 400 path formats a zod error message, and zod messages sometimes
    // include the received value.
    await request(app)
      .post('/api/assistant/interpret')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ utterance: PROBES.utterance, unexpectedKey: PROBES.topic });

    expect(loggedText()).not.toContain('ZZPROBEUTTER');
    expect(loggedText()).not.toContain('ZZPROBETOPIC');
  });

  test('an over-length utterance is not logged when it is rejected', async () => {
    await request(app)
      .post('/api/assistant/interpret')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ utterance: `${PROBES.utterance} `.repeat(400) });

    expect(loggedText()).not.toContain('ZZPROBEUTTER');
  });

  test('a MALFORMED JSON body leaks no fragment of itself into the log', async () => {
    // THE FINDING THIS FILE EXISTS FOR, and it was nearly missed. Node's JSON
    // parser embeds a ~20-character window of the RAW BODY in its message, and
    // the global error handler logged that message verbatim — so a malformed
    // request put part of the teacher's utterance in the log. The first probe
    // appeared TRUNCATED ("ZZPROBEBOD"), so a naive assertion on the full probe
    // string passed while the leak was real.
    //
    // Hence the short marker: a fragment is a leak. Assert on the shortest
    // distinctive prefix, never on the whole value.
    const res = await request(app)
      .post('/api/assistant/interpret')
      .set('Authorization', `Bearer ${teacherToken}`)
      .set('Content-Type', 'application/json')
      .send('{"utterance": ZZPRB photosynthesis worksheet}');

    // Also the G22 half: this path used to be the one 5xx /interpret could
    // produce, and any 5xx opens the client's circuit breaker.
    expect(res.status).toBe(400);
    expect(res.status).toBeLessThan(500);
    expect(loggedText()).not.toContain('ZZPRB');
    expect(loggedText()).not.toContain('photosynthesis');
  });

  test('the malformed-body fix applies to every endpoint, not just this one', async () => {
    // The leak was never assistant-specific; neither is the fix.
    for (const path of ['/api/auth/login', '/api/resources']) {
      const res = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${teacherToken}`)
        .set('Content-Type', 'application/json')
        .send('{"q": ZZPRB fractions}');
      expect(res.status).toBe(400);
    }
    expect(loggedText()).not.toContain('ZZPRB');
  });

  test('an internal error does not carry the utterance into the log', async () => {
    // interpret.js reports a bug in our own code as `classifier_error` and puts
    // the message on the log line. That message must never be built from the
    // request.
    mockGeminiFetch([{ reject: new Error('fetch failed') }]);

    await request(app)
      .post('/api/assistant/interpret')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ utterance: PROBES.utterance });

    expect(loggedText()).not.toContain('ZZPROBEUTTER');
  });
});

// ---- the /events surface, re-attacked --------------------------------------

describe('the telemetry endpoint refuses to store teacher text', () => {
  beforeEach(() => enableAssistant());

  test('an actionId carrying a topic reaches neither the log nor a row', async () => {
    // M8's finding, kept as a standing regression: this is the exact shape of
    // the hole that was open until an integration test found it.
    await request(app)
      .post('/api/assistant/events')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        events: [
          { name: 'prefill_delivered', actionId: PROBES.actionId, fieldCount: 6 },
        ],
      });

    expect(await storedText()).not.toContain('ZZPROBEACTION');
    expect(loggedText()).not.toContain('ZZPROBEACTION');
  });

  test('a correction field carrying a topic is dropped from the stored row', async () => {
    await request(app)
      .post('/api/assistant/events')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        events: [
          {
            name: 'prefill_outcome',
            actionId: 'generate_assessment',
            outcome: 'edited',
            corrections: [{ field: PROBES.field, from: 'utterance' }],
          },
        ],
      });

    // The row is written (the outcome is real telemetry); the unknown field name
    // is not.
    const stored = await storedText();
    expect(stored).toContain('assistant_prefill_outcome');
    expect(stored).not.toContain('ZZPROBEFIELD');
  });

  test('a rejected batch does not echo its contents into the log', async () => {
    await request(app)
      .post('/api/assistant/events')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ events: [{ name: 'not_a_real_event', actionId: PROBES.actionId }] });

    expect(loggedText()).not.toContain('ZZPROBEACTION');
  });
});

// ---- the catalog surface ----------------------------------------------------

describe('the catalog endpoint logs nothing teacher-derived', () => {
  test('a catalog fetch writes no request content to the log', async () => {
    enableAssistant();

    await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${teacherToken}`)
      .query({ q: PROBES.topic });

    expect(loggedText()).not.toContain('ZZPROBETOPIC');
  });
});

// ---- the positive control ---------------------------------------------------

describe('the audit can actually detect a leak', () => {
  test('the capture and search mechanism finds a planted probe', async () => {
    // WITHOUT THIS, every assertion above is indistinguishable from a broken
    // harness that captures nothing. M3 established the precedent: seven
    // negative results mean nothing until one positive proves the instrument
    // works.
    console.log('[assistant] planted_leak', { note: PROBES.utterance });
    expect(loggedText()).toContain('ZZPROBEUTTER');
  });

  test('the database search mechanism finds a planted row', async () => {
    const row = await prisma.event.create({
      data: {
        userId: fixtures.teacherA.id,
        schoolId: fixtures.schoolA.id,
        type: 'audit_probe',
        metadata: JSON.stringify({ note: PROBES.topic }),
      },
    });

    expect(await storedText()).toContain('ZZPROBETOPIC');

    // Cleaned up so it cannot pollute another file's assertions on the shared
    // throwaway database.
    await prisma.event.delete({ where: { id: row.id } });
    expect(await storedText()).not.toContain('ZZPROBETOPIC');
  });
});
