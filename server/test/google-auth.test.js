// Google sign-up and sign-in via POST /auth/google.
//
// Google's signature check is the one thing stubbed — the same "replace the
// single network boundary, run everything else for real" approach
// helpers/geminiMock.js takes with fetch. Every route decision, the approval
// gate and issueSession() are exercised genuinely.
//
// The stub is a vi.spyOn over lib/googleAuth's exported verifyGoogleIdToken.
// The claim rules that function applies (verified email, required sub, and so
// on) aren't stubbed away with it — they're covered directly against the pure
// identityFromPayload in the last describe block.
const bcrypt = require('bcryptjs');
const { app, prisma } = require('./helpers/testApp');
const { makeClient } = require('./helpers/http');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const googleAuth = require('../src/lib/googleAuth');

// Each request gets its own synthetic client IP — see helpers/http.js.
const http = makeClient(app);

describe('Google sign-in', () => {
  let fx;
  let verifySpy;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'goog');
  });

  beforeEach(() => {
    verifySpy = vi.spyOn(googleAuth, 'verifyGoogleIdToken');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Makes the next verification succeed with these claims — run through the
  // real identityFromPayload, so a payload these tests treat as valid has to
  // actually satisfy the production rules.
  function googleIdentity({ sub, email, name = null, emailVerified = true }) {
    verifySpy.mockImplementation(async () =>
      googleAuth.identityFromPayload({ sub, email, name, email_verified: emailVerified })
    );
  }

  // Makes the next verification fail, the way a forged/expired token would.
  function googleRejects(message = 'Invalid token signature') {
    verifySpy.mockRejectedValue(new Error(message));
  }

  describe('token verification', () => {
    test('the ID token from the request body is what gets verified', async () => {
      googleIdentity({ sub: 'goog-aud-1', email: 'goog-aud@example.com' });
      await http.post('/api/auth/google').send({ idToken: 'a'.repeat(40) });

      expect(verifySpy).toHaveBeenCalledTimes(1);
      expect(verifySpy).toHaveBeenCalledWith('a'.repeat(40));
    });

    test('an unverifiable token is a 401', async () => {
      googleRejects();
      const res = await http.post('/api/auth/google').send({ idToken: 'a'.repeat(40) });
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/google sign-in failed/i);
    });

    test('a token whose email Google has NOT verified is refused', async () => {
      googleIdentity({ sub: 'goog-unverified-1', email: 'goog-unverified@example.com', emailVerified: false });
      const res = await http.post('/api/auth/google').send({
        idToken: 'a'.repeat(40),
        schoolCode: fx.schoolA.code,
      });
      expect(res.status).toBe(401);

      const created = await prisma.user.findFirst({ where: { email: 'goog-unverified@example.com' } });
      expect(created).toBeNull();
    });

    test('a missing token is a 400 and never reaches Google', async () => {
      const res = await http.post('/api/auth/google').send({});
      expect(res.status).toBe(400);
      expect(verifySpy).not.toHaveBeenCalled();
    });

    test('with no GOOGLE_CLIENT_ID configured the endpoint reports 503, leaving password login untouched', async () => {
      const original = process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_ID;
      try {
        const res = await http.post('/api/auth/google').send({ idToken: 'a'.repeat(40) });
        expect(res.status).toBe(503);
        expect(res.body.error).toBe('google_not_configured');
        expect(verifySpy).not.toHaveBeenCalled();

        // Email + password sign-in is a fully independent path.
        const login = await http
          .post('/api/auth/login')
          .send({ email: fx.teacherA.email, password: PASSWORD });
        expect(login.status).toBe(200);
      } finally {
        process.env.GOOGLE_CLIENT_ID = original;
      }
    });
  });

  describe('sign-up (schoolCode supplied)', () => {
    test('creates a pending Google account and issues NO session', async () => {
      googleIdentity({ sub: 'goog-signup-1', email: 'goog-signup@example.com', name: 'Google Signup' });

      const res = await http.post('/api/auth/google').send({
        idToken: 'a'.repeat(40),
        schoolCode: fx.schoolA.code,
        name: 'Form Supplied Name',
      });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('pending');
      expect(res.body.token).toBeUndefined();

      const created = await prisma.user.findFirst({ where: { email: 'goog-signup@example.com' } });
      expect(created.status).toBe('pending');
      expect(created.googleSub).toBe('goog-signup-1');
      expect(created.schoolId).toBe(fx.schoolA.id);
      expect(created.name).toBe('Form Supplied Name');
      // A Google account has no local password at all.
      expect(created.passwordHash).toBeNull();
      expect(await prisma.session.count({ where: { userId: created.id } })).toBe(0);
    });

    test('falls back to the name on the Google profile when the form sends none', async () => {
      googleIdentity({ sub: 'goog-signup-2', email: 'goog-name-fallback@example.com', name: 'Profile Name' });
      const res = await http.post('/api/auth/google').send({
        idToken: 'a'.repeat(40),
        schoolCode: fx.schoolA.code,
      });
      expect(res.status).toBe(201);

      const created = await prisma.user.findFirst({ where: { email: 'goog-name-fallback@example.com' } });
      expect(created.name).toBe('Profile Name');
    });

    test('the email and subject come from the VERIFIED token, never the request body', async () => {
      googleIdentity({ sub: 'goog-real-sub', email: 'goog-real@example.com', name: 'Real Person' });

      // A hand-written body claiming to be somebody else entirely.
      const res = await http.post('/api/auth/google').send({
        idToken: 'a'.repeat(40),
        schoolCode: fx.schoolA.code,
        email: 'attacker@example.com',
        googleSub: 'attacker-sub',
        role: 'super_admin',
        status: 'active',
      });
      expect(res.status).toBe(201);

      const created = await prisma.user.findFirst({ where: { googleSub: 'goog-real-sub' } });
      expect(created.email).toBe('goog-real@example.com');
      // The self-asserted role and status were ignored.
      expect(created.role).toBe('teacher');
      expect(created.status).toBe('pending');
      expect(await prisma.user.findFirst({ where: { email: 'attacker@example.com' } })).toBeNull();
    });

    test('an unknown school code is rejected and creates nothing', async () => {
      googleIdentity({ sub: 'goog-bad-school', email: 'goog-bad-school@example.com' });
      const res = await http.post('/api/auth/google').send({
        idToken: 'a'.repeat(40),
        schoolCode: 'NOPE-NOT-A-SCHOOL',
      });
      expect(res.status).toBe(400);
      expect(await prisma.user.findFirst({ where: { email: 'goog-bad-school@example.com' } })).toBeNull();
    });

    test('signing up twice at the same school is a 409', async () => {
      googleIdentity({ sub: 'goog-dupe-1', email: 'goog-dupe@example.com' });
      const first = await http.post('/api/auth/google').send({
        idToken: 'a'.repeat(40),
        schoolCode: fx.schoolA.code,
      });
      expect(first.status).toBe(201);

      googleIdentity({ sub: 'goog-dupe-1', email: 'goog-dupe@example.com' });
      const second = await http.post('/api/auth/google').send({
        idToken: 'a'.repeat(40),
        schoolCode: fx.schoolA.code,
      });
      expect(second.status).toBe(409);
    });

    test('a Google email that already has a PASSWORD account at that school is a 409, not a silent link', async () => {
      googleIdentity({ sub: 'goog-collide-1', email: fx.teacherA.email });
      const res = await http.post('/api/auth/google').send({
        idToken: 'a'.repeat(40),
        schoolCode: fx.schoolA.code,
      });
      expect(res.status).toBe(409);

      // The existing password account was left completely alone.
      const untouched = await prisma.user.findUnique({ where: { id: fx.teacherA.id } });
      expect(untouched.googleSub).toBeNull();
      expect(untouched.passwordHash).not.toBeNull();
    });
  });

  describe('sign-in (no schoolCode)', () => {
    // Registers via the real endpoint, then approves, so sign-in is tested
    // against an account that went through the whole flow.
    async function registerAndApprove({ sub, email, schoolId = fx.schoolA.id }) {
      const school = await prisma.school.findUnique({ where: { id: schoolId } });
      googleIdentity({ sub, email });
      const res = await http.post('/api/auth/google').send({
        idToken: 'a'.repeat(40),
        schoolCode: school.code,
      });
      expect(res.status).toBe(201);
      const user = await prisma.user.findFirst({ where: { googleSub: sub, schoolId } });
      await prisma.user.update({ where: { id: user.id }, data: { status: 'active' } });
      return user;
    }

    test('an approved Google account signs in and gets a working session', async () => {
      const user = await registerAndApprove({ sub: 'goog-in-1', email: 'goog-in-1@example.com' });

      googleIdentity({ sub: 'goog-in-1', email: 'goog-in-1@example.com' });
      const res = await http.post('/api/auth/google').send({ idToken: 'a'.repeat(40) });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      expect(res.body.user.id).toBe(user.id);
      expect(res.body.user.school.code).toBe(fx.schoolA.code);

      const me = await http.get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
      expect(me.status).toBe(200);
      expect(me.body.user.id).toBe(user.id);

      // lastLogin was recorded, same as a password sign-in.
      const after = await prisma.user.findUnique({ where: { id: user.id } });
      expect(after.lastLogin).not.toBeNull();
    });

    test('a pending Google sign-up cannot sign in yet', async () => {
      googleIdentity({ sub: 'goog-pending-1', email: 'goog-pending@example.com' });
      await http.post('/api/auth/google').send({
        idToken: 'a'.repeat(40),
        schoolCode: fx.schoolA.code,
      });

      googleIdentity({ sub: 'goog-pending-1', email: 'goog-pending@example.com' });
      const res = await http.post('/api/auth/google').send({ idToken: 'a'.repeat(40) });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('pending_approval');
    });

    test('a rejected Google sign-up cannot sign in', async () => {
      const user = await registerAndApprove({ sub: 'goog-rejected-1', email: 'goog-rejected@example.com' });
      await prisma.user.update({ where: { id: user.id }, data: { status: 'rejected' } });

      googleIdentity({ sub: 'goog-rejected-1', email: 'goog-rejected@example.com' });
      const res = await http.post('/api/auth/google').send({ idToken: 'a'.repeat(40) });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('registration_rejected');
    });

    test('a valid token with no account here reports google_not_registered', async () => {
      googleIdentity({ sub: 'goog-stranger-1', email: 'goog-stranger@example.com' });
      const res = await http.post('/api/auth/google').send({ idToken: 'a'.repeat(40) });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('google_not_registered');
    });

    test('a Google token whose email matches a PASSWORD account does not sign into it', async () => {
      // No googleSub was ever linked, so this identity is a stranger here — the
      // password account must stay unreachable via Google.
      googleIdentity({ sub: 'goog-no-autolink', email: fx.teacherA2.email });
      const res = await http.post('/api/auth/google').send({ idToken: 'a'.repeat(40) });
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('google_not_registered');
    });

    test('one Google identity at two schools asks which school, then signs into the chosen one', async () => {
      await registerAndApprove({ sub: 'goog-two-1', email: 'goog-two@example.com', schoolId: fx.schoolA.id });
      await registerAndApprove({ sub: 'goog-two-1', email: 'goog-two@example.com', schoolId: fx.schoolB.id });

      googleIdentity({ sub: 'goog-two-1', email: 'goog-two@example.com' });
      const picker = await http.post('/api/auth/google').send({ idToken: 'a'.repeat(40) });
      expect(picker.status).toBe(200);
      expect(picker.body.needsSchoolSelection).toBe(true);
      expect(picker.body.token).toBeUndefined();
      expect(picker.body.schools.map((s) => s.code).sort()).toEqual(
        [fx.schoolA.code, fx.schoolB.code].sort()
      );

      googleIdentity({ sub: 'goog-two-1', email: 'goog-two@example.com' });
      const chosen = await http
        .post('/api/auth/google')
        .send({ idToken: 'a'.repeat(40), schoolId: fx.schoolB.id });
      expect(chosen.status).toBe(200);
      expect(chosen.body.user.school.code).toBe(fx.schoolB.code);
    });
  });

  // Both methods must land on the same account model and the same gate, or
  // approving somebody would mean different things depending on how they joined.
  test('a Google account and a password account are approved through the same admin flow', async () => {
    googleIdentity({ sub: 'goog-parity-1', email: 'goog-parity-google@example.com' });
    const googleSignup = await http.post('/api/auth/google').send({
      idToken: 'a'.repeat(40),
      schoolCode: fx.schoolA.code,
    });
    expect(googleSignup.status).toBe(201);

    const passwordSignup = await http.post('/api/auth/register').send({
      schoolCode: fx.schoolA.code,
      name: 'Password Parity',
      email: 'goog-parity-password@example.com',
      password: 'a-good-password',
    });
    expect(passwordSignup.status).toBe(201);

    // Both appear in the same pending queue.
    const adminLogin = await http
      .post('/api/auth/login')
      .send({ email: fx.schoolAdminA.email, password: PASSWORD, schoolId: fx.schoolA.id });
    const pending = await http
      .get('/api/admin/users/pending')
      .set('Authorization', `Bearer ${adminLogin.body.token}`);
    expect(pending.status).toBe(200);

    const emails = pending.body.users.map((u) => u.email);
    expect(emails).toContain('goog-parity-google@example.com');
    expect(emails).toContain('goog-parity-password@example.com');
  });

  // Sanity check that stubbing Google didn't disturb the password path, which
  // shares this router.
  test('email + password sign-in still works alongside Google', async () => {
    const hashed = await bcrypt.hash(PASSWORD, 10);
    expect(await bcrypt.compare(PASSWORD, hashed)).toBe(true);

    const res = await http.post('/api/auth/login').send({ email: fx.teacherB.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  // The claim rules, tested directly rather than through the spy above — this
  // is the half of verifyGoogleIdToken that isn't Google's network call, so it
  // needs no mocking at all.
  describe('identityFromPayload', () => {
    const valid = { sub: '123456789', email: 'Someone@Example.COM', name: 'Some One', email_verified: true };

    test('returns the subject, a normalized email, and the name', () => {
      expect(googleAuth.identityFromPayload(valid)).toEqual({
        sub: '123456789',
        email: 'someone@example.com',
        name: 'Some One',
      });
    });

    test('accepts a payload that simply omits email_verified', () => {
      const { email_verified: _omitted, ...rest } = valid;
      expect(googleAuth.identityFromPayload(rest).email).toBe('someone@example.com');
    });

    test('rejects email_verified: false', () => {
      expect(() => googleAuth.identityFromPayload({ ...valid, email_verified: false })).toThrow(/not verified/i);
    });

    test.each([
      ['no payload at all', undefined],
      ['a missing subject', { email: 'a@b.com', email_verified: true }],
      ['a missing email', { sub: '1', email_verified: true }],
    ])('rejects %s', (_label, payload) => {
      expect(() => googleAuth.identityFromPayload(payload)).toThrow();
    });

    test('name is optional and normalizes to null', () => {
      const { name: _dropped, ...rest } = valid;
      expect(googleAuth.identityFromPayload(rest).name).toBeNull();
    });

    test('an over-long name is truncated to the column limit rather than rejected', () => {
      const identity = googleAuth.identityFromPayload({ ...valid, name: 'x'.repeat(200) });
      expect(identity.name).toHaveLength(60);
    });
  });
});
