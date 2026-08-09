// Classroom Mode OFF must be byte-for-byte the behaviour that shipped before
// the feature existed (docs/classroom-mode.md §7 rule 3 — "the acceptance test
// for every phase").
//
// The doc named this as the acceptance test from P0 but nothing enforced it at
// the route level until now. It matters more after batching and the maths
// notation change (D22/D23) than it did before: those touched code the ORDINARY
// coach path and the ordinary Generator also run through.
//
// What "unchanged" means concretely, and what each test below pins:
//   - no `classroom` key and no `classroomMode` key in the response
//   - no planner call — the mode costs nothing when off
//   - no telemetry row — a teacher who never touches the feature leaves no trace
//   - the answer itself is identical
const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { mockGeminiFetch, geminiSuccess } = require('./helpers/geminiMock');

describe('Classroom Mode OFF — the ordinary coach path is untouched', () => {
  let fx;
  let token;
  let otherToken;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'cmoff');
    token = await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD);
    otherToken = await loginAs(app, fx.schoolB, fx.teacherB, PASSWORD);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.event.deleteMany({ where: { userId: fx.teacherA.id } });
  });

  const ANSWER = 'Start with concrete objects, then move to symbols.';

  const ask = (body) =>
    request(app).post('/api/coach').set('Authorization', `Bearer ${token}`).send(body);

  const base = { query: 'How do I teach fractions to Class 4?', language: 'en', context: {} };

  test('the response carries no classroom keys at all', async () => {
    mockGeminiFetch([geminiSuccess(ANSWER)]);
    const res = await ask(base);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body).not.toHaveProperty('classroom');
    expect(res.body).not.toHaveProperty('classroomMode');
  });

  // The whole cost argument for the feature rests on this: mode off must not
  // spend a model call on planning.
  test('makes exactly ONE model call — no planner', async () => {
    const gemini = mockGeminiFetch([geminiSuccess(ANSWER)]);
    await ask(base);
    expect(gemini.calls).toHaveLength(1);
  });

  test('writes no Classroom Mode telemetry', async () => {
    mockGeminiFetch([geminiSuccess(ANSWER)]);
    await ask(base);

    const events = await prisma.event.findMany({
      where: { userId: fx.teacherA.id, type: { startsWith: 'classroom_' } },
    });
    expect(events).toHaveLength(0);
  });

  // `classroomMode === true` is an exact check. A truthy-but-not-true value is
  // a client bug or a probe, and must not buy a model call.
  test.each([
    ['absent', {}],
    ['false', { classroomMode: false }],
    ['the string "true"', { classroomMode: 'true' }],
    ['1', { classroomMode: 1 }],
    ['null', { classroomMode: null }],
  ])('%s does not turn the mode on', async (_label, extra) => {
    const gemini = mockGeminiFetch([geminiSuccess(ANSWER)]);
    const res = await ask({ ...base, ...extra });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('classroom');
    expect(res.body).not.toHaveProperty('classroomMode');
    expect(gemini.calls).toHaveLength(1); // no planner call
  });

  test('the answer itself is returned unchanged', async () => {
    mockGeminiFetch([geminiSuccess(ANSWER)]);
    const res = await ask(base);
    expect(res.body.text).toContain('concrete objects');
  });

  // The strongest form of "unchanged": the exact key set. Any future work that
  // leaks a Classroom Mode concept into the ordinary response fails here, not
  // in a teacher's browser.
  test('the response key set contains nothing classroom-related', async () => {
    mockGeminiFetch([geminiSuccess(ANSWER)]);
    const res = await ask(base);

    const classroomish = Object.keys(res.body).filter((k) => /classroom/i.test(k));
    expect(classroomish).toEqual([]);
  });

// --- Plan persistence (D24) ---------------------------------------------------
// Reopening a chat used to show the answer with the artifact cards gone: the
// plan lived only in React state and the Query row had nowhere to put it. The
// plan is now persisted so the cards come back — but restored cards generate
// NOTHING until the teacher asks, which is enforced client-side.
describe('Classroom Mode plan persistence', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.query.deleteMany({ where: { userId: fx.teacherA.id } });
  });

  // The ordinary path must not gain a column value — §7 rule 3.
  test('an ordinary question leaves classroomPlan NULL', async () => {
    mockGeminiFetch([geminiSuccess('An ordinary answer.')]);
    await request(app)
      .post('/api/coach')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'How do I teach fractions?', language: 'en', context: {} });

    const row = await prisma.query.findFirst({ where: { userId: fx.teacherA.id } });
    expect(row).toBeTruthy();
    expect(row.classroomPlan).toBeNull();
  });

  test('history omits the classroom key entirely for an ordinary question', async () => {
    mockGeminiFetch([geminiSuccess('An ordinary answer.')]);
    await request(app)
      .post('/api/coach')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'How do I teach fractions?', language: 'en', context: {} });

    const res = await request(app).get('/api/queries?limit=5').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.queries[0]).not.toHaveProperty('classroom');
  });

  // The round trip the feature exists for.
  test('a stored plan comes back through the history endpoint', async () => {
    const plan = {
      topic: 'Trigonometric ratios',
      grade: 'Class 9-10',
      subject: 'Mathematics',
      language: 'en',
      artifacts: ['lesson_plan', 'worksheet', 'quiz'],
    };
    await prisma.query.create({
      data: {
        userId: fx.teacherA.id,
        schoolId: fx.teacherA.schoolId,
        queryText: 'How do I teach trigonometric ratios?',
        language: 'en',
        responseText: 'Start with a right triangle.',
        classroomPlan: JSON.stringify(plan),
      },
    });

    const res = await request(app).get('/api/queries?limit=5').set('Authorization', `Bearer ${token}`);
    const item = res.body.queries.find((q) => q.query.includes('trigonometric'));
    expect(item.classroom).toEqual(plan);
  });

  test('a corrupt stored plan does not break the history list', async () => {
    await prisma.query.create({
      data: {
        userId: fx.teacherA.id,
        schoolId: fx.teacherA.schoolId,
        queryText: 'Broken plan row',
        language: 'en',
        responseText: 'Answer.',
        classroomPlan: '{not valid json',
      },
    });

    const res = await request(app).get('/api/queries?limit=5').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.queries.length).toBeGreaterThan(0);
  });
});

// --- Artifact persistence (D25) -----------------------------------------------
// Overturns D11 for the chat turn: reopening a chat now shows what was already
// generated instead of offering to spend four model calls rebuilding it.
describe('Classroom Mode artifact persistence', () => {
  let queryId;

  beforeEach(async () => {
    const row = await prisma.query.create({
      data: {
        userId: fx.teacherA.id,
        schoolId: fx.teacherA.schoolId,
        queryText: 'How do I teach trigonometric ratios?',
        language: 'en',
        responseText: 'Start with a right triangle.',
      },
    });
    queryId = row.id;
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.query.deleteMany({ where: { userId: fx.teacherA.id } });
  });

  const url = () => `/api/queries/${queryId}/classroom-artifacts`;
  const ARTIFACTS = { worksheet: '# Worksheet\n\n1. What is sin 30?', quiz: '# Quiz\n\n1. Define cosine.' };

  test('round-trips what was generated', async () => {
    const put = await request(app).put(url()).set('Authorization', `Bearer ${token}`).send({ artifacts: ARTIFACTS });
    expect(put.status).toBe(200);

    const get = await request(app).get(url()).set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.artifacts).toEqual(ARTIFACTS);
  });

  test('a turn with nothing stored returns an empty map, not an error', async () => {
    const res = await request(app).get(url()).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.artifacts).toEqual({});
  });

  test('a later write replaces rather than merges', async () => {
    await request(app).put(url()).set('Authorization', `Bearer ${token}`).send({ artifacts: ARTIFACTS });
    await request(app).put(url()).set('Authorization', `Bearer ${token}`).send({ artifacts: { quiz: '# New quiz' } });

    const get = await request(app).get(url()).set('Authorization', `Bearer ${token}`);
    expect(get.body.artifacts).toEqual({ quiz: '# New quiz' });
  });

  // Ownership: same 404 for "missing" and "not yours" so one teacher cannot
  // probe for another's history.
  test('another teacher cannot read or write them', async () => {
    await request(app).put(url()).set('Authorization', `Bearer ${token}`).send({ artifacts: ARTIFACTS });

    expect((await request(app).get(url()).set('Authorization', `Bearer ${otherToken}`)).status).toBe(404);
    expect(
      (await request(app).put(url()).set('Authorization', `Bearer ${otherToken}`).send({ artifacts: { quiz: 'x' } })).status
    ).toBe(404);
  });

  test('requires authentication', async () => {
    expect((await request(app).get(url())).status).toBe(401);
    expect((await request(app).put(url()).send({ artifacts: ARTIFACTS })).status).toBe(401);
  });

  test('an unknown turn is a 404, not a 500', async () => {
    const res = await request(app).get('/api/queries/does-not-exist/classroom-artifacts').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  // Sized to pass the 64kb body parser but trip this route's own 60000-byte
  // cap, so it tests OUR bound rather than express's. Anything larger is
  // rejected earlier by the parser, which is fine but is not this assertion.
  test('rejects a payload too large to sit on a row other queries read', async () => {
    const oversized = { worksheet: 'x'.repeat(61000) };
    const res = await request(app).put(url()).set('Authorization', `Bearer ${token}`).send({ artifacts: oversized });
    expect(res.status).toBe(413);
  });

  // A realistic full set must fit comfortably — this is the case that would
  // have silently failed on the old 16kb limit for /api/queries.
  test('a realistic five-artifact set (about 25KB) is stored fine', async () => {
    const realistic = {
      lesson_plan: 'L'.repeat(6000),
      worksheet: 'W'.repeat(5000),
      quiz: 'Q'.repeat(5000),
      homework: 'H'.repeat(4000),
      exit_ticket: 'E'.repeat(2000),
    };
    const put = await request(app).put(url()).set('Authorization', `Bearer ${token}`).send({ artifacts: realistic });
    expect(put.status).toBe(200);

    const get = await request(app).get(url()).set('Authorization', `Bearer ${token}`);
    expect(Object.keys(get.body.artifacts)).toHaveLength(5);
    expect(get.body.artifacts.lesson_plan).toHaveLength(6000);
  });

  test('rejects a malformed payload', async () => {
    const res = await request(app).put(url()).set('Authorization', `Bearer ${token}`).send({ artifacts: 'not an object' });
    expect(res.status).toBe(400);
  });

  // THE performance guard. classroomArtifacts holds up to five full documents;
  // a 20-row history that selected it would move hundreds of KB to render a
  // sidebar that shows none of it.
  test('the history LIST never carries the artifacts blob', async () => {
    await request(app).put(url()).set('Authorization', `Bearer ${token}`).send({ artifacts: ARTIFACTS });

    const res = await request(app).get('/api/queries?limit=20').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('classroomArtifacts');
    expect(serialized).not.toContain('What is sin 30');
  });
});
});
