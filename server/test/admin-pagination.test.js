// Pagination, search, and filtering on the admin list endpoints
// (audit items P3 / B5). Two distinct things are under test here:
//
//   1. Boundedness. The server-side page-size clamp is the actual control —
//      if a client could ask for `limit=100000` and get it, pagination would
//      be opt-in and the unbounded-payload problem would still be reachable.
//   2. That none of the new query parameters can widen the caller's school
//      scope. `q`, `role`, `status`, and `schoolId` are all new surface on a
//      tenant boundary, so each gets an explicit cross-school assertion.
const request = require('supertest');
const { app, prisma } = require('./helpers/testApp');
const { createFixtures, PASSWORD } = require('./helpers/fixtures');
const { loginAs } = require('./helpers/auth');

const MAX_PAGE_SIZE = 100;

// Every bulk row created by this file carries this marker in its email, so
// `?q=` can isolate them from the fixture users this file (and every other
// test file, on the shared throwaway DB) also creates.
const MARKER = 'pgnbulk';
const BULK_COUNT = 12;

describe('admin list pagination', () => {
  let fx;
  let superAdminToken;
  let schoolAdminAToken;
  let resourcePersonAToken;
  let bulkIds;

  beforeAll(async () => {
    fx = await createFixtures(prisma, 'pgn');
    superAdminToken = await loginAs(app, fx.schoolA, fx.superAdmin, PASSWORD);
    schoolAdminAToken = await loginAs(app, fx.schoolA, fx.schoolAdminA, PASSWORD);
    resourcePersonAToken = await loginAs(app, fx.schoolA, fx.resourcePersonA, PASSWORD);

    // All bulk users share one createdAt to the millisecond. This is the
    // condition that makes an unstable sort visible: ordering by createdAt
    // alone leaves ties in an engine-defined order that can differ between
    // the page-1 and page-2 queries, so a row can appear on both pages or on
    // neither. A real seed script or bulk import produces exactly this.
    const sharedCreatedAt = new Date('2026-03-01T00:00:00.000Z');
    bulkIds = [];
    for (let i = 0; i < BULK_COUNT; i += 1) {
      const u = await prisma.user.create({
        data: {
          schoolId: fx.schoolA.id,
          name: `Bulk Teacher ${String(i).padStart(2, '0')}`,
          email: `${MARKER}-${String(i).padStart(2, '0')}@example.com`,
          role: 'teacher',
          status: 'active',
          passwordHash: 'not-used-by-these-tests',
          createdAt: sharedCreatedAt,
        },
      });
      bulkIds.push(u.id);
    }
  });

  function asSuper(req) {
    return req.set('Authorization', `Bearer ${superAdminToken}`);
  }
  function asSchoolAdminA(req) {
    return req.set('Authorization', `Bearer ${schoolAdminAToken}`);
  }

  describe('page-size clamp', () => {
    test('GET /users caps an absurd limit at MAX_PAGE_SIZE', async () => {
      const res = await asSuper(request(app).get('/api/admin/users?limit=100000'));
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(MAX_PAGE_SIZE);
      expect(res.body.users.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    });

    test('GET /schools caps an absurd limit at MAX_PAGE_SIZE', async () => {
      const res = await asSuper(request(app).get('/api/admin/schools?limit=100000'));
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(MAX_PAGE_SIZE);
      expect(res.body.schools.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
    });

    test('GET /users/pending caps an absurd limit at MAX_PAGE_SIZE', async () => {
      const res = await asSuper(request(app).get('/api/admin/users/pending?limit=100000'));
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(MAX_PAGE_SIZE);
    });

    // Garbage, zero, and negative values must land on a valid page rather
        // than reaching Prisma as NaN/negative `take`/`skip`.
    test.each([
      ['limit=0', 'limit=0'],
      ['limit=-5', 'limit=-5'],
      ['limit=abc', 'limit=abc'],
      ['page=0', 'page=0'],
      ['page=-3', 'page=-3'],
      ['page=abc', 'page=abc'],
    ])('GET /users survives %s', async (_label, qs) => {
      const res = await asSuper(request(app).get(`/api/admin/users?${qs}`));
      expect(res.status).toBe(200);
      expect(res.body.limit).toBeGreaterThanOrEqual(1);
      expect(res.body.limit).toBeLessThanOrEqual(MAX_PAGE_SIZE);
      expect(res.body.page).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(res.body.users)).toBe(true);
    });
  });

  describe('default page size', () => {
    // Pinned deliberately. This default dropped from 100 to 25 once the client
    // gained pager controls, and it is the value any caller that omits `limit`
    // gets — including a curl or a future integration. A silent change to it
    // would silently change how much data every such caller receives.
    test('omitting limit yields DEFAULT_PAGE_SIZE, not everything', async () => {
      const res = await asSuper(request(app).get('/api/admin/users'));
      expect(res.status).toBe(200);
      expect(res.body.limit).toBe(25);
      expect(res.body.users.length).toBeLessThanOrEqual(25);
    });

    test('the default applies to every listing', async () => {
      for (const path of ['/api/admin/users', '/api/admin/users/pending', '/api/admin/schools']) {
        const res = await asSuper(request(app).get(path));
        expect(res.status).toBe(200);
        expect(res.body.limit).toBe(25);
      }
    });
  });

  describe('response shape', () => {
    // The client stopped rendering a "Questions" column, so the per-school
    // Query count — one correlated aggregate over the largest table in the
    // schema, per row — is no longer selected. Asserted so it cannot drift
    // back in unnoticed.
    test('GET /schools returns a teacher count but no per-school query count', async () => {
      const res = await asSuper(request(app).get('/api/admin/schools?limit=5'));
      expect(res.status).toBe(200);
      expect(res.body.schools.length).toBeGreaterThan(0);
      for (const s of res.body.schools) {
        expect(typeof s.users).toBe('number');
        expect(s.queries).toBeUndefined();
      }
    });

    test('GET /users returns total/page/limit alongside the rows', async () => {
      const res = await asSuper(request(app).get('/api/admin/users?limit=5'));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ page: 1, limit: 5 });
      expect(typeof res.body.total).toBe('number');
      expect(res.body.users.length).toBeLessThanOrEqual(5);
      // `total` counts matching rows, not the page.
      expect(res.body.total).toBeGreaterThan(res.body.users.length);
    });

    test('a page past the end is an empty list, not an error', async () => {
      const res = await asSuper(request(app).get('/api/admin/users?q=pgnbulk&page=99&limit=5'));
      expect(res.status).toBe(200);
      expect(res.body.users).toEqual([]);
      expect(res.body.total).toBe(BULK_COUNT);
    });

    test('listings still never leak credential material', async () => {
      const res = await asSuper(request(app).get('/api/admin/users?limit=100'));
      expect(res.status).toBe(200);
      for (const u of res.body.users) {
        expect(u.passwordHash).toBeUndefined();
        expect(u.googleSub).toBeUndefined();
        expect(u.pinHash).toBeUndefined();
      }
    });
  });

  // Regression tests for the createdAt tiebreaker, over BULK_COUNT rows that
  // all share one createdAt.
  //
  // Set equality alone is NOT a sufficient guard: SQLite happens to return
  // tied rows in a stable incidental order (rowid), so dropping the `id`
  // tiebreaker still yields complete, duplicate-free pages *on SQLite*. The
  // order assertion below is what actually pins the behaviour — it fails
  // immediately if the tiebreaker is removed, because the incidental rowid
  // order is ascending while the specified order is `id` descending.
  //
  // This matters because the incidental order is an engine detail, not a
  // guarantee. On PostgreSQL — the documented migration target in
  // docs/postgres-migration-plan.md — tied rows genuinely can come back in a
  // different order between the page-1 and page-2 queries.
  describe('stable ordering across pages (identical createdAt)', () => {
    async function pageThroughBulk(limit) {
      const seen = [];
      const pages = Math.ceil(BULK_COUNT / limit);
      for (let page = 1; page <= pages; page += 1) {
        const res = await asSuper(
          request(app).get(`/api/admin/users?q=${MARKER}&page=${page}&limit=${limit}`)
        );
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(BULK_COUNT);
        seen.push(...res.body.users.map((u) => u.id));
      }
      return seen;
    }

    test('paging loses and duplicates nothing', async () => {
      const seen = await pageThroughBulk(5);
      expect(seen).toHaveLength(BULK_COUNT);
      expect(new Set(seen).size).toBe(BULK_COUNT); // no duplicates
      expect(new Set(seen)).toEqual(new Set(bulkIds)); // nothing missing
    });

    test('tied rows come back in the fully specified order, not an engine default', async () => {
      // The documented total order is (createdAt desc, id desc). Every bulk
      // row shares createdAt, so the whole sequence must be id-descending.
      const expected = [...bulkIds].sort().reverse();
      expect(await pageThroughBulk(5)).toEqual(expected);
    });

    test('the same order holds at a different page size', async () => {
      // Re-paging at a different boundary must produce the identical
      // sequence — that is what makes a page boundary meaningful at all.
      expect(await pageThroughBulk(4)).toEqual(await pageThroughBulk(5));
    });
  });

  describe('search', () => {
    test('q matches on email', async () => {
      const res = await asSuper(request(app).get(`/api/admin/users?q=${MARKER}-03`));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.users[0].email).toBe(`${MARKER}-03@example.com`);
    });

    test('q matches on name', async () => {
      const res = await asSuper(request(app).get('/api/admin/users?q=Bulk Teacher 07'));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.users[0].name).toBe('Bulk Teacher 07');
    });

    test('a non-matching q returns an empty page with total 0', async () => {
      const res = await asSuper(request(app).get('/api/admin/users?q=no-such-teacher-anywhere'));
      expect(res.status).toBe(200);
      expect(res.body.users).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    test('GET /schools supports q on name and code', async () => {
      const byName = await asSuper(request(app).get('/api/admin/schools?q=pgn School A'));
      expect(byName.status).toBe(200);
      expect(byName.body.schools.map((s) => s.id)).toContain(fx.schoolA.id);

      const byCode = await asSuper(request(app).get(`/api/admin/schools?q=${fx.schoolB.code}`));
      expect(byCode.status).toBe(200);
      expect(byCode.body.schools.map((s) => s.id)).toContain(fx.schoolB.id);
      expect(byCode.body.schools.map((s) => s.id)).not.toContain(fx.schoolA.id);
    });
  });

  describe('filters', () => {
    test('role filter narrows the rows and the total together', async () => {
      const all = await asSchoolAdminA(request(app).get('/api/admin/users?limit=100'));
      const admins = await asSchoolAdminA(
        request(app).get('/api/admin/users?role=school_admin&limit=100')
      );
      expect(admins.status).toBe(200);
      for (const u of admins.body.users) expect(u.role).toBe('school_admin');
      // The filtered total must be the filtered count, not the unfiltered one.
      expect(admins.body.total).toBe(admins.body.users.length);
      expect(admins.body.total).toBeLessThan(all.body.total);
    });

    test('status filter returns only that status', async () => {
      const pendingUser = await prisma.user.create({
        data: {
          schoolId: fx.schoolA.id,
          name: 'Pending For Filter',
          email: 'pgn-status-filter@example.com',
          role: 'teacher',
          status: 'pending',
          passwordHash: 'not-used-by-these-tests',
        },
      });

      const res = await asSchoolAdminA(request(app).get('/api/admin/users?status=pending&limit=100'));
      expect(res.status).toBe(200);
      for (const u of res.body.users) expect(u.status).toBe('pending');
      expect(res.body.users.map((u) => u.id)).toContain(pendingUser.id);
    });

    test('an unknown role or status value is ignored, not an error', async () => {
      const res = await asSchoolAdminA(
        request(app).get('/api/admin/users?role=wizard&status=banished&limit=100')
      );
      expect(res.status).toBe(200);
      const unfiltered = await asSchoolAdminA(request(app).get('/api/admin/users?limit=100'));
      expect(res.body.total).toBe(unfiltered.body.total);
    });

    test('super_admin can narrow to a single school with schoolId', async () => {
      const res = await asSuper(request(app).get(`/api/admin/users?schoolId=${fx.schoolB.id}&limit=100`));
      expect(res.status).toBe(200);
      const emails = res.body.users.map((u) => u.email);
      expect(emails).toContain(fx.teacherB.email);
      expect(emails).not.toContain(fx.teacherA.email);
    });
  });

  // These are the assertions that matter most: the new parameters are extra
  // surface on the tenant boundary, so each is checked for scope-widening.
  describe('no query parameter can widen school scope', () => {
    test('school_admin paging every page never sees another school', async () => {
      let page = 1;
      let total = Infinity;
      const seenEmails = [];
      while (seenEmails.length < total && page <= 20) {
        const res = await asSchoolAdminA(request(app).get(`/api/admin/users?page=${page}&limit=3`));
        expect(res.status).toBe(200);
        total = res.body.total;
        if (res.body.users.length === 0) break;
        seenEmails.push(...res.body.users.map((u) => u.email));
        page += 1;
      }
      expect(seenEmails.length).toBe(total);
      expect(seenEmails).toContain(fx.teacherA.email);
      expect(seenEmails).not.toContain(fx.teacherB.email);
      expect(seenEmails).not.toContain(fx.schoolAdminB.email);
    });

    test('school_admin cannot use q to find a user at another school', async () => {
      const res = await asSchoolAdminA(
        request(app).get(`/api/admin/users?q=${encodeURIComponent(fx.teacherB.email)}`)
      );
      expect(res.status).toBe(200);
      expect(res.body.users).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    test('school_admin cannot use schoolId to read another school', async () => {
      const res = await asSchoolAdminA(
        request(app).get(`/api/admin/users?schoolId=${fx.schoolB.id}&limit=100`)
      );
      expect(res.status).toBe(200);
      const emails = res.body.users.map((u) => u.email);
      // The out-of-scope schoolId is ignored, so this is still School A's
      // list — never School B's, and never empty-because-it-was-applied.
      expect(emails).toContain(fx.teacherA.email);
      expect(emails).not.toContain(fx.teacherB.email);
    });

    test('resource_person cannot use schoolId to leave their district', async () => {
      const res = await request(app)
        .get(`/api/admin/users?schoolId=${fx.schoolB.id}&limit=100`)
        .set('Authorization', `Bearer ${resourcePersonAToken}`);
      expect(res.status).toBe(200);
      const emails = res.body.users.map((u) => u.email);
      expect(emails).toContain(fx.teacherA.email); // same district
      expect(emails).not.toContain(fx.teacherB.email); // different district
    });

    test('school_admin cannot use q on the pending queue to see another school', async () => {
      const pendingB = await prisma.user.create({
        data: {
          schoolId: fx.schoolB.id,
          name: 'Pending Cross School',
          email: 'pgn-pending-cross@example.com',
          role: 'teacher',
          status: 'pending',
          passwordHash: 'not-used-by-these-tests',
        },
      });

      const res = await asSchoolAdminA(
        request(app).get('/api/admin/users/pending?q=pgn-pending-cross')
      );
      expect(res.status).toBe(200);
      expect(res.body.users.map((u) => u.id)).not.toContain(pendingB.id);
      expect(res.body.total).toBe(0);
    });
  });

  test('GET /users/pending is paginated and still only lists pending accounts', async () => {
    const res = await asSuper(request(app).get('/api/admin/users/pending?limit=2'));
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(2);
    expect(res.body.users.length).toBeLessThanOrEqual(2);
    expect(typeof res.body.total).toBe('number');
    for (const u of res.body.users) expect(u.status).toBe('pending');
  });
});
