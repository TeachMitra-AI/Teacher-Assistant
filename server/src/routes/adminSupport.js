// Admin Support Inbox: where a super_admin reads and works every SupportTicket from the "Need Help?" flow.
// Owns every /api/admin/support/* route, separate from routes/admin.js, whose model is role-scoped through
// schoolScope(). Every route here is super_admin-only, since a ticket is product feedback, not a school's data
// (docs/help-support-architecture.md).
const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

// Mirrors routes/admin.js's parseListQuery/NEWEST_FIRST as a copy, since admin.js doesn't export them and small per-file helpers are duplicated.
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

const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }];

const STATUSES = ['open', 'triaged', 'resolved', 'wont_fix'];
const TYPES = ['bug', 'feedback'];

/**
 * Parses an inclusive createdAt range from ?from=&to= (dates or ISO strings). Invalid or missing bounds are
 * dropped rather than erroring, as routes/admin.js does for its filters.
 */
function parseDateRange(query) {
  const range = {};
  if (typeof query.from === 'string' && query.from) {
    const d = new Date(query.from);
    if (!Number.isNaN(d.getTime())) range.gte = d;
  }
  if (typeof query.to === 'string' && query.to) {
    const d = new Date(query.to);
    if (!Number.isNaN(d.getTime())) {
      // A bare date includes the whole day: "to 2026-08-02" must match a ticket filed at 23:59 that day.
      if (query.to.length <= 10) d.setHours(23, 59, 59, 999);
      range.lte = d;
    }
  }
  return Object.keys(range).length ? range : undefined;
}

function ticketDto(t) {
  return {
    id: t.id,
    type: t.type,
    category: t.category,
    description: t.description,
    status: t.status,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    user: t.user ? { id: t.user.id, name: t.user.name, email: t.user.email, role: t.user.role } : null,
    school: t.school ? { id: t.school.id, name: t.school.name, code: t.school.code } : null,
  };
}

function safeParseContext(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

// GET /api/admin/support/tickets — filtered, searched, paginated list.
router.get('/tickets', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { limit, page, skip, q } = parseListQuery(req.query);

  // Every route is super_admin-only, so there's no school scope to AND in before the filters.
  const where = {};

  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (status && STATUSES.includes(status)) where.status = status;

  const type = typeof req.query.type === 'string' ? req.query.type : '';
  if (type && TYPES.includes(type)) where.type = type;

  // Category has no single vocabulary to validate against (bug and feedback each have their own, see routes/support.js).
  // An unknown value just matches no rows, harmless for a read-only filter.
  const category = typeof req.query.category === 'string' ? req.query.category.trim().slice(0, 40) : '';
  if (category) where.category = category;

  const schoolId = typeof req.query.schoolId === 'string' ? req.query.schoolId : '';
  if (schoolId) where.schoolId = schoolId;

  const createdAt = parseDateRange(req.query);
  if (createdAt) where.createdAt = createdAt;

  if (q) {
    // A scan, not an index seek (see GET /schools in routes/admin.js); fine for super_admin-only with a capped page.
    // The `endsWith` arm lets a teacher paste the short reference from the Help & Support success screen.
    where.OR = [
      { description: { contains: q } },
      { id: { endsWith: q } },
      { user: { name: { contains: q } } },
      { user: { email: { contains: q } } },
    ];
  }

  const [total, tickets] = await Promise.all([
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.findMany({
      where,
      orderBy: NEWEST_FIRST,
      skip,
      take: limit,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
        school: { select: { id: true, name: true, code: true } },
      },
    }),
  ]);

  res.json({ tickets: tickets.map(ticketDto), total, page, limit });
}));

// GET /api/admin/support/tickets/stats: the inbox's KPI strip, a cheap unfiltered aggregate kept apart from the list
// response. Must be registered before /tickets/:id so "stats" isn't captured as an :id.
router.get('/tickets/stats', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [open, today, bugs, feedback] = await Promise.all([
    prisma.supportTicket.count({ where: { status: 'open' } }),
    prisma.supportTicket.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.supportTicket.count({ where: { type: 'bug' } }),
    prisma.supportTicket.count({ where: { type: 'feedback' } }),
  ]);

  res.json({ open, today, bugs, feedback });
}));

// GET /api/admin/support/tickets/:id — full detail, including its notes.
router.get('/tickets/:id', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      school: { select: { id: true, name: true, code: true } },
      notes: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

  res.json({
    ticket: {
      ...ticketDto(ticket),
      context: ticket.context ? safeParseContext(ticket.context) : null,
      notes: ticket.notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt, author: n.author })),
    },
  });
}));

const statusSchema = z.object({ status: z.enum(STATUSES) });

// PATCH /api/admin/support/tickets/:id/status
router.patch('/tickets/:id/status', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const parsed = statusSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid status.' });
  try {
    const ticket = await prisma.supportTicket.update({
      where: { id: req.params.id },
      data: { status: parsed.data.status },
    });
    res.json({ id: ticket.id, status: ticket.status });
  } catch {
    res.status(404).json({ error: 'Ticket not found.' });
  }
}));

const noteSchema = z.object({ body: z.string().trim().min(1).max(2000) });

// POST /api/admin/support/tickets/:id/notes: an internal admin note. Never exposed to the ticket's submitter; no
// teacher-facing route returns these (see SupportNote in schema.prisma).
router.post('/tickets/:id/notes', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const parsed = noteSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'A non-empty note is required.' });

  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

  const note = await prisma.supportNote.create({
    data: { ticketId: req.params.id, authorId: req.user.id, body: parsed.data.body },
    include: { author: { select: { id: true, name: true, email: true } } },
  });

  res.status(201).json({ note: { id: note.id, body: note.body, createdAt: note.createdAt, author: note.author } });
}));

module.exports = router;
