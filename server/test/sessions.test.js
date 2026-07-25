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
    // Note: we deliberately do NOT re-present the old (rotated-out) token
    // via a second /refresh call here — doing so is exactly the "theft"
    // signal covered by the next test, and it has the side effect of
    // revoking every session for the user, which would make the "new token
    // still works" assertion below fail for reasons unrelated to rotation
    // itself. So the "old token is now dead" half of this is checked
    // directly against the database instead.
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

  test('reusing a revoked/rotated-out refresh token revokes ALL of that user\'s sessions (theft response)', async () => {
    const first = await login(fx.schoolAdminA);
    const rotated = await http.post('/api/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(rotated.status).toBe(200);

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
