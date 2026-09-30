// GET /api/assistant/catalog, end to end. The registry's logic is unit-tested in test/actions/registry.test.js; here it's
// the HTTP surface: authentication, the rollout gates, and that switching the assistant off leaves the endpoint inert
// rather than broken, since "not enabled for you" is a normal state.
// Flags are set through process.env and restored afterwards; the route reads them per request, so this works against the shared app.

const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { CATALOG_VERSION } = require('../src/actions/registry');
// The example payloads published in docs/ai-action-router-phase1-spec.md.
// Named distinctly from the database `fixtures` below, which are unrelated.
const contractFixtures = require('./helpers/assistantFixtures');
const { setRoleListSetting, ASSISTANT_ALLOWED_ROLES_SETTING_KEY } = require('../src/lib/systemSettings');

const ASSISTANT_ENV_KEYS = [
  'ASSISTANT_ENABLED',
  'ASSISTANT_ACTION_GENERATE_ASSESSMENT',
  'ASSISTANT_ACTION_OPEN_GENERATOR',
  'ASSISTANT_ALLOWED_ROLES',
  'ASSISTANT_ALLOWED_SCHOOL_CODES',
];

let fixtures;
let teacherToken;
let adminToken;
let savedEnv;

/** Turn the assistant fully on for a teacher, then apply any overrides. */
function enableAssistant(overrides = {}) {
  process.env.ASSISTANT_ENABLED = 'true';
  process.env.ASSISTANT_ACTION_GENERATE_ASSESSMENT = 'true';
  process.env.ASSISTANT_ACTION_OPEN_GENERATOR = 'true';
  process.env.ASSISTANT_ALLOWED_ROLES = 'teacher';
  delete process.env.ASSISTANT_ALLOWED_SCHOOL_CODES;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearAssistantEnv() {
  for (const key of ASSISTANT_ENV_KEYS) delete process.env[key];
}

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'asstcat');
  teacherToken = await loginAs(app, fixtures.schoolA, fixtures.teacherA, fixtures.PASSWORD);
  adminToken = await loginAs(app, fixtures.schoolA, fixtures.schoolAdminA, fixtures.PASSWORD);
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
});

describe('GET /api/assistant/catalog — authentication', () => {
  test('requires a token', async () => {
    const res = await request(app).get('/api/assistant/catalog');
    expect(res.status).toBe(401);
  });

  test('rejects a garbage token', async () => {
    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/assistant/catalog — disabled by default', () => {
  test('an unconfigured deployment returns the inert catalog, not an error', async () => {
    // The headline guarantee: shipping this code without setting anything
    // changes nothing for anyone.
    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${teacherToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ catalogVersion: 0, actions: [] });
  });

  test('the master switch alone is not enough — per-action flags still gate', async () => {
    process.env.ASSISTANT_ENABLED = 'true';
    process.env.ASSISTANT_ALLOWED_ROLES = 'teacher';

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${teacherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.actions).toEqual([]);
    // Version is the live one here: the caller IS inside the rollout, there
    // simply are no actions switched on for them yet.
    expect(res.body.catalogVersion).toBe(CATALOG_VERSION);
  });
});

describe('GET /api/assistant/catalog — enabled', () => {
  test('returns both actions when fully switched on', async () => {
    enableAssistant();

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${teacherToken}`);

    expect(res.status).toBe(200);
    expect(res.body.catalogVersion).toBe(CATALOG_VERSION);
    expect(res.body.actions.map((a) => a.id)).toEqual(['generate_assessment', 'open_generator']);
  });

  test('one action can be rolled out without the other', async () => {
    enableAssistant({ ASSISTANT_ACTION_GENERATE_ASSESSMENT: 'false' });

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${teacherToken}`);

    expect(res.body.actions.map((a) => a.id)).toEqual(['open_generator']);
  });

  test('NEVER exposes server-internal descriptor fields', async () => {
    enableAssistant();

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${teacherToken}`);

    const serialized = JSON.stringify(res.body);
    // Checked against the whole payload, not field by field, so a field nested
    // somewhere unexpected is caught too.
    for (const leak of ['paramSchema', 'requiredRoles', 'featureFlag', 'autoExecute', 'defaultFrom']) {
      expect(serialized, `catalog leaked ${leak}`).not.toContain(leak);
    }
  });

  test('never publishes a route, path or URL', async () => {
    enableAssistant();

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${teacherToken}`);

    for (const action of res.body.actions) {
      expect(action).not.toHaveProperty('route');
      expect(action).not.toHaveProperty('path');
      expect(action).not.toHaveProperty('url');
    }
  });

  test('the generator action advertises the slots a client needs to prefill', async () => {
    enableAssistant();

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${teacherToken}`);

    const action = res.body.actions.find((a) => a.id === 'generate_assessment');
    expect(action.effect).toBe('draft');
    expect(action.slots.map((s) => s.name)).toEqual([
      'format', 'topic', 'grade', 'subject', 'difficulty', 'questionType', 'questionCount', 'language',
    ]);

    const format = action.slots.find((s) => s.name === 'format');
    expect(format.required).toBe(true);
    expect(format.values).toEqual(['quiz', 'worksheet']);
    expect(format.askOptions).toEqual(['Quiz', 'Worksheet']);
  });
});

describe('GET /api/assistant/catalog — matches the documented contract', () => {
  test('the live endpoint returns exactly what the specification documents', async () => {
    // test/helpers/assistantFixtures.js holds the example payload published in docs/ai-action-router-phase1-spec.md.
    // Without this assertion the registry and the documented contract could drift apart. toEqual ignores property
    // order, which isn't part of the contract; every key and value is.
    enableAssistant();

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${teacherToken}`);

    expect(res.body).toEqual(contractFixtures.catalogResponse);
  });

  test('the disabled response matches the documented inert payload', async () => {
    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${teacherToken}`);

    expect(res.body).toEqual(contractFixtures.catalogDisabledResponse);
  });
});

describe('GET /api/assistant/catalog — rollout gates', () => {
  test('a role outside the allow-list gets the inert catalog', async () => {
    enableAssistant({ ASSISTANT_ALLOWED_ROLES: 'teacher' });

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ catalogVersion: 0, actions: [] });
  });

  test('the allow-list can be widened without a deploy', async () => {
    enableAssistant({ ASSISTANT_ALLOWED_ROLES: 'teacher,school_admin' });

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body.actions.length).toBe(2);
  });

  test('an empty school allow-list means every school, not none', async () => {
    enableAssistant({ ASSISTANT_ALLOWED_SCHOOL_CODES: '' });

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${teacherToken}`);

    expect(res.body.actions.length).toBe(2);
  });

  test('a school inside the allow-list is served', async () => {
    enableAssistant({ ASSISTANT_ALLOWED_SCHOOL_CODES: fixtures.schoolA.code });

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${teacherToken}`);

    expect(res.body.actions.length).toBe(2);
  });

  test('a school outside the allow-list gets the inert catalog', async () => {
    enableAssistant({ ASSISTANT_ALLOWED_SCHOOL_CODES: fixtures.schoolB.code });

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${teacherToken}`);

    expect(res.body).toEqual({ catalogVersion: 0, actions: [] });
  });
});

describe('GET /api/assistant/catalog — Admin Settings > AI Access override precedence', () => {
  afterEach(async () => {
    // Cleans up rows written via setRoleListSetting: the shared beforeEach's clearAssistantEnv() resets only env vars, so a
    // leftover SystemSetting row would leak into a later test that assumes ASSISTANT_ALLOWED_ROLES alone governs.
    await prisma.systemSetting.deleteMany({ where: { key: ASSISTANT_ALLOWED_ROLES_SETTING_KEY } });
  });

  test('an override can widen access beyond ASSISTANT_ALLOWED_ROLES, without a deploy', async () => {
    enableAssistant({ ASSISTANT_ALLOWED_ROLES: 'teacher' }); // env alone would exclude school_admin
    await setRoleListSetting(ASSISTANT_ALLOWED_ROLES_SETTING_KEY, ['teacher', 'school_admin'], 'test-admin');

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${adminToken}`); // adminToken is a school_admin — see beforeAll

    expect(res.status).toBe(200);
    expect(res.body.actions.length).toBe(2);
  });

  test('an override can narrow access below ASSISTANT_ALLOWED_ROLES, removing a role the env allowed', async () => {
    enableAssistant({ ASSISTANT_ALLOWED_ROLES: 'teacher' }); // env alone would include the teacher
    await setRoleListSetting(ASSISTANT_ALLOWED_ROLES_SETTING_KEY, ['school_admin'], 'test-admin');

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${teacherToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ catalogVersion: 0, actions: [] });
  });

  test('an explicit empty override disables the Assistant for every role', async () => {
    enableAssistant({ ASSISTANT_ALLOWED_ROLES: 'teacher,school_admin' });
    await setRoleListSetting(ASSISTANT_ALLOWED_ROLES_SETTING_KEY, [], 'test-admin');

    const teacherRes = await request(app).get('/api/assistant/catalog').set('Authorization', `Bearer ${teacherToken}`);
    const adminRes = await request(app).get('/api/assistant/catalog').set('Authorization', `Bearer ${adminToken}`);

    expect(teacherRes.body).toEqual({ catalogVersion: 0, actions: [] });
    expect(adminRes.body).toEqual({ catalogVersion: 0, actions: [] });
  });

  test('with no override row, ASSISTANT_ALLOWED_ROLES alone still governs (unchanged baseline behavior)', async () => {
    enableAssistant({ ASSISTANT_ALLOWED_ROLES: 'teacher' });

    const res = await request(app)
      .get('/api/assistant/catalog')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.body).toEqual({ catalogVersion: 0, actions: [] });
  });
});

describe('GET /api/assistant/catalog — additive only', () => {
  test('mounting the assistant router did not shadow an existing endpoint', async () => {
    // /api/assistant/* is a new namespace; nothing under /api/resources or
    // /api/coach may have been captured by it.
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);

    const resources = await request(app)
      .get('/api/resources')
      .set('Authorization', `Bearer ${teacherToken}`);
    expect(resources.status).toBe(200);
    expect(Array.isArray(resources.body.resources)).toBe(true);
  });

  test('an unknown assistant path still 404s rather than returning a catalog', async () => {
    enableAssistant();

    const res = await request(app)
      .get('/api/assistant/not-a-real-endpoint')
      .set('Authorization', `Bearer ${teacherToken}`);

    expect(res.status).toBe(404);
  });

  // This started as a check that POST /api/assistant/interpret returned 404 before it existed, and became false by
  // design when the endpoint was built. It now pins the current surface instead of being deleted, so it guards that
  // mounting this router exposes the intended surface and nothing else, and an unplanned extra endpoint fails it.
  test('the assistant exposes exactly the M5 surface, and nothing more', async () => {
    enableAssistant();
    const auth = { Authorization: `Bearer ${teacherToken}` };

    // The two intended endpoints exist...
    const catalog = await request(app).get('/api/assistant/catalog').set(auth);
    expect(catalog.status).toBe(200);

    const interpret = await request(app)
      .post('/api/assistant/interpret')
      .set(auth)
      .send({ utterance: 'Generate a Class 5 fractions worksheet' });
    expect(interpret.status).toBe(200);

    // ...and nothing else does, on either verb.
    const unknownGet = await request(app).get('/api/assistant/not-a-real-endpoint').set(auth);
    expect(unknownGet.status).toBe(404);

    const unknownPost = await request(app).post('/api/assistant/execute').set(auth).send({});
    expect(unknownPost.status).toBe(404);

    // The catalog is still a GET-only surface: a POST to it must not quietly
    // fall through to some other handler.
    const catalogPost = await request(app).post('/api/assistant/catalog').set(auth).send({});
    expect(catalogPost.status).toBe(404);
  });
});
