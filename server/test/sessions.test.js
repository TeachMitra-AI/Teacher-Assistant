const jwt = require('jsonwebtoken');
const { app, prisma } = require('./helpers/testApp');
const { makeClient } = require('./helpers/http');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { TEST_ENV } = require('./helpers/testEnv');

// Each request gets its own synthetic client IP — see helpers/http.js.
const http = makeClient(app);

describe('session / refresh-token revocation', () => {
  let fx;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'sess');
  });

  async function login(user = fx.teacherA, school = fx.schoolA) {
    const res = await http.post('/api/auth/login')
      .send({ email: user.email, password: PASSWORD, schoolId: school.id });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    return res.body;
  }

  test('login issues both an access token and a refresh token, and creates a Session row', async () => {
    const { refreshToken } = await login();
    const count = await prisma.session.count({ where: { userId: fx.teacherA.id, revokedAt: null } });
    expect(count).toBeGreaterThanOrEqual(1);
    expect(typeof refreshToken).toBe('string');
    expect(refreshToken.length).toBeGreaterThan(20);
  });

  test('refresh rotates the token: old refresh token is marked revoked, new one works', async () => {
    // The old (rotated-out) token isn't re-presented via a second /refresh here: that's the "theft" signal covered by the
    // next test and revokes every session, which would make the "new token still works" assertion fail for unrelated
    // reasons. So "the old token is now dead" is checked against the database instead.
    const { hashToken } = require('../src/middleware/auth');
    const first = await login(fx.teacherA2);

    const refreshed = await http.post('/api/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.token).toBeTruthy();
    expect(refreshed.body.refreshToken).toBeTruthy();
    expect(refreshed.body.refreshToken).not.toBe(first.refreshToken);

    const oldSession = await prisma.session.findUnique({ where: { tokenHash: hashToken(first.refreshToken) } });
    expect(oldSession.revokedAt).not.toBeNull();

    // The NEW refresh token, which was never reused/revoked, still works.
    const useNew = await http.post('/api/auth/refresh').send({ refreshToken: refreshed.body.refreshToken });
    expect(useNew.status).toBe(200);
  });

  test('reusing a rotated-out refresh token revokes ALL of that user\'s sessions (theft response), once the race window has passed', async () => {
    const { hashToken } = require('../src/middleware/auth');
    const first = await login(fx.schoolAdminA);
    const rotated = await http.post('/api/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(rotated.status).toBe(200);

    // Age the rotation past the race window, so this is a reuse rather than two tabs racing.
    await prisma.session.update({
      where: { tokenHash: hashToken(first.refreshToken) },
      data: { revokedAt: new Date(Date.now() - 60000) },
    });

    // Reuse the old (now-revoked) token — simulates a stolen refresh token
    // being used after the legitimate client already rotated past it.
    const reuse = await http.post('/api/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(reuse.status).toBe(401);

    // Even the legitimately-rotated token must now be dead too, because the
    // reuse was treated as a compromise signal for this whole user.
    const evenNewOneDead = await http.post('/api/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken });
    expect(evenNewOneDead.status).toBe(401);
  });

  test('a rotated-out token presented within the race window is a retryable 409 and revokes nothing (two tabs refreshing at once)', async () => {
    const first = await login(fx.teacherA2);
    const rotated = await http.post('/api/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(rotated.status).toBe(200);

    const race = await http.post('/api/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(race.status).toBe(409);
    expect(race.body.code).toBe('refresh_conflict');

    // The winner's successor is untouched: the other tab's session survives.
    const survivor = await http.post('/api/auth/refresh').send({ refreshToken: rotated.body.refreshToken });
    expect(survivor.status).toBe(200);
  });

  test('logout revokes the session; the refresh token can no longer be used', async () => {
    const { refreshToken } = await login(fx.resourcePersonA);

    const logoutRes = await http.post('/api/auth/logout').send({ refreshToken });
    expect(logoutRes.status).toBe(200);

    const afterLogout = await http.post('/api/auth/refresh').send({ refreshToken });
    expect(afterLogout.status).toBe(401);
  });

  test('logout with no/invalid refresh token still succeeds (client can always clear local storage)', async () => {
    const res = await http.post('/api/auth/logout').send({});
    expect(res.status).toBe(200);
  });

  test('a user can list and revoke their own sessions', async () => {
    const { token } = await login(fx.teacherA);
    const list = await http.get('/api/auth/sessions').set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.sessions.length).toBeGreaterThanOrEqual(1);

    const sessionId = list.body.sessions[0].id;
    const revoke = await http.delete(`/api/auth/sessions/${sessionId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(revoke.status).toBe(200);

    const stillListed = await http.get('/api/auth/sessions').set('Authorization', `Bearer ${token}`);
    expect(stillListed.body.sessions.map((s) => s.id)).not.toContain(sessionId);
  });

  test('a user cannot revoke another user\'s session', async () => {
    const a = await login(fx.teacherA);
    const b = await login(fx.teacherB, fx.schoolB);
    const bSessions = await http.get('/api/auth/sessions').set('Authorization', `Bearer ${b.token}`);
    const bSessionId = bSessions.body.sessions[0].id;

    const res = await http.delete(`/api/auth/sessions/${bSessionId}`)
      .set('Authorization', `Bearer ${a.token}`);
    expect(res.status).toBe(404);
  });

  test('an admin can force-revoke every session for a user in their scope', async () => {
    const target = await login(fx.teacherA2);
    const admin = await login(fx.schoolAdminA);

    const res = await http.post(`/api/admin/users/${fx.teacherA2.id}/revoke-sessions`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBeGreaterThanOrEqual(1);

    const dead = await http.post('/api/auth/refresh').send({ refreshToken: target.refreshToken });
    expect(dead.status).toBe(401);
  });

  test('an admin cannot force-revoke sessions for a user outside their scope', async () => {
    const admin = await login(fx.schoolAdminA); // scoped to School A only
    const res = await http.post(`/api/admin/users/${fx.teacherB.id}/revoke-sessions`) // School B
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(403);
  });

  test('an expired access token is rejected by authRequired', async () => {
    const expired = jwt.sign(
      { sub: fx.teacherA.id, role: 'teacher', schoolId: fx.schoolA.id, name: fx.teacherA.name },
      TEST_ENV.JWT_SECRET,
      { expiresIn: -10 } // already expired
    );
    const res = await http.get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });
});

// lastLogin feeds "Active (30 days)" and the Manage page's Last login column. It moves on every successful sign-in or
// session renewal, and never on a rejected one. Own fixtures, because these tests suspend users and revoke sessions.
describe('lastLogin', () => {
  const { hashToken } = require('../src/middleware/auth');
  const OLD = new Date('2020-01-01T00:00:00.000Z');
  let fx;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'seslog');
  });

  const signIn = async (user, school = fx.schoolA) => {
    const res = await http.post('/api/auth/login').send({ email: user.email, password: PASSWORD, schoolId: school.id });
    expect(res.status).toBe(200);
    return res.body;
  };
  const refresh = (refreshToken) => http.post('/api/auth/refresh').send({ refreshToken });
  const backdate = (user) => prisma.user.update({ where: { id: user.id }, data: { lastLogin: OLD } });
  const storedLastLogin = async (user) => (await prisma.user.findUnique({ where: { id: user.id } })).lastLogin;

  test('a repeat login moves it forward', async () => {
    await signIn(fx.teacherA);
    await backdate(fx.teacherA);
    await signIn(fx.teacherA);
    expect((await storedLastLogin(fx.teacherA)).getTime()).toBeGreaterThan(OLD.getTime());
  });

  test('a wrong password leaves it unchanged', async () => {
    await backdate(fx.teacherA);
    const res = await http.post('/api/auth/login')
      .send({ email: fx.teacherA.email, password: 'not-the-password', schoolId: fx.schoolA.id });
    expect(res.status).toBe(401);
    expect(await storedLastLogin(fx.teacherA)).toEqual(OLD);
  });

  test('a successful refresh moves it forward', async () => {
    const { refreshToken } = await signIn(fx.teacherA);
    await backdate(fx.teacherA);
    const res = await refresh(refreshToken);
    expect(res.status).toBe(200);
    expect((await storedLastLogin(fx.teacherA)).getTime()).toBeGreaterThan(OLD.getTime());
  });

  test('an unknown refresh token leaves it unchanged', async () => {
    await backdate(fx.teacherA);
    const res = await refresh('x'.repeat(40));
    expect(res.status).toBe(401);
    expect(await storedLastLogin(fx.teacherA)).toEqual(OLD);
  });

  test('a rotated-out token inside the race window leaves it unchanged', async () => {
    const { refreshToken } = await signIn(fx.teacherA2);
    expect((await refresh(refreshToken)).status).toBe(200);
    await backdate(fx.teacherA2);
    const res = await refresh(refreshToken);
    expect(res.status).toBe(409);
    expect(await storedLastLogin(fx.teacherA2)).toEqual(OLD);
  });

  test('a reused token past the race window leaves it unchanged', async () => {
    const { refreshToken } = await signIn(fx.teacherA2);
    expect((await refresh(refreshToken)).status).toBe(200);
    await prisma.session.update({
      where: { tokenHash: hashToken(refreshToken) },
      data: { revokedAt: new Date(Date.now() - 60000) },
    });
    await backdate(fx.teacherA2);
    const res = await refresh(refreshToken);
    expect(res.status).toBe(401);
    expect(await storedLastLogin(fx.teacherA2)).toEqual(OLD);
  });

  test('an expired session leaves it unchanged', async () => {
    const { refreshToken } = await signIn(fx.teacherB, fx.schoolB);
    await prisma.session.update({
      where: { tokenHash: hashToken(refreshToken) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await backdate(fx.teacherB);
    const res = await refresh(refreshToken);
    expect(res.status).toBe(401);
    expect(await storedLastLogin(fx.teacherB)).toEqual(OLD);
  });

  test('a suspended account leaves it unchanged', async () => {
    const { refreshToken } = await signIn(fx.teacherB, fx.schoolB);
    await prisma.user.update({ where: { id: fx.teacherB.id }, data: { status: 'suspended', lastLogin: OLD } });
    const res = await refresh(refreshToken);
    expect(res.status).toBe(403);
    expect(await storedLastLogin(fx.teacherB)).toEqual(OLD);
  });
});

// A refresh token rotates exactly once, however many requests present it at the same moment. Otherwise a stolen token
// used alongside the real one gets its own live session without ever tripping reuse detection.
describe('concurrent refresh', () => {
  const { hashToken } = require('../src/middleware/auth');
  const OLD = new Date('2020-01-01T00:00:00.000Z');
  let fx;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'sesrace');
  });

  const signIn = async (user, school = fx.schoolA) => {
    const res = await http.post('/api/auth/login').send({ email: user.email, password: PASSWORD, schoolId: school.id });
    expect(res.status).toBe(200);
    return res.body;
  };
  const refresh = (refreshToken) => http.post('/api/auth/refresh').send({ refreshToken });
  const liveSessions = (user) => prisma.session.findMany({ where: { userId: user.id, revokedAt: null } });

  test('simultaneous refreshes with one token: one rotates, the rest get a retryable 409', async () => {
    const { refreshToken } = await signIn(fx.teacherA);

    const responses = await Promise.all(Array.from({ length: 5 }, () => refresh(refreshToken)));

    const winners = responses.filter((r) => r.status === 200);
    const losers = responses.filter((r) => r.status !== 200);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(4);
    for (const loser of losers) {
      expect(loser.status).toBe(409);
      expect(loser.body.code).toBe('refresh_conflict');
    }

    const live = await liveSessions(fx.teacherA);
    expect(live).toHaveLength(1);
    expect(live[0].tokenHash).toBe(hashToken(winners[0].body.refreshToken));
    const old = await prisma.session.findUnique({ where: { tokenHash: hashToken(refreshToken) } });
    expect(old.replacedBy).toBe(live[0].id);
    // The old row and one successor: the losers leave nothing behind.
    expect(await prisma.session.count({ where: { userId: fx.teacherA.id } })).toBe(2);

    expect((await refresh(winners[0].body.refreshToken)).status).toBe(200);
  });

  test('a request that read the session before it was rotated cannot rotate it again', async () => {
    const { refreshToken } = await signIn(fx.teacherA2);
    const staleRead = await prisma.session.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: { include: { school: true, profilePicture: { select: { updatedAt: true } } } } },
    });

    const first = await refresh(refreshToken);
    expect(first.status).toBe(200);
    await prisma.user.update({ where: { id: fx.teacherA2.id }, data: { lastLogin: OLD } });
    const sessionsBefore = await prisma.session.count({ where: { userId: fx.teacherA2.id } });

    // Replays the race without relying on timing: this request's read predates the rotation above. Swapped by hand
    // because vi.spyOn can't capture or restore a method on Prisma's proxied delegates.
    const realFindUnique = prisma.session.findUnique;
    prisma.session.findUnique = async () => staleRead;
    let second;
    try {
      second = await refresh(refreshToken);
    } finally {
      prisma.session.findUnique = realFindUnique;
    }

    expect(second.status).toBe(409);
    expect(second.body.code).toBe('refresh_conflict');
    expect(await prisma.session.count({ where: { userId: fx.teacherA2.id } })).toBe(sessionsBefore);
    const user = await prisma.user.findUnique({ where: { id: fx.teacherA2.id } });
    expect(user.lastLogin).toEqual(OLD);
    expect((await refresh(first.body.refreshToken)).status).toBe(200);
  });

  test('reuse past the race window still ends every session', async () => {
    const { refreshToken } = await signIn(fx.teacherB, fx.schoolB);
    expect((await refresh(refreshToken)).status).toBe(200);
    await prisma.session.update({
      where: { tokenHash: hashToken(refreshToken) },
      data: { revokedAt: new Date(Date.now() - 60000) },
    });

    expect((await refresh(refreshToken)).status).toBe(401);
    expect(await liveSessions(fx.teacherB)).toHaveLength(0);
  });
});
