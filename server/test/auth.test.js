const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PIN } = require('./helpers/fixtures');

describe('auth', () => {
  let fx;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'auth');
  });

  test('login with correct credentials succeeds and returns a working token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: fx.schoolA.code, name: fx.teacherA.name, pin: PIN });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe('teacher');
    expect(res.body.user.school.code).toBe(fx.schoolA.code);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(fx.teacherA.id);
  });

  test('login with wrong PIN is rejected', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: fx.schoolA.code, name: fx.teacherA2.name, pin: '000000' });
    expect(res.status).toBe(401);
  });

  test('login with unknown school code is rejected', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: 'NOPE-NOT-A-SCHOOL', name: fx.teacherA.name, pin: PIN });
    expect(res.status).toBe(401);
  });

  test('no token on a protected route is rejected', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('account locks after too many failed attempts, then unlocks after the window passes', async () => {
    // Use a dedicated user so this test doesn't disturb the lockout counters
    // other tests in this file rely on.
    const lockUser = await prisma.user.create({
      data: {
        schoolId: fx.schoolA.id,
        name: 'Lockout Test User',
        role: 'teacher',
        pinHash: await require('bcryptjs').hash(PIN, 10),
      },
    });

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/auth/login')
        .send({ schoolCode: fx.schoolA.code, name: lockUser.name, pin: '000000' });
    }

    const lockedRes = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: fx.schoolA.code, name: lockUser.name, pin: PIN }); // correct PIN, still locked
    expect(lockedRes.status).toBe(423);

    // Simulate the lockout window having already passed.
    await prisma.user.update({
      where: { id: lockUser.id },
      data: { lockedUntil: new Date(Date.now() - 1000) },
    });

    const unlockedRes = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: fx.schoolA.code, name: lockUser.name, pin: PIN });
    expect(unlockedRes.status).toBe(200);
  });

  test('register rejects a duplicate name at the same school', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ schoolCode: fx.schoolA.code, name: fx.teacherA.name, pin: PIN });
    expect(res.status).toBe(409);
  });

  test('register creates a new teacher under a valid school code', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ schoolCode: fx.schoolA.code, name: 'Brand New Teacher', pin: PIN });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('teacher');
  });

  test('PIN change requires the correct current PIN', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: fx.schoolA.code, name: fx.teacherA2.name, pin: PIN });
    const token = login.body.token;

    const wrong = await request(app)
      .patch('/api/auth/me/pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPin: '000000', newPin: '654321' });
    expect(wrong.status).toBe(401);

    const right = await request(app)
      .patch('/api/auth/me/pin')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPin: PIN, newPin: '654321' });
    expect(right.status).toBe(200);

    const reLogin = await request(app)
      .post('/api/auth/login')
      .send({ schoolCode: fx.schoolA.code, name: fx.teacherA2.name, pin: '654321' });
    expect(reLogin.status).toBe(200);
  });

  // Phase 3: exam-paper letterhead defaults (school name, teacher name,
  // default instructions, show date/time) live inside preferences.examPaperDefaults.
  describe('preferences.examPaperDefaults', () => {
    test('accepts and persists a full examPaperDefaults object, merged with other preferences', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ schoolCode: fx.schoolA.code, name: fx.teacherA.name, pin: PIN });
      const token = login.body.token;

      const res = await request(app)
        .patch('/api/auth/me')
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

      const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(me.body.user.preferences.examPaperDefaults.schoolName).toBe('Govt Model School');
    });

    test('rejects an unknown key inside examPaperDefaults (strict schema)', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ schoolCode: fx.schoolA.code, name: fx.teacherA.name, pin: PIN });
      const token = login.body.token;

      const res = await request(app)
        .patch('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ preferences: { examPaperDefaults: { schoolName: 'X', logoUrl: 'http://evil.example/x.png' } } });
      expect(res.status).toBe(400);
    });

    test('rejects a schoolName over the length cap', async () => {
      const login = await request(app)
        .post('/api/auth/login')
        .send({ schoolCode: fx.schoolA.code, name: fx.teacherA.name, pin: PIN });
      const token = login.body.token;

      const res = await request(app)
        .patch('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .send({ preferences: { examPaperDefaults: { schoolName: 'x'.repeat(121) } } });
      expect(res.status).toBe(400);
    });
  });
});
