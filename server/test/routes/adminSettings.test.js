// Admin Settings — GET/PATCH /api/admin/feature-flags. Covers both setting
// kinds: the boolean Learning Representation flag and the role-list
// Assistant Access control.
//
// Covers: authorization (super_admin only, matching adminSupport.js's
// established "global, not a school's data" precedent), persistence across
// requests, the toast-triggering PATCH response shape, the audit Event it
// writes, and input validation (including role-name validation and the
// deliberately-allowed empty role list).
const request = require('supertest');

const { app, prisma } = require('../helpers/testApp');
const { createFixtures, PASSWORD } = require('../helpers/fixtures');
const { loginAs } = require('../helpers/auth');
const {
  LEARNING_REPRESENTATION_SETTING_KEY,
  ASSISTANT_ALLOWED_ROLES_SETTING_KEY,
} = require('../../src/lib/systemSettings');

let fixtures;
let tokens;

beforeAll(async () => {
  fixtures = await createFixtures(prisma, 'adminsettings');
  tokens = {
    teacher: await loginAs(app, fixtures.schoolA, fixtures.teacherA, PASSWORD),
    school_admin: await loginAs(app, fixtures.schoolA, fixtures.schoolAdminA, PASSWORD),
    resource_person: await loginAs(app, fixtures.schoolA, fixtures.resourcePersonA, PASSWORD),
    super_admin: await loginAs(app, fixtures.schoolA, fixtures.superAdmin, PASSWORD),
  };
});

afterEach(async () => {
  await prisma.systemSetting.deleteMany({
    where: { key: { in: [LEARNING_REPRESENTATION_SETTING_KEY, ASSISTANT_ALLOWED_ROLES_SETTING_KEY] } },
  });
});

function as(role) {
  return (req) => req.set('Authorization', `Bearer ${tokens[role]}`);
}

describe('GET /api/admin/feature-flags', () => {
  test('unauthenticated is rejected', async () => {
    const res = await request(app).get('/api/admin/feature-flags');
    expect(res.status).toBe(401);
  });

  test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
    const res = await as(role)(request(app).get('/api/admin/feature-flags'));
    expect(res.status).toBe(403);
  });

  test('super_admin can list flags, including the learning-representation entry', async () => {
    const res = await as('super_admin')(request(app).get('/api/admin/feature-flags'));
    expect(res.status).toBe(200);
    const flag = res.body.flags.find((f) => f.id === 'learning-representation');
    expect(flag).toBeTruthy();
    expect(flag.kind).toBe('feature_flag');
    expect(flag.type).toBe('boolean');
    expect(typeof flag.enabled).toBe('boolean');
    expect(flag.source).toBe('env-default');
  });

  test('super_admin can list settings, including the assistant-allowed-roles entry', async () => {
    const res = await as('super_admin')(request(app).get('/api/admin/feature-flags'));
    expect(res.status).toBe(200);
    const setting = res.body.flags.find((f) => f.id === 'assistant-allowed-roles');
    expect(setting).toBeTruthy();
    expect(setting.kind).toBe('access_control');
    expect(setting.type).toBe('role_list');
    expect(Array.isArray(setting.roles)).toBe(true);
    expect(setting.source).toBe('env-default');
  });
});

describe('PATCH /api/admin/feature-flags/:id', () => {
  test('unauthenticated is rejected', async () => {
    const res = await request(app).patch('/api/admin/feature-flags/learning-representation').send({ enabled: true });
    expect(res.status).toBe(401);
  });

  test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
    const res = await as(role)(
      request(app).patch('/api/admin/feature-flags/learning-representation')
    ).send({ enabled: true });
    expect(res.status).toBe(403);
  });

  test('unknown flag id is a 404', async () => {
    const res = await as('super_admin')(
      request(app).patch('/api/admin/feature-flags/not-a-real-flag')
    ).send({ enabled: true });
    expect(res.status).toBe(404);
  });

  test('a non-boolean "enabled" is rejected', async () => {
    const res = await as('super_admin')(
      request(app).patch('/api/admin/feature-flags/learning-representation')
    ).send({ enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  test('super_admin flips the flag, and the change persists across requests', async () => {
    const patchRes = await as('super_admin')(
      request(app).patch('/api/admin/feature-flags/learning-representation')
    ).send({ enabled: true });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body).toMatchObject({ id: 'learning-representation', enabled: true, source: 'override' });

    const getRes = await as('super_admin')(request(app).get('/api/admin/feature-flags'));
    const flag = getRes.body.flags.find((f) => f.id === 'learning-representation');
    expect(flag.enabled).toBe(true);
    expect(flag.source).toBe('override');
  });

  test('writes an audit Event row naming the acting admin and the new value', async () => {
    await as('super_admin')(
      request(app).patch('/api/admin/feature-flags/learning-representation')
    ).send({ enabled: false });

    const events = await prisma.event.findMany({
      where: { type: 'feature_flag_updated', userId: fixtures.superAdmin.id },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(events).toHaveLength(1);
    const metadata = JSON.parse(events[0].metadata);
    expect(metadata).toEqual({ key: LEARNING_REPRESENTATION_SETTING_KEY, enabled: false });
  });
});

describe('PATCH /api/admin/feature-flags/assistant-allowed-roles', () => {
  test('unauthenticated is rejected', async () => {
    const res = await request(app)
      .patch('/api/admin/feature-flags/assistant-allowed-roles')
      .send({ roles: ['teacher'] });
    expect(res.status).toBe(401);
  });

  test.each(['teacher', 'school_admin', 'resource_person'])('%s is denied', async (role) => {
    const res = await as(role)(
      request(app).patch('/api/admin/feature-flags/assistant-allowed-roles')
    ).send({ roles: ['teacher'] });
    expect(res.status).toBe(403);
  });

  test.each(['teacher', 'school_admin', 'resource_person', 'super_admin'])(
    'accepts a single valid role: %s',
    async (role) => {
      const res = await as('super_admin')(
        request(app).patch('/api/admin/feature-flags/assistant-allowed-roles')
      ).send({ roles: [role] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: 'assistant-allowed-roles', roles: [role], source: 'override' });
    }
  );

  test('accepts every valid role at once', async () => {
    const roles = ['teacher', 'school_admin', 'resource_person', 'super_admin'];
    const res = await as('super_admin')(
      request(app).patch('/api/admin/feature-flags/assistant-allowed-roles')
    ).send({ roles });
    expect(res.status).toBe(200);
    expect(res.body.roles.sort()).toEqual([...roles].sort());
  });

  test('an unknown role name is rejected with 400 and nothing is persisted', async () => {
    const res = await as('super_admin')(
      request(app).patch('/api/admin/feature-flags/assistant-allowed-roles')
    ).send({ roles: ['teacher', 'principal'] });
    expect(res.status).toBe(400);

    const row = await prisma.systemSetting.findUnique({ where: { key: ASSISTANT_ALLOWED_ROLES_SETTING_KEY } });
    expect(row).toBeNull();
  });

  test('a non-array "roles" is rejected with 400', async () => {
    const res = await as('super_admin')(
      request(app).patch('/api/admin/feature-flags/assistant-allowed-roles')
    ).send({ roles: 'teacher' });
    expect(res.status).toBe(400);
  });

  // Deliberate: an empty list is a VALID override meaning "no role may use
  // the Assistant" — the same "fully disable" state the boolean flag's
  // `false` already offers, not an error and not "no restriction". See
  // docs/admin-feature-flags-architecture.md §4.1.
  test('an empty roles array is accepted and disables the Assistant for everyone', async () => {
    const res = await as('super_admin')(
      request(app).patch('/api/admin/feature-flags/assistant-allowed-roles')
    ).send({ roles: [] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'assistant-allowed-roles', roles: [], source: 'override' });

    const getRes = await as('super_admin')(request(app).get('/api/admin/feature-flags'));
    const setting = getRes.body.flags.find((f) => f.id === 'assistant-allowed-roles');
    expect(setting.roles).toEqual([]);
    expect(setting.source).toBe('override');
  });

  test('super_admin updates the roles, and the change persists across requests', async () => {
    const patchRes = await as('super_admin')(
      request(app).patch('/api/admin/feature-flags/assistant-allowed-roles')
    ).send({ roles: ['teacher', 'resource_person'] });
    expect(patchRes.status).toBe(200);

    const getRes = await as('super_admin')(request(app).get('/api/admin/feature-flags'));
    const setting = getRes.body.flags.find((f) => f.id === 'assistant-allowed-roles');
    expect(setting.roles.sort()).toEqual(['resource_person', 'teacher']);
    expect(setting.source).toBe('override');
  });

  test('writes an audit Event row naming the acting admin and the new roles', async () => {
    await as('super_admin')(
      request(app).patch('/api/admin/feature-flags/assistant-allowed-roles')
    ).send({ roles: ['super_admin'] });

    const events = await prisma.event.findMany({
      where: { type: 'feature_flag_updated', userId: fixtures.superAdmin.id },
      orderBy: { createdAt: 'desc' },
      take: 1,
    });
    expect(events).toHaveLength(1);
    const metadata = JSON.parse(events[0].metadata);
    expect(metadata).toEqual({ key: ASSISTANT_ALLOWED_ROLES_SETTING_KEY, roles: ['super_admin'] });
  });
});
