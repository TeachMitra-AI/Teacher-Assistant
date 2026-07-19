// Admin analytics + management, scoped by role:
//   super_admin      -> all schools
//   resource_person  -> all schools in the same district as their own school
//   school_admin     -> their own school only
const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

const ADMIN_ROLES = ['school_admin', 'resource_person', 'super_admin'];

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
router.get('/analytics', authRequired, requireRole(...ADMIN_ROLES), async (req, res) => {
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
});

function toSortedArray(obj) {
  return Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }));
}

// GET /api/admin/schools — super_admin only.
router.get('/schools', authRequired, requireRole('super_admin'), async (req, res) => {
  const schools = await prisma.school.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { users: true, queries: true } } },
  });
  res.json({
    schools: schools.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
      district: s.district,
      state: s.state,
      users: s._count.users,
      queries: s._count.queries,
    })),
  });
});

const schoolSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(3).max(40),
  district: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
});

// POST /api/admin/schools — super_admin creates a school.
router.post('/schools', authRequired, requireRole('super_admin'), async (req, res) => {
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
});

// GET /api/admin/users — users within the caller's scope (no PIN hashes).
router.get('/users', authRequired, requireRole(...ADMIN_ROLES), async (req, res) => {
  const scope = await schoolScope(req.user);
  const where = scope === null ? {} : { schoolId: { in: scope } };
  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: { school: { select: { name: true, code: true } } },
  });
  res.json({
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      school: u.school?.name,
      schoolCode: u.school?.code,
      lastLogin: u.lastLogin,
      createdAt: u.createdAt,
    })),
  });
});

const roleSchema = z.object({
  role: z.enum(['teacher', 'school_admin', 'resource_person', 'super_admin']),
});

// PATCH /api/admin/users/:id/role — super_admin changes a user's role.
router.patch('/users/:id/role', authRequired, requireRole('super_admin'), async (req, res) => {
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
});

module.exports = router;
