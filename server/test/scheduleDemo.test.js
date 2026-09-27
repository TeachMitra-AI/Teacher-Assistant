// POST/GET/PATCH /api/schedule-demo/* and GET /api/admin/demo-bookings, end
// to end. Same env-flipping-per-test approach as support.test.js: flags and
// config are read per-request, not cached at boot.
const request = require('supertest');

const { app, prisma } = require('./helpers/testApp');
const { createFixtures } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');
const { mockEmailFetch } = require('./helpers/emailMock');

const DEMO_BOOKING_ENV_KEYS = [
  'DEMO_BOOKING_ENABLED',
  'DEMO_BOOKING_WORK_DAYS',
  'DEMO_BOOKING_START_TIME',
  'DEMO_BOOKING_END_TIME',
  'DEMO_BOOKING_SLOT_MINUTES',
  'DEMO_BOOKING_MIN_NOTICE_HOURS',
  'DEMO_BOOKING_ADMIN_EMAIL',
];

let fixtures;
let superAdminToken;
let savedEnv;

function enableDemoBooking(overrides = {}) {
  process.env.DEMO_BOOKING_ENABLED = 'true';
  process.env.DEMO_BOOKING_MIN_NOTICE_HOURS = '0';
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearDemoBookingEnv() {
  for (const key of DEMO_BOOKING_ENV_KEYS) delete process.env[key];
}

// "YYYY-MM-DD" from a Date's LOCAL calendar fields — never .toISOString(),
// which reads UTC and can silently shift to the previous/next day relative
// to the local getDay() these helpers select by (this bit us once already:
// a local Saturday just after midnight IST is still Friday in UTC).
function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Finds the next Monday-Friday date (as "YYYY-MM-DD") from today, so tests
// never depend on which day they happen to run.
function nextWeekday() {
  const date = new Date();
  do {
    date.setDate(date.getDate() + 1);
  } while (date.getDay() === 0 || date.getDay() === 6);
  return toDateKey(date);
}

beforeAll(async () => {
  // Lowercase prefix only — auth.js's login route lowercases the submitted
  // email before querying (emailField's .toLowerCase()), so a mixed-case
  // prefix here would create a user whose stored email never matches what
  // loginAs's plain HTTP call ends up querying for.
  fixtures = await createFixtures(prisma, 'demobooking');
  superAdminToken = await loginAs(app, fixtures.schoolA, fixtures.superAdmin, fixtures.PASSWORD);
  savedEnv = Object.fromEntries(DEMO_BOOKING_ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  clearDemoBookingEnv();
});

describe('Schedule a Call — disabled by default', () => {
  test('GET /api/schedule-demo/config returns 503', async () => {
    const res = await request(app).get('/api/schedule-demo/config');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('DEMO_BOOKING_DISABLED');
  });

  test('POST /api/schedule-demo/bookings returns 503 and writes nothing', async () => {
    const before = await prisma.demoBooking.count();
    const res = await request(app).post('/api/schedule-demo/bookings').send({
      name: 'Asha', email: 'asha@example.com', organization: 'Test School',
      role: 'school_admin', date: nextWeekday(), startTime: '10:00',
    });
    expect(res.status).toBe(503);
    expect(await prisma.demoBooking.count()).toBe(before);
  });
});

describe('GET /api/schedule-demo/slots', () => {
  test('excludes an already-booked time and returns [] for a weekend date', async () => {
    enableDemoBooking();
    const date = nextWeekday();

    await prisma.demoBooking.create({
      data: {
        name: 'Existing', email: 'existing@example.com', organization: 'Org',
        role: 'school_admin', date, startTime: '10:00', cancelToken: 'tok-existing',
      },
    });

    const res = await request(app).get('/api/schedule-demo/slots').query({ date });
    expect(res.status).toBe(200);
    expect(res.body.slots).not.toContain('10:00');
    expect(res.body.slots).toContain('10:30');

    // Find the next Saturday/Sunday.
    const weekend = new Date();
    do {
      weekend.setDate(weekend.getDate() + 1);
    } while (weekend.getDay() !== 6);
    const weekendRes = await request(app)
      .get('/api/schedule-demo/slots')
      .query({ date: toDateKey(weekend) });
    expect(weekendRes.body.slots).toEqual([]);
  });
});

describe('POST /api/schedule-demo/bookings', () => {
  test('creates a booking and sends the confirmation + admin alert emails', async () => {
    enableDemoBooking({ DEMO_BOOKING_ADMIN_EMAIL: 'team@sarastech.co.in' });
    const { sent } = mockEmailFetch();
    process.env.BREVO_API_KEY = 'test-key';
    const date = nextWeekday();

    const res = await request(app).post('/api/schedule-demo/bookings').send({
      name: 'Asha Verma', email: 'asha@example.com', organization: 'Green Valley School',
      role: 'school_admin', notes: 'Rolling out to 20 teachers.', date, startTime: '14:00',
    });

    expect(res.status).toBe(201);
    expect(res.body.booking.date).toBe(date);
    expect(res.body.manageUrl).toContain(res.body.booking.id);

    const booking = await prisma.demoBooking.findUnique({ where: { id: res.body.booking.id } });
    expect(booking.email).toBe('asha@example.com');
    expect(booking.status).toBe('confirmed');
    expect(typeof booking.cancelToken).toBe('string');

    expect(sent).toHaveLength(2);
    expect(sent.some((m) => m.to === 'asha@example.com')).toBe(true);
    expect(sent.some((m) => m.to === 'team@sarastech.co.in')).toBe(true);

    delete process.env.BREVO_API_KEY;
  });

  test('rejects a double-booked slot with 409 and leaves the first booking intact', async () => {
    enableDemoBooking();
    const date = nextWeekday();

    const first = await request(app).post('/api/schedule-demo/bookings').send({
      name: 'First', email: 'first@example.com', organization: 'Org A',
      role: 'school_admin', date, startTime: '11:00',
    });
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/schedule-demo/bookings').send({
      name: 'Second', email: 'second@example.com', organization: 'Org B',
      role: 'school_admin', date, startTime: '11:00',
    });
    expect(second.status).toBe(409);

    const bookings = await prisma.demoBooking.findMany({ where: { date, startTime: '11:00' } });
    expect(bookings).toHaveLength(1);
    expect(bookings[0].email).toBe('first@example.com');
  });

  test('rejects an unknown field (.strict())', async () => {
    enableDemoBooking();
    const res = await request(app).post('/api/schedule-demo/bookings').send({
      name: 'Asha', email: 'asha@example.com', organization: 'Org',
      role: 'school_admin', date: nextWeekday(), startTime: '10:00', budget: '$$$',
    });
    expect(res.status).toBe(400);
  });
});

describe('Reschedule and cancel', () => {
  // Each call books a DIFFERENT time — bookings created by earlier tests in
  // this file are never cleaned up (one shared DB for the whole file), so
  // reusing a time here would spuriously 409 against a still-confirmed row
  // from another test.
  async function createBooking(startTime) {
    enableDemoBooking();
    const date = nextWeekday();
    const res = await request(app).post('/api/schedule-demo/bookings').send({
      name: 'Asha', email: 'asha@example.com', organization: 'Org',
      role: 'school_admin', date, startTime,
    });
    return res.body.booking;
  }

  test('a wrong token 404s instead of leaking that the booking exists', async () => {
    const booking = await createBooking('15:00');
    const res = await request(app).get(`/api/schedule-demo/bookings/${booking.id}`).query({ token: 'wrong' });
    expect(res.status).toBe(404);
  });

  test('cancel frees the slot for reuse', async () => {
    const booking = await createBooking('16:00');
    const full = await prisma.demoBooking.findUnique({ where: { id: booking.id } });

    const cancelRes = await request(app)
      .post(`/api/schedule-demo/bookings/${booking.id}/cancel`)
      .query({ token: full.cancelToken });
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.booking.status).toBe('cancelled');

    const rebooked = await request(app).post('/api/schedule-demo/bookings').send({
      name: 'Someone Else', email: 'someone@example.com', organization: 'Org 2',
      role: 'org_leadership', date: booking.date, startTime: '16:00',
    });
    expect(rebooked.status).toBe(201);
  });
});

describe('GET /api/admin/demo-bookings', () => {
  test('requires super_admin', async () => {
    const teacherToken = await loginAs(app, fixtures.schoolA, fixtures.teacherA, fixtures.PASSWORD);
    const res = await request(app).get('/api/admin/demo-bookings').set('Authorization', `Bearer ${teacherToken}`);
    expect(res.status).toBe(403);
  });

  test('lists bookings for super_admin', async () => {
    enableDemoBooking();
    const date = nextWeekday();
    await request(app).post('/api/schedule-demo/bookings').send({
      name: 'Asha', email: 'asha@example.com', organization: 'Org',
      role: 'school_admin', date, startTime: '13:00',
    });

    const res = await request(app)
      .get('/api/admin/demo-bookings')
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.bookings.length).toBeGreaterThan(0);
  });

  test('q searches by name, email, and organization', async () => {
    enableDemoBooking();
    const date = nextWeekday();
    await request(app).post('/api/schedule-demo/bookings').send({
      name: 'Unique Searchable Name', email: 'findme@example.com', organization: 'Findable Org',
      role: 'school_admin', date, startTime: '16:30',
    });

    const res = await request(app)
      .get('/api/admin/demo-bookings')
      .query({ q: 'Findable Org' })
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.bookings.some((b) => b.email === 'findme@example.com')).toBe(true);

    const noMatch = await request(app)
      .get('/api/admin/demo-bookings')
      .query({ q: 'no-such-organization-xyz' })
      .set('Authorization', `Bearer ${superAdminToken}`);
    expect(noMatch.body.bookings).toHaveLength(0);
  });
});
