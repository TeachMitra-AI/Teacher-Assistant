// "Active (30 days)" on the Overview must agree with the Last login column on the Manage page, so it counts logins,
// not Coach queries. Asserted through school-scoped admins: a super_admin's count would include other test files' users.
const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { makeClient } = require('./helpers/http');

// Each request gets its own synthetic client IP — see helpers/http.js.
const http = makeClient(app);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS);

describe('GET /api/admin/analytics activeTeachers', () => {
  let fx;
  let adminAToken;
  let adminBToken;

  const activeTeachers = async (token) => {
    const res = await request(app).get('/api/admin/analytics').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body.totals.activeTeachers;
  };

  const signIn = async (user) => {
    const res = await http.post('/api/auth/login').send({ email: user.email, password: PASSWORD, schoolId: user.schoolId });
    expect(res.status).toBe(200);
    return res.body;
  };

  const setLastLogin = (user, lastLogin) =>
    prisma.user.update({ where: { id: user.id }, data: { lastLogin } });

  const addRecentQuery = (user) =>
    prisma.query.create({
      data: {
        userId: user.id,
        schoolId: user.schoolId,
        queryText: 'active teachers test query',
        language: 'en',
        context: JSON.stringify({ subject: 'Mathematics' }),
        responseText: 'Sample response',
      },
    });

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'actv');
    adminAToken = await loginAs(app, fx.schoolA, fx.schoolAdminA, PASSWORD);
    adminBToken = await loginAs(app, fx.schoolB, fx.schoolAdminB, PASSWORD);
  });

  beforeEach(async () => {
    await prisma.user.updateMany({
      where: { id: { in: [fx.teacherA.id, fx.teacherA2.id, fx.teacherB.id] } },
      data: { lastLogin: null },
    });
  });

  test('counts a teacher who logged in within 30 days, with or without queries', async () => {
    await setLastLogin(fx.teacherA, daysAgo(2)); // has the fixture's query
    await setLastLogin(fx.teacherA2, daysAgo(29)); // has none
    expect(await activeTeachers(adminAToken)).toBe(2);
  });

  test('does not count a teacher whose last login is over 30 days old, even with a recent query', async () => {
    await setLastLogin(fx.teacherA2, daysAgo(31));
    await addRecentQuery(fx.teacherA2);
    expect(await activeTeachers(adminAToken)).toBe(0);
  });

  test('does not count a teacher who has never logged in, even with a recent query', async () => {
    await addRecentQuery(fx.teacherA2);
    expect(await activeTeachers(adminAToken)).toBe(0);
  });

  test('does not count admins, however recently they logged in', async () => {
    await addRecentQuery(fx.schoolAdminA);
    await setLastLogin(fx.schoolAdminA, daysAgo(1));
    await setLastLogin(fx.resourcePersonA, daysAgo(1));
    await setLastLogin(fx.superAdmin, daysAgo(1));
    expect(await activeTeachers(adminAToken)).toBe(0);
  });

  test('the latest login decides: an old login followed by a new one keeps the teacher active', async () => {
    await setLastLogin(fx.teacherA, daysAgo(31));
    expect(await activeTeachers(adminAToken)).toBe(0);
    await signIn(fx.teacherA);
    expect(await activeTeachers(adminAToken)).toBe(1);
  });

  test('a teacher who stays signed in stays active: a session refresh counts', async () => {
    const { refreshToken } = await signIn(fx.teacherA);
    await setLastLogin(fx.teacherA, daysAgo(31));
    expect(await activeTeachers(adminAToken)).toBe(0);

    const res = await http.post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(200);
    expect(await activeTeachers(adminAToken)).toBe(1);
  });

  test('each school only counts its own teachers', async () => {
    await setLastLogin(fx.teacherA, daysAgo(1));
    await setLastLogin(fx.teacherA2, daysAgo(1));
    await setLastLogin(fx.teacherB, daysAgo(1));
    expect(await activeTeachers(adminAToken)).toBe(2);
    expect(await activeTeachers(adminBToken)).toBe(1);
  });
});
