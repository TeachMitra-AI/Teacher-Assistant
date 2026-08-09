// Batched assessment generation (2026-08-07). Classroom Mode cost SEVEN Gemini
// calls per teacher question; the free tier allows 20/minute, so three
// questions throttled a teacher. Batching the four question-shaped artifacts
// into one call takes that to four.
//
// The behaviour these tests protect is PER-ARTIFACT handling. A naive batch
// throws the whole response away when one artifact is bad and regenerates all
// four — which can cost more than separate calls ever did.
const request = require('supertest');
const { app, prisma } = require('../helpers/testApp');
const { createFixtures, PASSWORD } = require('../helpers/fixtures');
const { loginAs } = require('../helpers/auth');
const { mockGeminiFetch, geminiSuccess } = require('../helpers/geminiMock');

describe('POST /api/resources/generate-set', () => {
  let fx;
  let token;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'generateset');
    token = await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD);
  });

  // mockGeminiFetch stubs the GLOBAL fetch. Without this the stub outlives the
  // suite and other test files in the same worker get this file's canned
  // Gemini responses instead of their own behaviour — which showed up as
  // unrelated auth/session tests failing with the wrong status, differently on
  // each run. Same cleanup test/routes/learningRepresentation.test.js does.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mcq(text) {
    return { type: 'mcq', text, options: ['3', '4', '5', '6'], correctOptionIndex: 1, correctAnswer: '' };
  }

  function doc(count, label) {
    return {
      instructions: 'Answer every question.',
      questions: Array.from({ length: count }, (_, i) => mcq(`${label} question ${i + 1}?`)),
    };
  }

  const ITEMS = [
    { format: 'worksheet', difficulty: 'medium', questionType: 'mcq', questionCount: 3 },
    { format: 'quiz', difficulty: 'medium', questionType: 'mcq', questionCount: 3 },
    { format: 'exit_ticket', difficulty: 'easy', questionType: 'mcq', questionCount: 3 },
  ];

  const body = (over = {}) => ({
    topic: 'Fractions', grade: 'Class 4', subject: 'Mathematics', items: ITEMS, ...over,
  });

  const post = (payload) =>
    request(app).post('/api/resources/generate-set').set('Authorization', `Bearer ${token}`).send(payload);

  test('requires authentication', async () => {
    const res = await request(app).post('/api/resources/generate-set').send(body());
    expect(res.status).toBe(401);
  });

  test('produces every artifact in ONE model call', async () => {
    const gemini = mockGeminiFetch([
      geminiSuccess(JSON.stringify({
        worksheet: doc(3, 'Worksheet'), quiz: doc(3, 'Quiz'), exit_ticket: doc(3, 'Exit'),
      })),
    ]);

    const res = await post(body());

    expect(res.status).toBe(200);
    expect(gemini.calls).toHaveLength(1); // the entire point
    expect(res.body.results).toHaveLength(3);
    for (const r of res.body.results) {
      expect(r.error).toBeNull();
      expect(r.content).toContain('## Questions');
    }
  });

  test('each artifact is rendered under its own title', async () => {
    mockGeminiFetch([
      geminiSuccess(JSON.stringify({
        worksheet: doc(3, 'W'), quiz: doc(3, 'Q'), exit_ticket: doc(3, 'E'),
      })),
    ]);

    const res = await post(body());
    const byFormat = Object.fromEntries(res.body.results.map((r) => [r.format, r.content]));
    expect(byFormat.worksheet).toContain('Worksheet: Fractions');
    expect(byFormat.quiz).toContain('Quiz: Fractions');
    expect(byFormat.exit_ticket).toContain('Exit Ticket: Fractions');
  });

  // THE test. One bad artifact must not cost the teacher the good ones, and the
  // retry must ask for ONLY the failed one — otherwise batching costs more than
  // separate calls when anything goes wrong.
  test('retries only the failed artifact, keeping the ones that worked', async () => {
    const gemini = mockGeminiFetch([
      geminiSuccess(JSON.stringify({
        worksheet: doc(3, 'W'),
        quiz: { instructions: 'x', questions: [] }, // wrong question count
        exit_ticket: doc(3, 'E'),
      })),
      geminiSuccess(JSON.stringify({ quiz: doc(3, 'Q') })),
    ]);

    const res = await post(body());

    expect(res.status).toBe(200);
    expect(gemini.calls).toHaveLength(2);

    // The second request must have asked for the quiz alone.
    const schemaKeys = Object.keys(gemini.calls[1].body.generationConfig.responseSchema.properties);
    expect(schemaKeys).toEqual(['quiz']);

    for (const r of res.body.results) expect(r.error).toBeNull();
  });

  test('a permanently broken artifact fails alone — the others still return', async () => {
    const broken = (formats) => {
      const out = {};
      for (const f of formats) out[f] = f === 'quiz' ? { instructions: 'x', questions: [] } : doc(3, f);
      return geminiSuccess(JSON.stringify(out));
    };
    mockGeminiFetch([
      broken(['worksheet', 'quiz', 'exit_ticket']),
      broken(['quiz']),
      broken(['quiz']),
    ]);

    const res = await post(body());

    expect(res.status).toBe(200);
    const byFormat = Object.fromEntries(res.body.results.map((r) => [r.format, r]));
    expect(byFormat.worksheet.content).toBeTruthy();
    expect(byFormat.exit_ticket.content).toBeTruthy();
    expect(byFormat.quiz.content).toBeNull();
    expect(byFormat.quiz.error).toBeTruthy();
  });

  test('fails as a whole only when nothing at all could be produced', async () => {
    mockGeminiFetch([
      geminiSuccess('{}'), geminiSuccess('{}'), geminiSuccess('{}'),
    ]);
    const res = await post(body());
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('INVALID_AI_RESPONSE');
  });

  test('the shared specification is stated once, not once per artifact', async () => {
    const gemini = mockGeminiFetch([
      geminiSuccess(JSON.stringify({
        worksheet: doc(3, 'W'), quiz: doc(3, 'Q'), exit_ticket: doc(3, 'E'),
      })),
    ]);

    await post(body());

    const prompt = gemini.calls[0].body.systemInstruction.parts.map((part) => part.text).join('');

    // The saving is structural: shared context appears once.
    expect(prompt.match(/Grade: Class 4/g)).toHaveLength(1);
    // But each artifact keeps its own purpose — the line that stops all three
    // reading like the same worksheet.
    expect(prompt).toContain('exit ticket');
    expect(prompt).toContain('worksheet');
  });

  test('rejects a duplicate format rather than generating it twice', async () => {
    const res = await post(body({ items: [ITEMS[0], ITEMS[0]] }));
    expect(res.status).toBe(400);
  });

  test('rejects an empty item list', async () => {
    expect((await post(body({ items: [] }))).status).toBe(400);
  });

  test('rejects a missing topic', async () => {
    expect((await post(body({ topic: '' }))).status).toBe(400);
  });

  test('rejects an unknown format', async () => {
    const bad = [{ format: 'debate', difficulty: 'easy', questionType: 'mcq', questionCount: 3 }];
    expect((await post(body({ items: bad }))).status).toBe(400);
  });
});
