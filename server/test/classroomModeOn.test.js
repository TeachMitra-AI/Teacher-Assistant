// Classroom Mode ON, through the real route. Nothing else sent `classroomMode: true` to /api/coach: shouldSkipPlanning
// has unit tests (test/lib/classroomPlan.test.js) and the OFF path has route tests, but the wiring between them (the
// route consults the gates, honours the server flag, and declines to spend a model call) was covered only by reading code.
// The emergency case matters most: a teacher describing a collapsed child must not have worksheets generated beneath
// the safety guidance, and "detectEmergency works" isn't the claim "the route refuses to plan".
// No real model calls: every Gemini response is stubbed by helpers/geminiMock, and the call count is the assertion in most cases.
const path = require('path');
const request = require('supertest');
const { prisma } = require('../src/lib/db');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { toFetchResponse, geminiSuccess } = require('./helpers/geminiMock');

// A mock that routes by endpoint, not call order. mockGeminiFetch's ordered queue can't express this route: the answer
// and planner run in parallel, so whichever call the event loop reaches first takes the first queued response, and
// generateResponse may retry or continue so the count isn't fixed. Routing on the URL is stable since the planner
// runs on `geminiFast` (flash-lite) and the answer on the coaching model, and `calls.planner === 0` is the claim "no
// model call was spent deciding".
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

// Same cache-busting reload as cors.test.js: CLASSROOM_MODE_ENABLED is read once at module load into
// `classroomModeFlagsAtBoot`, so turning it on means re-evaluating src/index.js. See that file for why require.cache and not vi.resetModules.
function reloadApp() {
  delete require.cache[require.resolve('../src/index')];
  return require('../src/index');
}

// Whatever is in the developer's server/.env, captured before any test touches it and restored at the end. `delete
// process.env.CLASSROOM_MODE_ENABLED` doesn't give "flag off": src/index.js calls dotenv.config() on every reload,
// which repopulates it from server/.env, so such a test asserted the local .env and failed once someone set it `true`.
// Both states are therefore set explicitly.
const ORIGINAL_FLAG = process.env.CLASSROOM_MODE_ENABLED;

function restoreOriginalFlag() {
  if (ORIGINAL_FLAG === undefined) delete process.env.CLASSROOM_MODE_ENABLED;
  else process.env.CLASSROOM_MODE_ENABLED = ORIGINAL_FLAG;
}

const ANSWER = 'Start with a chapati cut into four equal parts.';
const PLAN_JSON = JSON.stringify({
  topic: 'Fractions',
  grade: 'fourth class',
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
      // "fourth class" is not one of the app's grades; "Class 4" is.
      expect(res.body.classroom.grade).toBe('Class 4');
      expect(res.body.classroom.subject).toBe('Mathematics');
    });

    test("the teacher's own grade choice beats the model's (D8)", async () => {
      mockRouted({ answer: geminiSuccess(ANSWER), planner: geminiSuccess(PLAN_JSON) });
      const res = await ask({ ...base, context: { grade: 'Class 9', subject: 'Science' } });
      expect(res.body.classroom.grade).toBe('Class 9');
      expect(res.body.classroom.subject).toBe('Science');
    });

    test('the answer is still returned normally alongside the plan', async () => {
      mockRouted({ answer: geminiSuccess(ANSWER), planner: geminiSuccess(PLAN_JSON) });
      const res = await ask(base);
      expect(res.body.success).toBe(true);
      expect(res.body.text).toContain('chapati');
    });
  });

  // Gate 1: an active emergency, which must never fail
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

  // Gate 2: the free shortcut
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

  // The planner declining, and failing
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

// The server flag is the real kill switch
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

  // A PWA can serve a cached client whose own flag is hours stale and keep asking; the server must refuse regardless.
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
