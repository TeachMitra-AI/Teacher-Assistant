// Self-service password reset: POST /auth/forgot-password ->
// POST /auth/reset-password.
//
// The provider call is stubbed at the `fetch` boundary (helpers/emailMock.js),
// so these run the real endpoint, the real token generation and the real email
// module without sending mail. The raw token is read back out of the mocked
// email body, which is the only place it exists unhashed.
const bcrypt = require('bcryptjs');
const { app, prisma } = require('./helpers/testApp');
const { makeClient } = require('./helpers/http');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { mockEmailFetch, extractResetToken } = require('./helpers/emailMock');
const { hashToken } = require('../src/middleware/auth');

// Each request gets its own synthetic client IP — see helpers/http.js.
const http = makeClient(app);

describe('password reset', () => {
  let fx;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'reset');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Walks the happy path and hands back the raw token, for cases that need one.
  async function requestReset(email) {
    const { sent } = mockEmailFetch();
    const res = await http.post('/api/auth/forgot-password').send({ email });
    expect(res.status).toBe(200);
    return { res, sent, token: sent.length ? extractResetToken(sent[0]) : null };
  }

  describe('forgot-password', () => {
    test('sends a reset email and stores only the token hash', async () => {
      const { sent, token } = await requestReset(fx.teacherA.email);

      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe(fx.teacherA.email);
      expect(sent[0].url).toBe('https://api.brevo.com/v3/smtp/email');
      expect(sent[0].subject).toMatch(/reset/i);
      expect(token.length).toBeGreaterThan(20);

      // The stored row holds the hash, never the token itself.
      const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
      expect(record).not.toBeNull();
      expect(record.userId).toBe(fx.teacherA.id);
      expect(record.usedAt).toBeNull();
      expect(record.expiresAt.getTime()).toBeGreaterThan(Date.now());

      const allTokens = await prisma.passwordResetToken.findMany({ where: { userId: fx.teacherA.id } });
      for (const row of allTokens) expect(row.tokenHash).not.toBe(token);
    });

    test('an unknown email gets the identical response, and sends nothing', async () => {
      const { sent: knownSent } = mockEmailFetch();
      const known = await http.post('/api/auth/forgot-password').send({ email: fx.teacherA2.email });
      vi.unstubAllGlobals();

      const { sent: unknownSent } = mockEmailFetch();
      const unknown = await http.post('/api/auth/forgot-password').send({ email: 'reset-nobody@example.com' });

      expect(unknown.status).toBe(known.status);
      expect(unknown.body).toEqual(known.body);
      expect(knownSent).toHaveLength(1);
      expect(unknownSent).toHaveLength(0);
    });

    test('a pending account gets the same response but no email', async () => {
      await prisma.user.create({
        data: {
          schoolId: fx.schoolA.id,
          name: 'Still Pending',
          email: 'reset-pending@example.com',
          role: 'teacher',
          status: 'pending',
          passwordHash: await bcrypt.hash(PASSWORD, 10),
        },
      });

      const { res, sent } = await requestReset('reset-pending@example.com');
      expect(res.body).toEqual({ ok: true });
      expect(sent).toHaveLength(0);
    });

    test('a Google-only account gets the same response but no email', async () => {
      await prisma.user.create({
        data: {
          schoolId: fx.schoolA.id,
          name: 'Google Only',
          email: 'reset-google-only@example.com',
          role: 'teacher',
          status: 'active',
          googleSub: 'reset-google-sub-1',
        },
      });

      const { res, sent } = await requestReset('reset-google-only@example.com');
      expect(res.body).toEqual({ ok: true });
      expect(sent).toHaveLength(0);
    });

    test('a malformed email is a 400', async () => {
      mockEmailFetch();
      const res = await http.post('/api/auth/forgot-password').send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
    });

    test('a provider failure still returns the generic success response', async () => {
      const { sent } = mockEmailFetch({ failWith: 422 });
      const res = await http.post('/api/auth/forgot-password').send({ email: fx.superAdmin.email });
      // The teacher must not learn about our provider's problems, and the
      // response must not become an enumeration signal either.
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(sent).toHaveLength(1);
    });

    test('requesting a second reset retires the first link', async () => {
      const first = await requestReset(fx.resourcePersonA.email);
      vi.unstubAllGlobals();
      const second = await requestReset(fx.resourcePersonA.email);
      expect(second.token).not.toBe(first.token);

      const firstRecord = await prisma.passwordResetToken.findUnique({
        where: { tokenHash: hashToken(first.token) },
      });
      expect(firstRecord.usedAt).not.toBeNull();

      // And the retired one is genuinely refused.
      const res = await http
        .post('/api/auth/reset-password')
        .send({ token: first.token, password: 'a-brand-new-password' });
      expect(res.status).toBe(400);
    });

    test('one email at two schools produces one token and one message per account', async () => {
      const shared = 'reset-two-schools@example.com';
      for (const schoolId of [fx.schoolA.id, fx.schoolB.id]) {
        await prisma.user.create({
          data: {
            schoolId,
            name: 'Works At Two Schools',
            email: shared,
            role: 'teacher',
            status: 'active',
            passwordHash: await bcrypt.hash(PASSWORD, 10),
          },
        });
      }

      const { sent } = await requestReset(shared);
      expect(sent).toHaveLength(2);
      // Each names its school, so the two messages are distinguishable.
      const bodies = sent.map((s) => s.text);
      expect(bodies.some((b) => b.includes(fx.schoolA.name))).toBe(true);
      expect(bodies.some((b) => b.includes(fx.schoolB.name))).toBe(true);
      // Two distinct tokens, one per account.
      const tokens = sent.map(extractResetToken);
      expect(new Set(tokens).size).toBe(2);
    });

    test('neither the token nor the reset link is ever logged', async () => {
      const logs = [];
      const capture = (...args) => logs.push(args.map(String).join(' '));
      const spies = [
        vi.spyOn(console, 'log').mockImplementation(capture),
        vi.spyOn(console, 'warn').mockImplementation(capture),
        vi.spyOn(console, 'error').mockImplementation(capture),
      ];

      const { token } = await requestReset(fx.schoolAdminA.email);
      spies.forEach((s) => s.mockRestore());

      const combined = logs.join('\n');
      expect(combined).not.toContain(token);
      expect(combined).not.toContain('/reset-password/');
      // Nor the recipient's full address — only its domain.
      expect(combined).not.toContain(fx.schoolAdminA.email);
    });
  });

  describe('reset-password', () => {
    // A dedicated user per case, so revoking sessions in one doesn't disturb another.
    let seq = 0;
    async function makeResettableUser() {
      seq += 1;
      const email = `reset-user-${seq}@example.com`;
      const user = await prisma.user.create({
        data: {
          schoolId: fx.schoolA.id,
          name: `Reset User ${seq}`,
          email,
          role: 'teacher',
          status: 'active',
          passwordHash: await bcrypt.hash(PASSWORD, 10),
        },
      });
      return user;
    }

    test('redeems the token, sets the new password, and revokes every existing session', async () => {
      const user = await makeResettableUser();

      // Sign in twice so there are two live sessions to invalidate.
      const first = await http.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      const second = await http.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const { token } = await requestReset(user.email);

      const res = await http
        .post('/api/auth/reset-password')
        .send({ token, password: 'my-brand-new-password' });
      expect(res.status).toBe(200);

      // The new password works...
      const relogin = await http
        .post('/api/auth/login')
        .send({ email: user.email, password: 'my-brand-new-password' });
      expect(relogin.status).toBe(200);

      // ...the old one does not...
      const oldPassword = await http.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      expect(oldPassword.status).toBe(401);

      // ...and both pre-reset refresh tokens are dead.
      for (const login of [first, second]) {
        const refresh = await http
          .post('/api/auth/refresh')
          .send({ refreshToken: login.body.refreshToken });
        expect(refresh.status).toBe(401);
      }
    });

    test('a token cannot be redeemed twice', async () => {
      const user = await makeResettableUser();
      const { token } = await requestReset(user.email);

      const first = await http.post('/api/auth/reset-password').send({ token, password: 'first-new-password' });
      expect(first.status).toBe(200);

      const second = await http.post('/api/auth/reset-password').send({ token, password: 'second-new-password' });
      expect(second.status).toBe(400);

      // The second attempt changed nothing.
      const login = await http.post('/api/auth/login').send({ email: user.email, password: 'first-new-password' });
      expect(login.status).toBe(200);
    });

    test('an expired token is refused', async () => {
      const user = await makeResettableUser();
      const { token } = await requestReset(user.email);

      await prisma.passwordResetToken.update({
        where: { tokenHash: hashToken(token) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await http.post('/api/auth/reset-password').send({ token, password: 'a-brand-new-password' });
      expect(res.status).toBe(400);

      // The old password still works — nothing was changed.
      const login = await http.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      expect(login.status).toBe(200);
    });

    test('an unknown token is refused with the same message as an expired one', async () => {
      const user = await makeResettableUser();
      const { token } = await requestReset(user.email);
      await prisma.passwordResetToken.update({
        where: { tokenHash: hashToken(token) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const expired = await http.post('/api/auth/reset-password').send({ token, password: 'a-brand-new-password' });
      const unknown = await http
        .post('/api/auth/reset-password')
        .send({ token: 'x'.repeat(43), password: 'a-brand-new-password' });

      expect(unknown.status).toBe(expired.status);
      expect(unknown.body).toEqual(expired.body);
    });

    test('a too-short new password is rejected and the token stays unused', async () => {
      const user = await makeResettableUser();
      const { token } = await requestReset(user.email);

      const res = await http.post('/api/auth/reset-password').send({ token, password: 'abc' });
      expect(res.status).toBe(400);

      const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
      expect(record.usedAt).toBeNull();
    });

    test('a malformed token reads like an expired one, not like raw schema text', async () => {
      const expiredLike = await http
        .post('/api/auth/reset-password')
        .send({ token: 'x'.repeat(40), password: 'a-good-password-1' });

      // Too short to even reach the lookup — the old behaviour leaked
      // "Too small: expected string to have >=20 characters" straight to the user.
      const malformed = await http
        .post('/api/auth/reset-password')
        .send({ token: 'too-short', password: 'a-good-password-1' });

      expect(malformed.status).toBe(400);
      expect(malformed.body).toEqual(expiredLike.body);
      expect(malformed.body.error).not.toMatch(/expected string|Too small/i);

      // A bad password still says what's actually wrong with it.
      const badPassword = await http
        .post('/api/auth/reset-password')
        .send({ token: 'x'.repeat(40), password: 'abc' });
      expect(badPassword.body.error).not.toEqual(expiredLike.body.error);
    });

    test('resetting clears a lockout, so a locked-out teacher can get straight back in', async () => {
      const user = await makeResettableUser();

      for (let i = 0; i < 5; i++) {
        await http.post('/api/auth/login').send({ email: user.email, password: 'wrong-password' });
      }
      const locked = await http.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
      expect(locked.status).toBe(423);

      const { token } = await requestReset(user.email);
      const reset = await http.post('/api/auth/reset-password').send({ token, password: 'a-brand-new-password' });
      expect(reset.status).toBe(200);

      const login = await http.post('/api/auth/login').send({ email: user.email, password: 'a-brand-new-password' });
      expect(login.status).toBe(200);
    });
  });
});
