// Admin Support Inbox (Phase 2) — where a super_admin reads and works every
// SupportTicket the "Need Help?" flow (Phase 1) has been collecting.
//
// SCOPE: this file owns every /api/admin/support/* route. Kept SEPARATE from
// routes/admin.js rather than folded into it: admin.js's whole model is
// role-scoped (super_admin/resource_person/school_admin, each narrowed to a
// slice of schools via schoolScope()); every route here is super_admin-only,
// full stop — a ticket is product feedback, not a school's own data (see
// docs/help-support-architecture.md), and giving it a different access model
// than the rest of that file is easier to see correctly in its own file than
// as an exception embedded in a shared one.
const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');

const router = express.Router();

// Mirrors routes/admin.js's own parseListQuery/NEWEST_FIRST exactly. Kept as
// its own copy rather than an import — admin.js doesn't export them, and
// this app already has a documented precedent for small per-file leaf
// helpers staying duplicated rather than unified (see routes/attachments.js's
// sendAiError comment). Unifying them is a pre-existing refactor this
// feature does not need to take on.
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
 * Parses an inclusive createdAt range from ?from=&to= (date or ISO strings).
 * Invalid/missing bounds are silently dropped rather than erroring — same
 * "bad filter input degrades gracefully" convention routes/admin.js already
 * uses for its role/status query-string filters.
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
      // A bare date (no time component) should include the whole day, not
      // stop at midnight — "to 2026-08-02" must still match a ticket filed
      // at 23:59 that day.
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

  // Scope is trivial here — every route in this file is super_admin-only,
  // so unlike routes/admin.js's schoolScope() there is no school-narrowing
  // to AND in before the filters below.
  const where = {};

  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (status && STATUSES.includes(status)) where.status = status;

  const type = typeof req.query.type === 'string' ? req.query.type : '';
  if (type && TYPES.includes(type)) where.type = type;

  // Category has no single cross-type vocabulary to validate against here —
  // bug and feedback each have their own (see routes/support.js). An
  // unrecognized value just matches zero rows, which is harmless for a
  // read-only filter (unlike a value being WRITTEN, which routes/support.js
  // does validate against its enums).
  const category = typeof req.query.category === 'string' ? req.query.category.trim().slice(0, 40) : '';
  if (category) where.category = category;

  const schoolId = typeof req.query.schoolId === 'string' ? req.query.schoolId : '';
  if (schoolId) where.schoolId = schoolId;

  const createdAt = parseDateRange(req.query);
  if (createdAt) where.createdAt = createdAt;

  if (q) {
    // Scan, not an index seek (see the note on GET /schools in
    // routes/admin.js) — acceptable here for the same reason: super_admin
    // only, and bounded by the page-size cap. The `endsWith` arm is what
    // makes pasting the short reference (e.g. "q2qvh99p") a teacher was
    // shown on the Help & Support success screen actually find the ticket.
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

// GET /api/admin/support/tickets/stats — the inbox's KPI strip. A separate,
// cheap, unfiltered aggregate endpoint (same precedent as GET
// /admin/analytics) rather than folded into the list response, so the list
// endpoint's shape never has to carry aggregate baggage. MUST be registered
// before /tickets/:id below, so "stats" is never captured as an :id.
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

// POST /api/admin/support/tickets/:id/notes — an admin's internal note.
// Never exposed to the ticket's submitter (see the SupportNote model comment
// in schema.prisma) — there is no teacher-facing route that returns these.
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
