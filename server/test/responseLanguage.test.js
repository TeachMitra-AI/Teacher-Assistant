// End-to-end verification of the response-language fix
// (docs/response-language-fix.md).
//
// WHY THIS FILE EXISTS SEPARATELY from test/prompts.test.js: that file tests
// languageDirective() in isolation — the right sentence is produced. This file
// tests the thing that was actually broken, which is whether that sentence
// REACHES the model on every path. The bug was never a wrong directive; it was
// a directive that silently evaluated to '' and got appended as nothing.
//
// So these drive the REAL routes and the REAL GeminiService, with only the
// outbound `fetch` stubbed, and then read the systemInstruction out of the
// captured request body — exactly the bytes Gemini would have received.
//
// No live model calls: the free tier allows 20 requests/minute, and a suite
// that spent real quota could not be run on every change.
const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { mockGeminiFetch, geminiSuccess } = require('./helpers/geminiMock');
const { buildLessonPlanPrompt } = require('../src/lib/lessonPlanPrompt');

/** The systemInstruction actually sent on the Nth captured call. */
const instructionOf = (calls, index = 0) =>
  calls[index].body.systemInstruction.parts.map((p) => p.text).join('');

const mcq = (text, correct) => ({
  type: 'mcq',
  text,
  options: ['A', 'B', 'C', 'D'],
  correctOptionIndex: correct,
  correctAnswer: '',
});

const assessmentJson = (count = 2) =>
  geminiSuccess(
    JSON.stringify({
      instructions: 'Answer all questions.',
      questions: Array.from({ length: count }, (_, i) => mcq(`Question ${i + 1}?`, 0)),
    })
  );

describe('response language — the directive reaches the model on every path', () => {
  let fx;
  let token;

  beforeAll(async () => {
    // Lowercase prefix on purpose: it becomes the fixture emails verbatim,
    // and the login route lowercases what it receives — a camelCase prefix
    // silently fails every login with "Incorrect email or password."
    fx = await createFixtures(prisma, 'resplang');
    token = await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await prisma.resource.deleteMany({ where: { userId: fx.teacherA.id } });
  });

  const auth = (req) => req.set('Authorization', `Bearer ${token}`);

  // -------------------------------------------------------------------------
  // 1 + 2. Coach chat — the reported bug, and its continuation step.
  // -------------------------------------------------------------------------
  describe('coach chat — POST /api/coach', () => {
    // THE BUG. Before the fix this instruction contained no language sentence
    // at all, and the model answered in whatever language the question used.
    test('English gets an explicit English directive (previously: nothing)', async () => {
      const { calls } = mockGeminiFetch([geminiSuccess('An answer.')]);
      const res = await auth(request(app).post('/api/coach')).send({
        query: 'मैं कक्षा 3 को भिन्न कैसे सिखाऊँ?', // a Hindi question…
        context: {},
        language: 'en', // …with English selected
      });

      expect(res.status).toBe(200);
      const instruction = instructionOf(calls);
      expect(instruction).toContain('Write your ENTIRE response in English');
      expect(instruction).toContain('reply in English regardless');
    });

    test('Hindi gets a Hindi directive, including the headings clause', async () => {
      const { calls } = mockGeminiFetch([geminiSuccess('एक उत्तर।')]);
      await auth(request(app).post('/api/coach')).send({
        query: 'How do I teach fractions?',
        context: {},
        language: 'hi',
      });

      const instruction = instructionOf(calls);
      expect(instruction).toContain('हिंदी');
      expect(instruction).toContain('every heading and section title');
      expect(instruction).toContain('Do NOT leave the headings in English');
    });

    test('every supported language reaches the model with its own directive', async () => {
      for (const [language, name] of [
        ['bn', 'বাংলা'], ['te', 'తెలుగు'], ['mr', 'मराठी'], ['ta', 'தமிழ்'],
        ['gu', 'ગુજરાતી'], ['kn', 'ಕನ್ನಡ'], ['or', 'ଓଡ଼ିଆ'], ['hinglish', 'Hinglish'],
      ]) {
        const { calls } = mockGeminiFetch([geminiSuccess('Answer.')]);
        await auth(request(app).post('/api/coach')).send({ query: 'A question', context: {}, language });
        expect(instructionOf(calls)).toContain(name);
        vi.unstubAllGlobals();
      }
    });

    // Long Indic answers routinely need a continuation, and that is the point
    // where a response used to drift back into English.
    test('the continuation request restates the language', async () => {
      const { calls } = mockGeminiFetch([
        geminiSuccess('पहला भाग', 'MAX_TOKENS'),
        geminiSuccess(' दूसरा भाग', 'STOP'),
      ]);
      await auth(request(app).post('/api/coach')).send({
        query: 'A long question',
        context: {},
        language: 'hi',
      });

      expect(calls.length).toBeGreaterThan(1);
      const continuation = instructionOf(calls, 1);
      expect(continuation).toContain('CONTINUATION TASK');
      expect(continuation).toContain('हिंदी');
    });

    test('the teacher-override clause travels with it', async () => {
      const { calls } = mockGeminiFetch([geminiSuccess('Answer.')]);
      await auth(request(app).post('/api/coach')).send({ query: 'Q', context: {}, language: 'hi' });
      expect(instructionOf(calls)).toContain('follow what they asked for instead');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Worksheet / quiz generation — the STRUCTURED variant.
  //
  // The risk here is the opposite one: over-translating. "mcq" and
  // "True"/"False" are contract values the validator compares by exact string,
  // so a translated one fails validation and the teacher sees an error instead
  // of a worksheet.
  // -------------------------------------------------------------------------
  describe('worksheet generation — POST /api/resources/generate', () => {
    const config = {
      format: 'quiz',
      grade: 'Class 6-8',
      subject: 'Mathematics',
      topic: 'Trigonometry',
      difficulty: 'medium',
      questionType: 'mcq',
      questionCount: 3, // MIN_QUESTIONS — anything lower is a 400
    };

    test('uses the structured directive, protecting field names and fixed values', async () => {
      const { calls } = mockGeminiFetch([assessmentJson(3)]);
      const res = await auth(request(app).post('/api/resources/generate')).send({ ...config, language: 'bn' });

      expect(res.status).toBe(200);
      const instruction = instructionOf(calls);
      expect(instruction).toContain('বাংলা');
      expect(instruction).toContain('JSON field names');
      expect(instruction).toContain('stay exactly as specified in English');
      // The prose clause must NOT be here — translating the schema's own
      // headings is precisely what would break the printed page.
      expect(instruction).not.toContain('every heading and section title');
    });

    test('English generation is instructed too, not left silent', async () => {
      const { calls } = mockGeminiFetch([assessmentJson(3)]);
      const res = await auth(request(app).post('/api/resources/generate')).send({ ...config, language: 'en' });
      expect(res.status).toBe(200);
      expect(instructionOf(calls)).toContain('Write all the text content you return in English');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Revising a saved document — the PROSE variant, because this action
  // returns a whole Markdown document whose headings are the model's to write.
  // -------------------------------------------------------------------------
  describe('revising a saved document — POST /api/resources/:id/ai-action', () => {
    test('uses the prose directive in the resource\'s own language', async () => {
      const created = await auth(request(app).post('/api/resources')).send({
        type: 'lesson_plan',
        title: 'Fractions',
        content: 'Original body',
        language: 'hi',
      });
      expect(created.status).toBe(201);

      const { calls } = mockGeminiFetch([geminiSuccess('# आसान संस्करण')]);
      const res = await auth(
        request(app).post(`/api/resources/${created.body.resource.id}/ai-action`)
      ).send({ action: 'simplify' });

      expect(res.status).toBe(200);
      const instruction = instructionOf(calls);
      expect(instruction).toContain('हिंदी');
      expect(instruction).toContain('every heading and section title');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Lesson plans — structured, and the file that used to carry its own
  // duplicate copy of the buggy helper.
  // -------------------------------------------------------------------------
  describe('lesson plans', () => {
    test('use the shared structured directive, not a private copy', () => {
      const { systemInstruction } = buildLessonPlanPrompt({
        topic: 'Photosynthesis',
        grade: 'Class 6',
        subject: 'Science',
        language: 'ta',
        duration: '40 minutes',
        classroomType: 'standard',
        instructions: '',
      });

      expect(systemInstruction).toContain('தமிழ்');
      expect(systemInstruction).toContain('JSON field names');
      expect(systemInstruction).toContain('follow what they asked for instead');
    });

    test('English lesson plans are instructed too', () => {
      const { systemInstruction } = buildLessonPlanPrompt({
        topic: 'Photosynthesis',
        grade: 'Class 6',
        subject: 'Science',
        language: 'en',
        duration: '40 minutes',
        classroomType: 'standard',
        instructions: '',
      });
      expect(systemInstruction).toContain('Write all the text content you return in English');
    });
  });

  // -------------------------------------------------------------------------
  // The regression guard that matters most: NO path may send a prompt with no
  // language instruction in it. That silent '' is the whole bug.
  // -------------------------------------------------------------------------
  test('no path sends a prompt without a language instruction', async () => {
    const { calls } = mockGeminiFetch([geminiSuccess('Answer.')]);
    await auth(request(app).post('/api/coach')).send({ query: 'Q', context: {}, language: 'en' });

    for (const call of calls) {
      const instruction = call.body.systemInstruction.parts.map((p) => p.text).join('');
      expect(instruction).toMatch(/Write (your ENTIRE response|all the text content you return) in /);
    }
  });
});
