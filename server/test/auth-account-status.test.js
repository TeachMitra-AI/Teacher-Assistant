// Phase 2 of the auth hardening: account suspension, plain-language validation messages, existing passwords that predate
// the current rules, and a limit on wrong current passwords in the change-password flow.
const bcrypt = require('bcryptjs');
const { app, prisma } = require('./helpers/testApp');
const { makeClient } = require('./helpers/http');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

const http = makeClient(app);

// Zod's own wording must never reach a user.
const ZOD_WORDING = /expected|received|Invalid input|Too (big|small)/i;

let counter = 0;
function freshEmail(tag) {
  counter += 1;
  return `acct-${tag}-${counter}@example.com`;
}

async function makeAccount(school, { status = 'active', password = PASSWORD, role = 'teacher', tag = 'user' } = {}) {
  return prisma.user.create({
    data: {
      schoolId: school.id,
      name: 'Account Status Test',
      email: freshEmail(tag),
      role,
      status,
      passwordHash: await bcrypt.hash(password, 10),
    },
  });
}

describe('account suspension', () => {
  let fx;
  let admin;
  let adminToken;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'acct');
    admin = fx.schoolAdminA;
    adminToken = await loginAs(app, fx.schoolA, admin, PASSWORD);
  });

  async function signIn(user, school = fx.schoolA) {
    const res = await http.post('/api/auth/login').send({ email: user.email, password: PASSWORD, schoolId: school.id });
    expect(res.status).toBe(200);
    return res.body;
  }

  test('a school admin suspends an active teacher, and that ends every session they had', async () => {
    const teacher = await makeAccount(fx.schoolA, { tag: 'suspend-me' });
    await signIn(teacher);

    const res = await http.patch(`/api/admin/users/${teacher.id}/suspend`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: teacher.id, status: 'suspended' });

    const open = await prisma.session.count({ where: { userId: teacher.id, revokedAt: null } });
    expect(open).toBe(0);
  });

  test('an access token issued before the suspension is refused immediately, not when it expires', async () => {
    const teacher = await makeAccount(fx.schoolA, { tag: 'token-cut' });
    const { token } = await signIn(teacher);
    expect((await http.get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);

    await http.patch(`/api/admin/users/${teacher.id}/suspend`).set('Authorization', `Bearer ${adminToken}`);

    const after = await http.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
    expect(after.body.error).toMatch(/no longer active/i);
  });

  test('a refresh for a suspended account is refused with account_suspended, before any rotation', async () => {
    // Set the status directly, without ending sessions, so this exercises the refresh gate on its own.
    const teacher = await makeAccount(fx.schoolA, { tag: 'refresh-gate' });
    const { refreshToken } = await signIn(teacher);
    await prisma.user.update({ where: { id: teacher.id }, data: { status: 'suspended' } });

    const res = await http.post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('account_suspended');
  });

  test('a suspended teacher cannot sign in, and is told the account is suspended', async () => {
    const teacher = await makeAccount(fx.schoolA, { status: 'suspended', tag: 'no-login' });
    const res = await http.post('/api/auth/login').send({ email: teacher.email, password: PASSWORD, schoolId: fx.schoolA.id });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('account_suspended');
  });

  test('reactivating a suspended account lets the teacher sign in again', async () => {
    const teacher = await makeAccount(fx.schoolA, { tag: 'come-back' });
    await http.patch(`/api/admin/users/${teacher.id}/suspend`).set('Authorization', `Bearer ${adminToken}`);

    const reactivated = await http.patch(`/api/admin/users/${teacher.id}/reactivate`).set('Authorization', `Bearer ${adminToken}`);
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.status).toBe('active');

    const login = await http.post('/api/auth/login').send({ email: teacher.email, password: PASSWORD, schoolId: fx.schoolA.id });
    expect(login.status).toBe(200);
  });

  test('after a reactivation, the access token from before the suspension stays dead, and a fresh sign-in works', async () => {
    const teacher = await makeAccount(fx.schoolA, { tag: 'old-token' });
    const { token } = await signIn(teacher);
    expect((await http.get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(200);

    await http.patch(`/api/admin/users/${teacher.id}/suspend`).set('Authorization', `Bearer ${adminToken}`);
    await http.patch(`/api/admin/users/${teacher.id}/reactivate`).set('Authorization', `Bearer ${adminToken}`);

    // The token is still inside its 15-minute life, but it belongs to the session the suspension ended.
    const stale = await http.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(stale.status).toBe(401);
    expect(stale.body.error).toMatch(/session has ended/i);

    // Token iat is in whole seconds, so wait past the reactivation before signing in again.
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const fresh = await signIn(teacher);
    expect((await http.get('/api/auth/me').set('Authorization', `Bearer ${fresh.token}`)).status).toBe(200);
  });

  test('suspend and reactivate only move an account between the states they apply to', async () => {
    const suspended = await makeAccount(fx.schoolA, { status: 'suspended', tag: 'already' });
    const suspendAgain = await http.patch(`/api/admin/users/${suspended.id}/suspend`).set('Authorization', `Bearer ${adminToken}`);
    expect(suspendAgain.status).toBe(409);

    const active = await makeAccount(fx.schoolA, { tag: 'not-suspended' });
    const reactivateActive = await http.patch(`/api/admin/users/${active.id}/reactivate`).set('Authorization', `Bearer ${adminToken}`);
    expect(reactivateActive.status).toBe(409);
  });

  test('nobody can change the status of their own account', async () => {
    const res = await http.patch(`/api/admin/users/${admin.id}/suspend`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    const row = await prisma.user.findUnique({ where: { id: admin.id } });
    expect(row.status).toBe('active');
  });

  test('a school admin cannot suspend another admin account', async () => {
    const otherAdmin = await makeAccount(fx.schoolA, { role: 'school_admin', tag: 'peer-admin' });
    const res = await http.patch(`/api/admin/users/${otherAdmin.id}/suspend`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
  });

  test('a school admin cannot act on a teacher at another school', async () => {
    const outsider = await makeAccount(fx.schoolB, { tag: 'other-school' });
    const res = await http.patch(`/api/admin/users/${outsider.id}/suspend`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(403);
    const row = await prisma.user.findUnique({ where: { id: outsider.id } });
    expect(row.status).toBe('active');
  });

  test('a teacher cannot suspend anyone', async () => {
    const actor = await makeAccount(fx.schoolA, { tag: 'not-an-admin' });
    const actorToken = (await signIn(actor)).token;
    const target = await makeAccount(fx.schoolA, { tag: 'target' });
    const res = await http.patch(`/api/admin/users/${target.id}/suspend`).set('Authorization', `Bearer ${actorToken}`);
    expect(res.status).toBe(403);
  });

  test('a suspension is recorded in the event log against the admin who made it', async () => {
    const teacher = await makeAccount(fx.schoolA, { tag: 'audited' });
    await http.patch(`/api/admin/users/${teacher.id}/suspend`).set('Authorization', `Bearer ${adminToken}`);

    const event = await prisma.event.findFirst({
      where: { type: 'user_suspended', userId: admin.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(event).toBeTruthy();
    expect(JSON.parse(event.metadata).targetUserId).toBe(teacher.id);
  });

  test('a pending account with a session from before is refused at refresh with pending_approval', async () => {
    const teacher = await makeAccount(fx.schoolA, { tag: 'back-to-pending' });
    const { refreshToken } = await signIn(teacher);
    await prisma.user.update({ where: { id: teacher.id }, data: { status: 'pending' } });

    const res = await http.post('/api/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('pending_approval');
  });
});

describe('validation messages are plain and existing passwords are not blocked', () => {
  let fx;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'acctv');
  });

  test.each([
    ['login with no body', '/api/auth/login', {}],
    ['login with a 73-character password', '/api/auth/login', { email: 'a@example.com', password: 'x'.repeat(73) }],
    ['register with a one-letter name', '/api/auth/register', { name: 'A', email: 'a@example.com', password: 'Password-123' }],
    ['register with no body', '/api/auth/register', {}],
    ['google with no token', '/api/auth/google', {}],
    ['forgot-password with no body', '/api/auth/forgot-password', {}],
    ['reset-password with no body', '/api/auth/reset-password', {}],
    ['password change with no body', '/api/auth/me/password', {}],
  ])('%s gets a plain message, never Zod wording', async (_name, path, body) => {
    const token = path === '/api/auth/me/password' ? await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD) : null;
    const req = path === '/api/auth/me/password' ? http.patch(path) : http.post(path);
    const res = await (token ? req.set('Authorization', `Bearer ${token}`) : req).send(body);

    expect([400, 401]).toContain(res.status);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body.error).not.toMatch(ZOD_WORDING);
  });

  test('a 73-character password explains the 72-character limit in plain words', async () => {
    const res = await http.post('/api/auth/login').send({ email: fx.teacherA.email, password: 'x'.repeat(73) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Password must be at most 72 characters.');
  });

  test('a teacher whose password is shorter than the current minimum can still sign in', async () => {
    // Accounts created before the 8-character rule, or set by an admin, can hold shorter passwords. Refusing them at sign-in
    // would lock those teachers out with no way back short of a reset.
    const legacy = await prisma.user.create({
      data: {
        schoolId: fx.schoolA.id,
        name: 'Legacy Short Password',
        email: freshEmail('legacy-short'),
        role: 'teacher',
        status: 'active',
        passwordHash: await bcrypt.hash('abc123', 10),
      },
    });
    const res = await http.post('/api/auth/login').send({ email: legacy.email, password: 'abc123', schoolId: fx.schoolA.id });
    expect(res.status).toBe(200);
  });

  test('a new password still needs at least 8 characters', async () => {
    const token = await loginAs(app, fx.schoolA, fx.teacherA, PASSWORD);
    const res = await http
      .patch('/api/auth/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Password must be at least 8 characters.');
  });
});

describe('wrong current passwords in change-password are capped per account', () => {
  let fx;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'acctpw');
  });

  test('after five wrong current passwords further attempts are held for a while', async () => {
    const owner = await makeAccount(fx.schoolA, { tag: 'pw-guess' });
    const token = await loginAs(app, fx.schoolA, owner, PASSWORD);
    const change = (currentPassword) =>
      http.patch('/api/auth/me/password').set('Authorization', `Bearer ${token}`).send({ currentPassword, newPassword: 'brand-new-pass-1' });

    for (let i = 0; i < 5; i++) {
      expect((await change('wrong-guess')).status).toBe(401);
    }
    const blocked = await change('wrong-guess');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/too many incorrect current-password attempts/i);
  });

  test('validation errors and successful changes do not count toward the cap', async () => {
    const owner = await makeAccount(fx.schoolA, { tag: 'pw-typos' });
    const token = await loginAs(app, fx.schoolA, owner, PASSWORD);

    for (let i = 0; i < 6; i++) {
      const res = await http.patch('/api/auth/me/password').set('Authorization', `Bearer ${token}`).send({});
      expect(res.status).toBe(400);
    }
    const ok = await http
      .patch('/api/auth/me/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'changed-password-2' });
    expect(ok.status).toBe(200);
  });
});
