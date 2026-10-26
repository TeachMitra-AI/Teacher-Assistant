// Coach fallback model through the real route: with GEMINI_FALLBACK_ENDPOINT set, a 5xx from the primary model is
// answered by the fallback instead of failing the teacher's request. gemini.reliability.test.js covers the service rules
// (what switches, budgets, deadline, generateContent never switching); this proves the wiring in src/index.js.
// No real model calls: every Gemini response is stubbed by helpers/geminiMock.
const request = require('supertest');
const { prisma } = require('../src/lib/db');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { mockGeminiFetch, geminiSuccess } = require('./helpers/geminiMock');

// A fake URL that can't reach the network and doesn't contain "flash-lite" (see classroomModeOn.test.js).
const FALLBACK = 'https://example.invalid/fallback-model:generateContent';

// GEMINI_FALLBACK_ENDPOINT is read once at module load, so turning it on means re-evaluating src/index.js (same
// cache-busting reload as classroomModeOn.test.js). Whatever the developer's server/.env holds is restored afterwards.
function reloadApp() {
  delete require.cache[require.resolve('../src/index')];
  return require('../src/index');
}
const ORIGINAL = process.env.GEMINI_FALLBACK_ENDPOINT;

describe('Coach fallback model — POST /api/coach', () => {
  let app;
  let fx;
  let token;

  beforeAll(async () => {
    process.env.GEMINI_FALLBACK_ENDPOINT = FALLBACK;
    app = reloadApp();
    fx = await createFixtures(prisma, 'coachfb');
    token = await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD);
  });

  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.GEMINI_FALLBACK_ENDPOINT;
    else process.env.GEMINI_FALLBACK_ENDPOINT = ORIGINAL;
    reloadApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const coach = (body) => request(app).post('/api/coach').set('Authorization', `Bearer ${token}`).send(body);
  const body = { query: 'Explain photosynthesis', context: {}, language: 'en' };

  test('a 503 from the primary model is answered by the fallback model', async () => {
    const logSpy = vi.spyOn(console, 'log');
    const { calls } = mockGeminiFetch([{ status: 503, text: 'unavailable' }, geminiSuccess('Plants make food from sunlight.')]);

    const res = await coach(body);

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('Plants make food from sunlight.');
    expect(calls).toHaveLength(2);
    expect(calls[0].url).not.toBe(FALLBACK);
    expect(calls[1].url).toBe(FALLBACK);
    // The coach_completed log records the switch as metadata only, never the URL.
    const completed = logSpy.mock.calls.find(([event]) => event === '[ai] coach_completed');
    expect(completed[1]).toMatchObject({ requestId: res.body.requestId, fallbackUsed: true });
    expect(JSON.stringify(completed[1])).not.toContain('example.invalid');
  });

  test('an unauthenticated request is still rejected before any model call', async () => {
    const { calls } = mockGeminiFetch([geminiSuccess('Should never be sent.')]);
    const res = await request(app).post('/api/coach').send(body);
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });
});
