// POST /api/support/tickets, end to end. Mirrors attachments.test.js's
// approach to flag manipulation: env vars are read per-request by the route,
// so tests drive the single shared app instance by flipping process.env
// between tests rather than rebuilding the app.
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

const SUPPORT_ENV_KEYS = ['HELP_SUPPORT_ENABLED', 'HELP_SUPPORT_ALLOWED_SCHOOL_CODES'];

let fixtures;
let teacherToken;
let savedEnv;

function enableHelpSupport(overrides = {}) {
  process.env.HELP_SUPPORT_ENABLED = 'true';
  delete process.env.HELP_SUPPORT_ALLOWED_SCHOOL_CODES;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearSupportEnv() {
  for (const key of SUPPORT_ENV_KEYS) delete process.env[key];
}

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'support');
  teacherToken = await loginAs(app, fixtures.schoolA, fixtures.teacherA, fixtures.PASSWORD);
  savedEnv = Object.fromEntries(SUPPORT_ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  clearSupportEnv();
});

describe('POST /api/support/tickets — authentication', () => {
  test('requires a token', async () => {
    const res = await request(app)
      .post('/api/support/tickets')
      .send({ type: 'bug', category: 'crash', description: 'It crashed.' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/support/tickets — disabled by default', () => {
  test('an unconfigured deployment returns 503 and writes nothing', async () => {
    const before = await prisma.supportTicket.count();

    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ type: 'bug', category: 'crash', description: 'It crashed.' });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('HELP_SUPPORT_DISABLED');
    expect(await prisma.supportTicket.count()).toBe(before);
  });
});

describe('POST /api/support/tickets — bug reports', () => {
  test('files a bug report with a category and description', async () => {
    enableHelpSupport();

    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({
        type: 'bug',
        category: 'wrong_answer',
        description: 'The AI gave a confusing answer for fractions.',
        context: { route: '/', buildId: 'test-build', theme: 'dark', requestId: 'req-123' },
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.id).toBe('string');
    expect(res.body.status).toBe('open');

    const ticket = await prisma.supportTicket.findUnique({ where: { id: res.body.id } });
    expect(ticket.type).toBe('bug');
    expect(ticket.category).toBe('wrong_answer');
    expect(ticket.description).toBe('The AI gave a confusing answer for fractions.');
    expect(ticket.status).toBe('open');
    expect(ticket.userId).toBe(fixtures.teacherA.id);
    expect(ticket.schoolId).toBe(fixtures.schoolA.id);
    expect(JSON.parse(ticket.context)).toEqual({
      route: '/', buildId: 'test-build', theme: 'dark', requestId: 'req-123',
    });
  });

  test('rejects a bug report with an invalid category', async () => {
    enableHelpSupport();
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ type: 'bug', category: 'not_a_real_category', description: 'Something broke.' });
    expect(res.status).toBe(400);
  });

  test('rejects a bug report with no description', async () => {
    enableHelpSupport();
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ type: 'bug', category: 'crash' });
    expect(res.status).toBe(400);
  });

  test('rejects a description over the length cap', async () => {
    enableHelpSupport();
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ type: 'bug', category: 'crash', description: 'x'.repeat(1001) });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/support/tickets — feedback', () => {
  test('accepts feedback with no description at all', async () => {
    enableHelpSupport();
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ type: 'feedback', category: 'praise' });

    expect(res.status).toBe(201);
    const ticket = await prisma.supportTicket.findUnique({ where: { id: res.body.id } });
    expect(ticket.type).toBe('feedback');
    expect(ticket.description).toBe('');
  });

  test('rejects feedback using a bug-only category', async () => {
    enableHelpSupport();
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ type: 'feedback', category: 'crash' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/support/tickets — staged rollout by school code', () => {
  test('a school outside the allow-list still gets 503', async () => {
    enableHelpSupport({ HELP_SUPPORT_ALLOWED_SCHOOL_CODES: 'SOME-OTHER-SCHOOL' });
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ type: 'bug', category: 'crash', description: 'It crashed.' });
    expect(res.status).toBe(503);
  });

  test('a school on the allow-list is let through', async () => {
    enableHelpSupport({ HELP_SUPPORT_ALLOWED_SCHOOL_CODES: fixtures.schoolA.code });
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', `Bearer ${teacherToken}`)
      .send({ type: 'bug', category: 'crash', description: 'It crashed.' });
    expect(res.status).toBe(201);
  });
});
