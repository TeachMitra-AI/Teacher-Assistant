// Email + password authentication and sign-up.
//
// The credential model itself changed here (name + 6-digit PIN -> email +
// password), so these cases replace the old name/PIN ones rather than
// extending them. Identity is now the email address. schoolCode at sign-UP is
// now OPTIONAL: a caller that supplies one is placed at that school (covered
// below); the website no longer collects one, so a caller that omits it is
// placed at DEFAULT_REGISTRATION_SCHOOL_CODE automatically (routes/auth.js).
// New registrations land `active` and can sign in immediately; the
// pending/rejected approval gate (statusGateError in routes/auth.js) still
// exists and is still enforced for any account an admin later moves into one
// of those states.
const bcrypt = require('bcryptjs');
const { app, prisma } = require('./helpers/testApp');
const { makeClient } = require('./helpers/http');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');

// Each request gets its own synthetic client IP — see helpers/http.js.
const http = makeClient(app);

// Must match DEFAULT_REGISTRATION_SCHOOL_CODE in routes/auth.js. Created
// (idempotently) rather than assumed present, since this file's DB is a
// throwaway test DB that never runs seed.js.
const DEFAULT_REGISTRATION_SCHOOL_CODE = 'RAMPUR01';

describe('auth', () => {
  let fx;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'auth');
    await prisma.school.upsert({
      where: { code: DEFAULT_REGISTRATION_SCHOOL_CODE },
      update: {},
      create: { code: DEFAULT_REGISTRATION_SCHOOL_CODE, name: 'Default Registration School' },
    });
  });

  // Approves a pending user the way the admin endpoint does, without needing
  // an admin token — the approval endpoint's own RBAC is covered in rbac.test.js.
  async function activate(email) {
    await prisma.user.updateMany({ where: { email }, data: { status: 'active' } });
  }

  describe('login', () => {
    test('correct email + password succeeds and returns a working token — no school code needed', async () => {
      const res = await http.post('/api/auth/login')
        .send({ email: fx.teacherA.email, password: PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      expect(res.body.user.role).toBe('teacher');
      expect(res.body.user.email).toBe(fx.teacherA.email);
      expect(res.body.user.school.code).toBe(fx.schoolA.code);

      const me = await http.get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
      expect(me.status).toBe(200);
      expect(me.body.user.id).toBe(fx.teacherA.id);
    });

    test('email is matched case-insensitively', async () => {
      const res = await http.post('/api/auth/login')
        .send({ email: fx.teacherA.email.toUpperCase(), password: PASSWORD });
      expect(res.status).toBe(200);
    });

    test('wrong password is rejected', async () => {
      const res = await http.post('/api/auth/login')
        .send({ email: fx.teacherA2.email, password: 'definitely-not-it' });
      expect(res.status).toBe(401);
    });

    test('unknown email is rejected with the same generic message as a wrong password', async () => {
      const wrongPassword = await http.post('/api/auth/login')
        .send({ email: fx.teacherA2.email, password: 'definitely-not-it' });
      const unknownEmail = await http.post('/api/auth/login')
        .send({ email: 'nobody-at-all@example.com', password: PASSWORD });

      expect(unknownEmail.status).toBe(401);
      expect(unknownEmail.body.error).toBe(wrongPassword.body.error);
    });

    test('a malformed email is a 400, not a 401', async () => {
      const res = await http.post('/api/auth/login').send({ email: 'not-an-email', password: PASSWORD });
      expect(res.status).toBe(400);
    });

    test('no token on a protected route is rejected', async () => {
      const res = await http.get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    test('account locks after too many failed attempts, then unlocks after the window passes', async () => {
      // Dedicated user so this doesn't disturb the lockout counters other
      // tests in this file rely on.
      const email = 'auth-lockout@example.com';
      const lockUser = await prisma.user.create({
        data: {
          schoolId: fx.schoolA.id,
          name: 'Lockout Test User',
          email,
          role: 'teacher',
          status: 'active',
          passwordHash: await bcrypt.hash(PASSWORD, 10),
        },
      });

      for (let i = 0; i < 5; i++) {
        await http.post('/api/auth/login').send({ email, password: 'wrong-password' });
      }

      const lockedRes = await http.post('/api/auth/login')
        .send({ email, password: PASSWORD }); // correct password, still locked
      expect(lockedRes.status).toBe(423);

      // Simulate the lockout window having already passed.
      await prisma.user.update({
        where: { id: lockUser.id },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });

      const unlockedRes = await http.post('/api/auth/login').send({ email, password: PASSWORD });
      expect(unlockedRes.status).toBe(200);
    });
  });

  describe('register', () => {
    test('creates an active account and issues NO session of its own', async () => {
      const res = await http.post('/api/auth/register').send({
        schoolCode: fx.schoolA.code,
        name: 'Brand New Teacher',
        email: 'auth-brand-new@example.com',
        password: 'a-good-password',
      });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('active');
      expect(res.body.token).toBeUndefined();
      expect(res.body.refreshToken).toBeUndefined();
      expect(res.body.user).toBeUndefined();

      const created = await prisma.user.findFirst({ where: { email: 'auth-brand-new@example.com' } });
      expect(created.status).toBe('active');
      expect(created.role).toBe('teacher');
      expect(created.schoolId).toBe(fx.schoolA.id);
      // The password is stored hashed, never in the clear.
      expect(created.passwordHash).not.toBe('a-good-password');
      expect(await bcrypt.compare('a-good-password', created.passwordHash)).toBe(true);
      // Registration itself still issues no session — the client makes a
      // separate /auth/login call with the same credentials.
      expect(await prisma.session.count({ where: { userId: created.id } })).toBe(0);
    });

    test('omitting schoolCode assigns the default registration school automatically', async () => {
      const res = await http.post('/api/auth/register').send({
        name: 'No School Code',
        email: 'auth-no-school-code@example.com',
        password: 'a-good-password',
      });

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('active');

      const created = await prisma.user.findFirst({ where: { email: 'auth-no-school-code@example.com' } });
      const defaultSchool = await prisma.school.findUnique({ where: { code: DEFAULT_REGISTRATION_SCHOOL_CODE } });
      expect(created.schoolId).toBe(defaultSchool.id);

      // The account works exactly like any other — it can log in right away.
      const login = await http.post('/api/auth/login')
        .send({ email: 'auth-no-school-code@example.com', password: 'a-good-password' });
      expect(login.status).toBe(200);
      expect(login.body.user.school.code).toBe(DEFAULT_REGISTRATION_SCHOOL_CODE);
    });

    test('a caller that still supplies a schoolCode is placed at that school, not the default', async () => {
      const res = await http.post('/api/auth/register').send({
        schoolCode: fx.schoolB.code,
        name: 'Explicit School',
        email: 'auth-explicit-school@example.com',
        password: 'a-good-password',
      });
      expect(res.status).toBe(201);

      const created = await prisma.user.findFirst({ where: { email: 'auth-explicit-school@example.com' } });
      expect(created.schoolId).toBe(fx.schoolB.id);
    });

    test('a newly registered account can log in immediately, without any admin action', async () => {
      await http.post('/api/auth/register').send({
        schoolCode: fx.schoolA.code,
        name: 'Signs In Right Away',
        email: 'auth-immediate@example.com',
        password: 'a-good-password',
      });

      const res = await http.post('/api/auth/login')
        .send({ email: 'auth-immediate@example.com', password: 'a-good-password' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    });

    test('the approval gate is still enforced for an account an admin has set to pending', async () => {
      await http.post('/api/auth/register').send({
        schoolCode: fx.schoolA.code,
        name: 'Awaiting Approval',
        email: 'auth-pending@example.com',
        password: 'a-good-password',
      });
      // Registration no longer produces this state on its own; simulate an
      // admin having moved the account back into it.
      await prisma.user.updateMany({ where: { email: 'auth-pending@example.com' }, data: { status: 'pending' } });

      const res = await http.post('/api/auth/login')
        .send({ email: 'auth-pending@example.com', password: 'a-good-password' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('pending_approval');
    });

    test('login after re-approval succeeds', async () => {
      await http.post('/api/auth/register').send({
        schoolCode: fx.schoolA.code,
        name: 'Soon Approved',
        email: 'auth-approved@example.com',
        password: 'a-good-password',
      });
      await prisma.user.updateMany({ where: { email: 'auth-approved@example.com' }, data: { status: 'pending' } });
      await activate('auth-approved@example.com');

      const res = await http.post('/api/auth/login')
        .send({ email: 'auth-approved@example.com', password: 'a-good-password' });
      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    });

    test('login on a rejected account is refused with registration_rejected', async () => {
      await http.post('/api/auth/register').send({
        schoolCode: fx.schoolA.code,
        name: 'Turned Away',
        email: 'auth-rejected@example.com',
        password: 'a-good-password',
      });
      await prisma.user.updateMany({
        where: { email: 'auth-rejected@example.com' },
        data: { status: 'rejected' },
      });

      const res = await http.post('/api/auth/login')
        .send({ email: 'auth-rejected@example.com', password: 'a-good-password' });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('registration_rejected');
    });

    test('a duplicate email at the same school is a 409', async () => {
      const res = await http.post('/api/auth/register').send({
        schoolCode: fx.schoolA.code,
        name: 'Someone Else Entirely',
        email: fx.teacherA.email,
        password: 'a-good-password',
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already/i);
    });

    test('the SAME name at the same school is fine — name is no longer the identity key', async () => {
      const res = await http.post('/api/auth/register').send({
        schoolCode: fx.schoolA.code,
        name: fx.teacherA.name, // deliberately colliding display name
        email: 'auth-same-name@example.com',
        password: 'a-good-password',
      });
      expect(res.status).toBe(201);
    });

    test('an unknown school code is rejected', async () => {
      const res = await http.post('/api/auth/register').send({
        schoolCode: 'NOPE-NOT-A-SCHOOL',
        name: 'Nowhere Teacher',
        email: 'auth-nowhere@example.com',
        password: 'a-good-password',
      });
      expect(res.status).toBe(400);
    });

    test('a malformed email and a too-short password are both rejected', async () => {
      const badEmail = await http.post('/api/auth/register').send({
        schoolCode: fx.schoolA.code,
        name: 'Bad Email',
        email: 'not-an-email',
        password: 'a-good-password',
      });
      expect(badEmail.status).toBe(400);

      const shortPassword = await http.post('/api/auth/register').send({
        schoolCode: fx.schoolA.code,
        name: 'Short Password',
        email: 'auth-short-pw@example.com',
        password: 'abc',
      });
      expect(shortPassword.status).toBe(400);
    });
  });

  // The same email may legitimately hold accounts at more than one school, so
  // sign-in cannot resolve it by email alone — the client gets a school picker
  // and re-submits with an explicit schoolId.
  describe('one email, accounts at two schools', () => {
    const shared = 'auth-two-schools@example.com';

    beforeAll(async () => {
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
    });

    test('login without a schoolId asks which school, and issues no session', async () => {
      const res = await http.post('/api/auth/login').send({ email: shared, password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body.needsSchoolSelection).toBe(true);
      expect(res.body.token).toBeUndefined();
      expect(res.body.schools).toHaveLength(2);
      expect(res.body.schools.map((s) => s.code).sort()).toEqual(
        [fx.schoolA.code, fx.schoolB.code].sort()
      );
    });

    test('re-submitting with an explicit schoolId signs into that school', async () => {
      const res = await http.post('/api/auth/login')
        .send({ email: shared, password: PASSWORD, schoolId: fx.schoolB.id });
      expect(res.status).toBe(200);
      expect(res.body.user.school.code).toBe(fx.schoolB.code);
    });

    test('a schoolId the email has no account at is rejected', async () => {
      const otherSchool = await prisma.school.create({
        data: { code: 'AUTHNOACCT', name: 'No Account Here', district: 'auth-district-3' },
      });
      const res = await http.post('/api/auth/login')
        .send({ email: shared, password: PASSWORD, schoolId: otherSchool.id });
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /api/auth/me/password', () => {
    test('requires the correct current password, and the new one then works', async () => {
      const login = await http.post('/api/auth/login')
        .send({ email: fx.teacherA2.email, password: PASSWORD });
      const token = login.body.token;

      const wrong = await http.patch('/api/auth/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'not-the-current-one', newPassword: 'brand-new-password' });
      expect(wrong.status).toBe(401);

      const right = await http.patch('/api/auth/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: PASSWORD, newPassword: 'brand-new-password' });
      expect(right.status).toBe(200);

      const reLogin = await http.post('/api/auth/login')
        .send({ email: fx.teacherA2.email, password: 'brand-new-password' });
      expect(reLogin.status).toBe(200);

      // Restore the fixture password so later test files/cases are unaffected.
      await http.patch('/api/auth/me/password')
        .set('Authorization', `Bearer ${reLogin.body.token}`)
        .send({ currentPassword: 'brand-new-password', newPassword: PASSWORD });
    });

    test('a too-short new password is rejected', async () => {
      const login = await http.post('/api/auth/login')
        .send({ email: fx.teacherA.email, password: PASSWORD });

      const res = await http.patch('/api/auth/me/password')
        .set('Authorization', `Bearer ${login.body.token}`)
        .send({ currentPassword: PASSWORD, newPassword: 'abc' });
      expect(res.status).toBe(400);
    });

    test('a Google-only account (no local password) cannot use this endpoint', async () => {
      const googleOnly = await prisma.user.create({
        data: {
          schoolId: fx.schoolA.id,
          name: 'Google Only',
          email: 'auth-google-only@example.com',
          role: 'teacher',
          status: 'active',
          googleSub: 'auth-google-sub-1',
        },
      });
      const { signAccessToken } = require('../src/middleware/auth');
      const token = signAccessToken(googleOnly);

      const res = await http.patch('/api/auth/me/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'anything', newPassword: 'brand-new-password' });
      expect(res.status).toBe(400);
    });
  });

  // Phase 3: exam-paper letterhead defaults (school name, teacher name,
  // default instructions, show date/time) live inside preferences.examPaperDefaults.
  describe('preferences.examPaperDefaults', () => {
    let token;

    beforeAll(async () => {
      const login = await http.post('/api/auth/login')
        .send({ email: fx.teacherA.email, password: PASSWORD });
      token = login.body.token;
    });

    test('accepts and persists a full examPaperDefaults object, merged with other preferences', async () => {
      const res = await http.patch('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({
          preferences: {
            defaultGrade: 'Class 6-8',
            examPaperDefaults: {
              schoolName: 'Govt Model School',
              teacherName: 'A. Teacher',
              defaultInstructions: 'Answer all questions neatly.',
              showDate: true,
              showTime: false,
            },
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.user.preferences.examPaperDefaults).toEqual({
        schoolName: 'Govt Model School',
        teacherName: 'A. Teacher',
        defaultInstructions: 'Answer all questions neatly.',
        showDate: true,
        showTime: false,
      });
      // Sibling preference untouched by the merge.
      expect(res.body.user.preferences.defaultGrade).toBe('Class 6-8');

      const me = await http.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(me.body.user.preferences.examPaperDefaults.schoolName).toBe('Govt Model School');
    });

    test('rejects an unknown key inside examPaperDefaults (strict schema)', async () => {
      const res = await http.patch('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ preferences: { examPaperDefaults: { schoolName: 'X', logoUrl: 'http://evil.example/x.png' } } });
      expect(res.status).toBe(400);
    });

    test('rejects a schoolName over the length cap', async () => {
      const res = await http.patch('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ preferences: { examPaperDefaults: { schoolName: 'x'.repeat(121) } } });
      expect(res.status).toBe(400);
    });
  });

  // Phase 0 of the onboarding rework: first-run onboarding state lives inside
  // preferences.onboarding (seenWelcomeIntro flag + dismissedTips list). No UI
  // consumes it yet — these tests only lock in that the persistence plumbing
  // round-trips and stays backward-compatible with existing preferences.
  describe('preferences.onboarding', () => {
    let token;

    beforeAll(async () => {
      const login = await http.post('/api/auth/login')
        .send({ email: fx.teacherA.email, password: PASSWORD });
      token = login.body.token;
    });

    test('accepts and persists onboarding state, merged with other preferences', async () => {
      const res = await http.patch('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({
          preferences: {
            defaultSubject: 'Science',
            onboarding: {
              seenWelcomeIntro: true,
              dismissedTips: ['workspace-assist', 'generator-letterhead'],
            },
          },
        });
      expect(res.status).toBe(200);
      expect(res.body.user.preferences.onboarding).toEqual({
        seenWelcomeIntro: true,
        dismissedTips: ['workspace-assist', 'generator-letterhead'],
      });
      // Sibling preference untouched by the merge.
      expect(res.body.user.preferences.defaultSubject).toBe('Science');

      const me = await http.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(me.body.user.preferences.onboarding.seenWelcomeIntro).toBe(true);
    });

    test('leaves an unrelated preference (examPaperDefaults) intact when only onboarding is patched', async () => {
      await http.patch('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ preferences: { examPaperDefaults: { schoolName: 'Sibling School' } } });

      const res = await http.patch('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ preferences: { onboarding: { seenWelcomeIntro: true } } });
      expect(res.status).toBe(200);
      expect(res.body.user.preferences.examPaperDefaults.schoolName).toBe('Sibling School');
    });

    test('rejects an unknown key inside onboarding (strict schema)', async () => {
      const res = await http.patch('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ preferences: { onboarding: { seenWelcomeIntro: true, completedTour: true } } });
      expect(res.status).toBe(400);
    });

    test('rejects a non-boolean seenWelcomeIntro', async () => {
      const res = await http.patch('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ preferences: { onboarding: { seenWelcomeIntro: 'yes' } } });
      expect(res.status).toBe(400);
    });

    test('rejects a dismissedTips entry over the length cap', async () => {
      const res = await http.patch('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ preferences: { onboarding: { dismissedTips: ['x'.repeat(61)] } } });
      expect(res.status).toBe(400);
    });
  });
});
