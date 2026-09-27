// Admin visibility for Schedule a Call bookings — read-only. See
// docs/schedule-a-call-plan.md.
//
// SCOPE: this file owns every /api/admin/demo-bookings route, all
// super_admin-only. A sibling of routes/adminSupport.js, split out the same
// way that file is split from routes/admin.js: a demo booking is a lead, not
// a school's own data, and belongs to a different access model than the
// rest of admin.js's school-scoped routes. No mutation endpoints — a v1
// admin only needs visibility; cancelling/rescheduling is visitor-token-
// driven (routes/scheduleDemo.js), and an admin acting on someone's behalf
// uses the link from the confirmation email.
const express = require('express');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const { getDemoBookingConfig, formatDateLabel, formatTimeLabel } = require('../lib/demoBookingConfig');

const router = express.Router();

// Mirrors routes/adminSupport.js's own parseListQuery exactly — same
// documented precedent there for small per-file leaf helpers staying
// duplicated rather than unified.
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const STATUSES = ['confirmed', 'cancelled'];

function parseListQuery(query) {
  const rawLimit = parseInt(query.limit, 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? DEFAULT_PAGE_SIZE : rawLimit, 1), MAX_PAGE_SIZE);
  const rawPage = parseInt(query.page, 10);
  const page = Math.max(Number.isNaN(rawPage) ? 1 : rawPage, 1);
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 200) : '';
  return { limit, page, skip: (page - 1) * limit, q };
}

function parseDateRange(query) {
  const range = {};
  if (typeof query.from === 'string' && query.from) range.gte = query.from;
  if (typeof query.to === 'string' && query.to) range.lte = query.to;
  return Object.keys(range).length ? range : undefined;
}

function bookingDto(b, config) {
  return {
    id: b.id,
    name: b.name,
    email: b.email,
    organization: b.organization,
    role: b.role,
    phone: b.phone,
    notes: b.notes,
    date: b.date,
    startTime: b.startTime,
    dateLabel: formatDateLabel(b.date),
    timeLabel: formatTimeLabel(b.startTime, config),
    durationMinutes: config.slotMinutes,
    status: b.status,
    createdAt: b.createdAt,
  };
}

// GET /api/admin/demo-bookings — filtered, paginated list.
router.get(
  '/',
  authRequired,
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const { limit, page, skip, q } = parseListQuery(req.query);

    const where = {};
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    if (status && STATUSES.includes(status)) where.status = status;

    const date = parseDateRange(req.query);
    if (date) where.date = date;

    if (q) {
      where.OR = [
        { name: { contains: q } },
        { email: { contains: q } },
        { organization: { contains: q } },
      ];
    }

    const config = getDemoBookingConfig();
    const [total, bookings] = await Promise.all([
      prisma.demoBooking.count({ where }),
      prisma.demoBooking.findMany({
        where,
        orderBy: [{ date: 'desc' }, { startTime: 'desc' }],
        skip,
        take: limit,
      }),
    ]);

    res.json({ bookings: bookings.map((b) => bookingDto(b, config)), total, page, limit, timezone: config.timezone });
  })
);

// GET /api/admin/demo-bookings/:id — full detail.
router.get(
  '/:id',
  authRequired,
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const booking = await prisma.demoBooking.findUnique({ where: { id: req.params.id } });
    if (!booking) return res.status(404).json({ error: 'Booking not found.' });
    res.json({ booking: bookingDto(booking, getDemoBookingConfig()) });
  })
);

module.exports = router;
