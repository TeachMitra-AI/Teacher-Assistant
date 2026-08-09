// Classroom Mode ON, through the REAL route.
//
// The gap this closes: nothing anywhere sent `classroomMode: true` to
// /api/coach. `shouldSkipPlanning` had thorough unit tests
// (test/lib/classroomPlan.test.js) and the mode-OFF path had route tests
// (test/classroomModeOff.test.js), but the wiring BETWEEN them — that the route
// actually consults the gates, actually honours the server flag, and actually
// declines to spend a model call — was covered only by reading the code.
//
// The emergency case below is the one that matters most. A teacher describing a
// child who has collapsed must not have worksheets generated underneath the
// safety guidance, and "the unit test says detectEmergency works" is not the
// same claim as "the route refuses to plan". This asserts the second.
//
// No real model calls: every Gemini response is stubbed by helpers/geminiMock,
// and the call COUNT is the assertion in most cases.
const path = require('path');
const request = require('supertest');
const { prisma } = require('../src/lib/db');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { toFetchResponse, geminiSuccess } = require('./helpers/geminiMock');

// A mock that routes by ENDPOINT rather than by call order.
//
// mockGeminiFetch's ordered queue cannot express this route: the answer and the
// planner are issued IN PARALLEL (that is the whole point of D7), so whichever
// call the event loop reaches first takes the first queued response. Worse, the
// coach's generateResponse may retry or continue, so the call count is not
// fixed either. An ordered queue therefore hands the planner's JSON to the
// answer at random — which is a bug in the test, not the route.
//
// Routing on the URL is stable because the planner runs on `geminiFast`
// (flash-lite, D19) while the answer runs on the coaching model. It also gives
// a directly meaningful assertion: `calls.planner === 0` IS the claim "no model
// call was spent deciding", which is what the gates are for.
function mockRouted({ answer, planner }) {
  const calls = { answer: 0, planner: 0, all: [] };
  const mock = vi.fn(async (url, opts) => {
    const isPlanner = String(url).includes('flash-lite');
    calls.all.push({ url: String(url), isPlanner });
    if (isPlanner) {
      calls.planner += 1;
      return toFetchResponse(planner ?? geminiSuccess('{}'));
    }
    calls.answer += 1;
    return toFetchResponse(answer);
  });
  vi.stubGlobal('fetch', mock);
  return calls;
}

// Same cache-busting reload as cors.test.js: CLASSROOM_MODE_ENABLED is read
// ONCE at module load into `classroomModeFlagsAtBoot`, so a test that needs the
// flag on has to re-evaluate src/index.js with it set. See that file's comment
// for why require.cache and not vi.resetModules.
function reloadApp() {
  delete require.cache[require.resolve('../src/index')];
  return require('../src/index');
}

// Whatever the developer happens to have in server/.env, captured before any
// test touches it, and restored at the end.
//
// This matters more than it looks. `delete process.env.CLASSROOM_MODE_ENABLED`
// does NOT give you "flag off": src/index.js calls dotenv.config() on every
// reload, which repopulates the variable straight back out of server/.env. A
// test written that way asserts the developer's local .env, not the code — it
// passed while .env said `false` and failed the moment someone set it `true`
// to try the feature. Both states below are therefore set EXPLICITLY.
const ORIGINAL_FLAG = process.env.CLASSROOM_MODE_ENABLED;

function restoreOriginalFlag() {
  if (ORIGINAL_FLAG === undefined) delete process.env.CLASSROOM_MODE_ENABLED;
  else process.env.CLASSROOM_MODE_ENABLED = ORIGINAL_FLAG;
}

const ANSWER = 'Start with a chapati cut into four equal parts.';
const PLAN_JSON = JSON.stringify({
  topic: 'Fractions',
  grade: 'Class 4',
  subject: 'Maths',
  artifacts: ['lesson_plan', 'worksheet', 'quiz', 'homework', 'exit_ticket'],
});

describe('Classroom Mode ON — the route honours every gate', () => {
  let app;
  let fx;
  let token;

  beforeAll(async () => {
    process.env.CLASSROOM_MODE_ENABLED = 'true';
    app = reloadApp();
    fx = await createFixtures(prisma, 'cmon');
    token = await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD);
  });

  afterAll(() => {
    // Leave the process as this file found it, and rebuild the app from it.
    restoreOriginalFlag();
    reloadApp();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.event.deleteMany({ where: { userId: fx.teacherA.id } });
  });

  const ask = (body) =>
    request(app).post('/api/coach').set('Authorization', `Bearer ${token}`).send(body);

  const base = { query: 'How do I teach fractions to Class 4?', language: 'en', context: {}, classroomMode: true };

  describe('the happy path', () => {
    test('a teachable question comes back with a plan', async () => {
      mockRouted({ answer: geminiSuccess(ANSWER), planner: geminiSuccess(PLAN_JSON) });
      const res = await ask(base);

      expect(res.status).toBe(200);
      expect(res.body.classroomMode).toBe(true);
      expect(res.body.classroom).toBeTruthy();
      expect(res.body.classroom.topic).toBe('Fractions');
      expect(res.body.classroom.artifacts).toContain('worksheet');
    });

    test('the grade the model returned is canonicalized, not passed through raw', async () => {
      mockRouted({ answer: geminiSuccess(ANSWER), planner: geminiSuccess(PLAN_JSON) });
      const res = await ask(base);
      // "Class 4" is not one of the app's grade bands; "Class 3-5" is.
      expect(res.body.classroom.grade).toBe('Class 3-5');
      expect(res.body.classroom.subject).toBe('Mathematics');
    });

    test("the teacher's own grade choice beats the model's (D8)", async () => {
      mockRouted({ answer: geminiSuccess(ANSWER), planner: geminiSuccess(PLAN_JSON) });
      const res = await ask({ ...base, context: { grade: 'Class 9-10', subject: 'Science' } });
      expect(res.body.classroom.grade).toBe('Class 9-10');
      expect(res.body.classroom.subject).toBe('Science');
    });

    test('the answer is still returned normally alongside the plan', async () => {
      mockRouted({ answer: geminiSuccess(ANSWER), planner: geminiSuccess(PLAN_JSON) });
      const res = await ask(base);
      expect(res.body.success).toBe(true);
      expect(res.body.text).toContain('chapati');
    });
  });

  // ─── GATE 1: the one that must never fail ────────────────────────────────
  describe('an active emergency', () => {
    const EMERGENCIES = [
      'A student collapsed and is not breathing',
      'One of my students is having a seizure',
      'A student has a knife in my classroom',
    ];

    test.each(EMERGENCIES)('produces NO classroom materials: %s', async (query) => {
      mockRouted({ answer: geminiSuccess('Follow your school emergency protocol immediately.') });
      const res = await ask({ ...base, query });

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('classroom');
    });

    // Not merely "no materials" — no model call is spent deciding. The gate
    // runs before the planner is ever reached.
    test('does not spend a planner call', async () => {
      const gemini = mockRouted({ answer: geminiSuccess('Follow your school emergency protocol immediately.') });
      await ask({ ...base, query: 'A student collapsed and is not breathing' });
      expect(gemini.planner).toBe(0);
    });

    // The inverse, and the reason detectEmergency has TEACHING_ABOUT_PATTERN:
    // teaching ABOUT an emergency topic is an ordinary lesson request.
    test('teaching ABOUT an emergency topic is NOT gated', async () => {
      mockRouted({ answer: geminiSuccess(ANSWER), planner: geminiSuccess(PLAN_JSON) });
      const res = await ask({ ...base, query: 'How do I teach first aid to Class 6?' });
      expect(res.body.classroom).toBeTruthy();
    });
  });

  // ─── GATE 2: the free shortcut ───────────────────────────────────────────
  describe('Focus = Classroom Management', () => {
    test('produces no materials and spends no planner call', async () => {
      const gemini = mockRouted({ answer: geminiSuccess('Try a seating change.') });
      const res = await ask({
        ...base,
        query: 'My students keep talking',
        context: { issueType: 'Classroom Management' },
      });

      expect(res.body).not.toHaveProperty('classroom');
      expect(gemini.planner).toBe(0);
    });

    test('any other Focus value still consults the planner', async () => {
      const gemini = mockRouted({ answer: geminiSuccess(ANSWER), planner: geminiSuccess(PLAN_JSON) });
      await ask({ ...base, context: { issueType: 'Concept Explanation' } });
      expect(gemini.planner).toBe(1);
    });
  });

  // ─── The planner declining, and failing ──────────────────────────────────
  describe('when there is nothing to make', () => {
    test('no teachable topic ⇒ classroomMode true but no classroom key', async () => {
      mockRouted({
        answer: geminiSuccess('Try a seating change.'),
        planner: geminiSuccess(JSON.stringify({ topic: '', artifacts: [] })),
      });
      const res = await ask({ ...base, query: 'My students keep talking in class' });

      // Both facts matter: the mode RAN (so the client can explain itself), and
      // there is nothing to offer.
      expect(res.body.classroomMode).toBe(true);
      expect(res.body).not.toHaveProperty('classroom');
    });

    test('a planner returning junk never breaks the answer', async () => {
      mockRouted({ answer: geminiSuccess(ANSWER), planner: geminiSuccess('not json at all') });
      const res = await ask(base);

      expect(res.status).toBe(200);
      expect(res.body.text).toContain('chapati');
      expect(res.body).not.toHaveProperty('classroom');
    });
  });
});

// ─── The server flag is the real kill switch (D13) ─────────────────────────
describe('Classroom Mode ON in the client, OFF on the server', () => {
  let app;
  let fx;
  let token;

  beforeAll(async () => {
    process.env.CLASSROOM_MODE_ENABLED = 'false'; // explicit — see ORIGINAL_FLAG
    app = reloadApp();
    fx = await createFixtures(prisma, 'cmkill');
    token = await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD);
  });

  // The whole point of the server flag: a PWA can serve a cached client whose
  // own flag is stale by hours, and it will keep asking. The server must refuse
  // regardless of what it is asked for.
  test('a client asking for Classroom Mode is ignored entirely', async () => {
    const gemini = mockRouted({ answer: geminiSuccess(ANSWER) });
    const res = await request(app)
      .post('/api/coach')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'How do I teach fractions to Class 4?', language: 'en', context: {}, classroomMode: true });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('classroom');
    expect(res.body).not.toHaveProperty('classroomMode');
    expect(gemini.planner).toBe(0); // nothing was spent deciding
  });

  afterAll(() => {
    restoreOriginalFlag();
    reloadApp();
  });
});
