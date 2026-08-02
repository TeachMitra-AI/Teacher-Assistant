// Admin analytics + management, scoped by role:
//   super_admin      -> all schools
//   resource_person  -> all schools in the same district as their own school
//   school_admin     -> their own school only
const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

const ADMIN_ROLES = ['school_admin', 'resource_person', 'super_admin'];

const USER_ROLES = ['teacher', 'school_admin', 'resource_person', 'super_admin'];
const USER_STATUSES = ['active', 'pending', 'rejected'];

// Shared list-query parsing for the paginated admin tables.
//
// The page size is clamped server-side because the clamp — not the client's
// good behaviour — is what actually bounds these endpoints: before this, a
// super_admin's GET /users selected every user row in the database, buffered
// them all in Node, and JSON.stringify'd the result synchronously (blocking
// the event loop for every other request). Mirrors the convention already in
// GET /api/resources: clamp the size, cap the search term's length.
//
// The client now sends an explicit `limit` and renders pager controls, so the
// default no longer has to be generous enough to avoid silently truncating a
// pager-less table. It stays a real default rather than a required parameter
// so a hand-rolled curl or a future integration cannot ask for everything.
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function parseListQuery(query) {
  const rawLimit = parseInt(query.limit, 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? DEFAULT_PAGE_SIZE : rawLimit, 1), MAX_PAGE_SIZE);
  const rawPage = parseInt(query.page, 10);
  const page = Math.max(Number.isNaN(rawPage) ? 1 : rawPage, 1);
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 200) : '';
  return { limit, page, skip: (page - 1) * limit, q };
}

// `id` breaks ties on every paginated listing: createdAt is not unique (a seed
// or a bulk import shares one timestamp to the millisecond), and an unstable
// sort makes rows duplicate or vanish across page boundaries.
const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }];

// Returns an array of school ids in scope, or null meaning "all schools".
async function schoolScope(user) {
  if (user.role === 'super_admin') return null;
  if (user.role === 'school_admin') return [user.schoolId];
  if (user.role === 'resource_person') {
    const school = await prisma.school.findUnique({ where: { id: user.schoolId } });
    if (!school || !school.district) return [user.schoolId];
    const schools = await prisma.school.findMany({
      where: { district: school.district },
      select: { id: true },
    });
    return schools.map((s) => s.id);
  }
  return [];
}

function scopeWhere(scope) {
  return scope === null ? {} : { schoolId: { in: scope } };
}

// GET /api/admin/analytics — aggregate usage for the caller's scope.
router.get('/analytics', authRequired, requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  const scope = await schoolScope(req.user);
  const where = scopeWhere(scope);

  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [totalQueries, totalTeachers, helpful, notHelpful, recent] = await Promise.all([
    prisma.query.count({ where }),
    prisma.user.count({ where: { role: 'teacher', ...(scope ? { schoolId: { in: scope } } : {}) } }),
    prisma.feedback.count({ where: { rating: 'helpful', query: where.schoolId ? { schoolId: where.schoolId } : {} } }),
    prisma.feedback.count({ where: { rating: 'not_helpful', query: where.schoolId ? { schoolId: where.schoolId } : {} } }),
    prisma.query.findMany({
      where,
      select: { userId: true, context: true, language: true, queryText: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
  ]);

  // Active teachers = distinct users who asked something in the last 30 days.
  const activeTeachers = new Set(
    recent.filter((q) => q.createdAt >= since30 && q.userId).map((q) => q.userId)
  ).size;

  const bySubject = {};
  const byIssueType = {};
  const byLanguage = {};
  const byDay = {};
  const questionCounts = {};

  for (const q of recent) {
    let ctx = {};
    try {
      ctx = q.context ? JSON.parse(q.context) : {};
    } catch {
      ctx = {};
    }
    if (ctx.subject) bySubject[ctx.subject] = (bySubject[ctx.subject] || 0) + 1;
    if (ctx.issueType) byIssueType[ctx.issueType] = (byIssueType[ctx.issueType] || 0) + 1;
    byLanguage[q.language] = (byLanguage[q.language] || 0) + 1;

    const day = q.createdAt.toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;

    const key = q.queryText.trim().toLowerCase().slice(0, 120);
    if (key) questionCounts[key] = (questionCounts[key] || 0) + 1;
  }

  const topQuestions = Object.entries(questionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([question, count]) => ({ question, count }));

  const totalFeedback = helpful + notHelpful;

  res.json({
    scope: scope === null ? 'all' : scope.length,
    totals: {
      queries: totalQueries,
      teachers: totalTeachers,
      activeTeachers,
      feedback: totalFeedback,
      helpfulRatio: totalFeedback ? Math.round((helpful / totalFeedback) * 100) : null,
    },
    bySubject: toSortedArray(bySubject),
    byIssueType: toSortedArray(byIssueType),
    byLanguage: toSortedArray(byLanguage),
    byDay: Object.entries(byDay)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count })),
    topQuestions,
  });
}));

function toSortedArray(obj) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));
}

// GET /api/admin/schools?page=&limit=&q= — super_admin only, paginated.
//
// `_count.queries` is deliberately NOT selected. Prisma emits one correlated
// aggregate per row, so including it meant a count over the largest table in
// the schema, once per school, on every page load — to render a number nobody
// acted on. The per-school question total belongs in a detail view. (The
// teacher count stays: it is a count over a small table and it is the number
// that tells a super_admin whether a school is actually in use.)
router.get('/schools', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { limit, page, skip, q } = parseListQuery(req.query);

  const where = {};
  if (q) {
    // A leading-wildcard LIKE cannot use an index on SQLite or PostgreSQL, so
    // this is a scan. Acceptable here: the endpoint is super_admin-only and
    // the page size is capped. Case-insensitive for ASCII on SQLite by
    // default, the same assumption GET /api/resources already relies on.
    where.OR = [
      { name: { contains: q } },
      { code: { contains: q } },
      { district: { contains: q } },
    ];
  }

  const [total, schools] = await Promise.all([
    prisma.school.count({ where }),
    prisma.school.findMany({
      where,
      orderBy: NEWEST_FIRST,
      skip,
      take: limit,
      include: { _count: { select: { users: true } } },
    }),
  ]);

  res.json({
    schools: schools.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      district: s.district,
      state: s.state,
      users: s._count.users,
    })),
    total,
    page,
    limit,
  });
}));

const schoolSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(3).max(40),
  district: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
});

// POST /api/admin/schools — super_admin creates a school.
router.post('/schools', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const parsed = schoolSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid school details.' });
  }
  const data = parsed.data;
  const code = data.code.toUpperCase();

  const existing = await prisma.school.findUnique({ where: { code } });
  if (existing) return res.status(409).json({ error: 'A school with this code already exists.' });

  const school = await prisma.school.create({
    data: { name: data.name, code, district: data.district, state: data.state },
  });
  res.status(201).json({ school });
}));

// Shared DTO for both user listings below — never includes a password hash,
// a googleSub, or any other credential material.
function userDto(u) {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status,
    school: u.school?.name,
    schoolCode: u.school?.code,
    lastLogin: u.lastLogin,
    createdAt: u.createdAt,
  };
}

// GET /api/admin/users?page=&limit=&q=&role=&status=&schoolId=
// Users within the caller's scope (no credentials), paginated.
//
// Every filter below can only ever NARROW the school scope established by
// schoolScope() — none of them is allowed to widen it. That ordering is the
// tenant boundary, so it is asserted directly in tenant-isolation.test.js
// rather than left as a code-reading exercise.
router.get('/users', authRequired, requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  const scope = await schoolScope(req.user);
  const { limit, page, skip, q } = parseListQuery(req.query);

  // Scope first, filters second. Prisma ANDs top-level `where` keys, so the
  // result is `scope AND role AND status AND (name|email match)`.
  const where = scopeWhere(scope);

  const role = typeof req.query.role === 'string' ? req.query.role : '';
  if (role && USER_ROLES.includes(role)) where.role = role;

  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (status && USER_STATUSES.includes(status)) where.status = status;

  // A super_admin (scope === null) may narrow to a single school. For every
  // other role the scope already pins the schools, so an id outside it is
  // ignored rather than applied — a school_admin cannot use this to read
  // another school's users.
  const schoolId = typeof req.query.schoolId === 'string' ? req.query.schoolId : '';
  if (schoolId && (scope === null || scope.includes(schoolId))) where.schoolId = schoolId;

  if (q) {
    // Scan, not an index seek (see the note on GET /schools above) — bounded
    // by the caller's scope and by the page-size cap.
    where.OR = [{ name: { contains: q } }, { email: { contains: q } }];
  }

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: NEWEST_FIRST,
      skip,
      take: limit,
      include: { school: { select: { name: true, code: true } } },
    }),
  ]);

  res.json({ users: users.map(userDto), total, page, limit });
}));

// GET /api/admin/users/pending — sign-ups awaiting approval in the caller's
// scope. Readable by every admin role (a resource_person can see the queue for
// their district), but only school_admin/super_admin can act on it below.
//
// Paginated like the other listings. The queue is naturally small — it drains
// as admins act on it — but "naturally small" is not a bound: a wave of spam
// sign-ups would otherwise make this endpoint as unbounded as GET /users was.
router.get('/users/pending', authRequired, requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  const scope = await schoolScope(req.user);
  const { limit, page, skip, q } = parseListQuery(req.query);

  const where = { status: 'pending', ...scopeWhere(scope) };
  if (q) where.OR = [{ name: { contains: q } }, { email: { contains: q } }];

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: NEWEST_FIRST,
      skip,
      take: limit,
      include: { school: { select: { name: true, code: true } } },
    }),
  ]);

  res.json({ users: users.map(userDto), total, page, limit });
}));

// Approve or reject one pending sign-up. Ownership/scope is checked exactly
// the way POST /users/:id/revoke-sessions does it, so an admin can never act
// on an account outside their own school (or district, or all schools for a
// super_admin). Each decision writes an Event row so there's a durable record
// of who let a given teacher in.
async function decidePendingUser(req, res, { status, eventType }) {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const scope = await schoolScope(req.user);
  if (scope !== null && !scope.includes(target.schoolId)) {
    return res.status(403).json({ error: 'You do not have permission to do this.' });
  }

  // Only a pending account is a valid target — this keeps the endpoint from
  // doubling as a way to deactivate an already-approved colleague, and makes a
  // double-click from two admins at once a harmless 409 rather than a silent
  // second decision.
  if (target.status !== 'pending') {
    return res.status(409).json({ error: 'This account is not awaiting approval.' });
  }

  const updated = await prisma.user.update({ where: { id: target.id }, data: { status } });
  await prisma.event.create({
    data: {
      userId: req.user.id, // the admin who decided, not the teacher decided about
      schoolId: target.schoolId,
      type: eventType,
      metadata: JSON.stringify({ targetUserId: target.id, targetEmail: target.email }),
    },
  });

  return res.json({ id: updated.id, status: updated.status });
}

// PATCH /api/admin/users/:id/approve — school_admin/super_admin only.
// resource_person is deliberately excluded: it matches the existing precedent
// that account-mutating actions are restricted to those two roles.
router.patch('/users/:id/approve', authRequired, requireRole('school_admin', 'super_admin'), asyncHandler(async (req, res) => {
  return decidePendingUser(req, res, { status: 'active', eventType: 'user_approved' });
}));

// PATCH /api/admin/users/:id/reject — same gate as approve.
router.patch('/users/:id/reject', authRequired, requireRole('school_admin', 'super_admin'), asyncHandler(async (req, res) => {
  return decidePendingUser(req, res, { status: 'rejected', eventType: 'user_rejected' });
}));

const roleSchema = z.object({
  role: z.enum(['teacher', 'school_admin', 'resource_person', 'super_admin']),
});

// PATCH /api/admin/users/:id/role — super_admin changes a user's role.
router.patch('/users/:id/role', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const parsed = roleSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid role.' });
  try {
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role: parsed.data.role },
    });
    res.json({ id: user.id, role: user.role });
  } catch {
    res.status(404).json({ error: 'User not found.' });
  }
}));

// POST /api/admin/users/:id/revoke-sessions — an admin's "kill a compromised
// account" tool: revokes every active refresh-token session the target user
// has, so they're forced to log in again everywhere within one access-token
// TTL. Scoped the same way every other admin route is (schoolScope above).
router.post('/users/:id/revoke-sessions', authRequired, requireRole(...ADMIN_ROLES), asyncHandler(async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'User not found.' });

  const scope = await schoolScope(req.user);
  if (scope !== null && !scope.includes(target.schoolId)) {
    return res.status(403).json({ error: 'You do not have permission to do this.' });
  }

  const result = await prisma.session.updateMany({
    where: { userId: target.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  res.json({ success: true, revoked: result.count });
}));

module.exports = router;
