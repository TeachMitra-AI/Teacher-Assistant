// Schedule a Call: the public demo-booking flow for schools and organizations.
// Owns every /api/schedule-demo/* route, all public (no authRequired) since visitors haven't signed up. After
// creation, "ownership" of a booking is proof of its emailed `cancelToken`, the token-instead-of-login shape of the
// password-reset flow. The admin list is in routes/adminScheduleDemo.js, as support.js / adminSupport.js are split.
const express = require('express');
const crypto = require('crypto');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { readDemoBookingFlags } = require('../lib/flags');
const {
  getDemoBookingConfig,
  isBookableDate,
  generateSlotStarts,
  meetsMinNotice,
  zonedTimeToUtc,
  formatDateLabel,
  formatTimeLabel,
} = require('../lib/demoBookingConfig');
const { sendDemoBookingConfirmation, sendDemoBookingAdminAlert } = require('../lib/email');
const { buildIcsEvent } = require('../lib/ics');

const router = express.Router();

const ROLE_OPTIONS = ['school_admin', 'org_leadership', 'other'];

/**
 * Gate middleware, like routes/support.js's requireHelpSupportEnabled: runs before any work, so a disabled
 * request never touches the database.
 */
function requireDemoBookingEnabled() {
  return (req, res, next) => {
    const flags = readDemoBookingFlags(process.env);
    if (!flags.enabled) {
      return res.status(503).json({ error: 'This feature is not available right now.', code: 'DEMO_BOOKING_DISABLED' });
    }
    return next();
  };
}

function appUrl() {
  return (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

function apiUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function bookingDto(booking, config) {
  return {
    id: booking.id,
    name: booking.name,
    organization: booking.organization,
    role: booking.role,
    date: booking.date,
    startTime: booking.startTime,
    dateLabel: formatDateLabel(booking.date),
    timeLabel: formatTimeLabel(booking.startTime, config),
    durationMinutes: config.slotMinutes,
    status: booking.status,
  };
}

// GET /api/schedule-demo/config — the availability rule the client's
// calendar renders against.
router.get(
  '/schedule-demo/config',
  requireDemoBookingEnabled(),
  asyncHandler(async (req, res) => {
    const config = getDemoBookingConfig();
    res.json({
      timezone: config.timezone,
      workDays: config.workDays,
      startTime: config.startTime,
      endTime: config.endTime,
      slotMinutes: config.slotMinutes,
      lookaheadDays: config.lookaheadDays,
    });
  })
);

// GET /api/schedule-demo/slots?date=YYYY-MM-DD: open starts for one date. An empty array (never an error) for a
// weekend, out-of-window or fully booked date; the client shows "No times available".
router.get(
  '/schedule-demo/slots',
  requireDemoBookingEnabled(),
  asyncHandler(async (req, res) => {
    const date = typeof req.query.date === 'string' ? req.query.date : '';
    const config = getDemoBookingConfig();

    if (!isBookableDate(date, config)) return res.json({ date, slots: [] });

    const taken = await prisma.demoBooking.findMany({
      where: { date, status: 'confirmed' },
      select: { startTime: true },
    });
    const takenSet = new Set(taken.map((b) => b.startTime));

    const slots = generateSlotStarts(config).filter(
      (start) => !takenSet.has(start) && meetsMinNotice(date, start, config)
    );

    res.json({ date, slots });
  })
);

const bookingSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(200),
    organization: z.string().trim().min(1).max(200),
    role: z.enum(ROLE_OPTIONS),
    phone: z.string().trim().max(30).optional(),
    notes: z.string().trim().max(1000).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict();

/**
 * Re-validates a requested date and startTime against the availability rule and already-taken slots. /slots is
 * advisory, so the client's selection is never trusted.
 */
async function assertSlotAvailable(date, startTime, config, prismaClient) {
  if (!isBookableDate(date, config)) return 'That date is not available.';
  if (!generateSlotStarts(config).includes(startTime)) return 'That time is not available.';
  if (!meetsMinNotice(date, startTime, config)) return 'That time is too soon — please choose a later slot.';

  const existing = await prismaClient.demoBooking.findFirst({
    where: { date, startTime, status: 'confirmed' },
    select: { id: true },
  });
  if (existing) return 'That slot was just booked by someone else — please choose another time.';

  return null;
}

// POST /api/schedule-demo/bookings — create a booking.
router.post(
  '/schedule-demo/bookings',
  requireDemoBookingEnabled(),
  asyncHandler(async (req, res) => {
    const parsed = bookingSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid submission.' });
    }
    const { name, email, organization, role, phone, notes, date, startTime } = parsed.data;
    const config = getDemoBookingConfig();

    // The conflict check and create share one transaction so a concurrent double-booking can't slip between them.
    let booking;
    try {
      booking = await prisma.$transaction(async (tx) => {
        const conflictMessage = await assertSlotAvailable(date, startTime, config, tx);
        if (conflictMessage) {
          const error = new Error(conflictMessage);
          error.isSlotConflict = true;
          throw error;
        }
        return tx.demoBooking.create({
          data: {
            name,
            email,
            organization,
            role,
            phone: phone || null,
            notes: notes || null,
            date,
            startTime,
            cancelToken: crypto.randomBytes(32).toString('base64url'),
          },
        });
      });
    } catch (error) {
      if (error.isSlotConflict) return res.status(409).json({ error: error.message });
      throw error;
    }

    const manageUrl = `${appUrl()}/schedule-demo/manage?id=${booking.id}&token=${booking.cancelToken}`;
    const icsUrl = `${apiUrl(req)}/api/schedule-demo/bookings/${booking.id}/ics?token=${booking.cancelToken}`;

    await sendDemoBookingConfirmation({
      to: email,
      name,
      dateLabel: formatDateLabel(date),
      timeLabel: formatTimeLabel(startTime, config),
      durationMinutes: config.slotMinutes,
      manageUrl,
      icsUrl,
    });
    await sendDemoBookingAdminAlert({
      adminEmail: config.adminEmail,
      name,
      email,
      organization,
      role,
      phone,
      notes,
      dateLabel: formatDateLabel(date),
      timeLabel: formatTimeLabel(startTime, config),
    });

    console.log('[scheduleDemo] booking_created', { id: booking.id, date, startTime });

    res.status(201).json({ booking: bookingDto(booking, config), manageUrl });
  })
);

/**
 * Loads a booking by id, 404ing unless `token` matches its cancelToken. Missing and not-yours both 404 (as for
 * Resources), so a guessed id can't confirm a booking exists.
 */
async function loadBookingByToken(req, res) {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  const booking = await prisma.demoBooking.findUnique({ where: { id: req.params.id } });
  if (!booking || !token || booking.cancelToken !== token) {
    res.status(404).json({ error: 'Booking not found.' });
    return null;
  }
  return booking;
}

// GET /api/schedule-demo/bookings/:id?token=... — feeds the manage page.
router.get(
  '/schedule-demo/bookings/:id',
  requireDemoBookingEnabled(),
  asyncHandler(async (req, res) => {
    const booking = await loadBookingByToken(req, res);
    if (!booking) return;
    res.json({ booking: bookingDto(booking, getDemoBookingConfig()) });
  })
);

const rescheduleSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  })
  .strict();

// PATCH /api/schedule-demo/bookings/:id?token=... — reschedule.
router.patch(
  '/schedule-demo/bookings/:id',
  requireDemoBookingEnabled(),
  asyncHandler(async (req, res) => {
    const existing = await loadBookingByToken(req, res);
    if (!existing) return;
    if (existing.status === 'cancelled') {
      return res.status(409).json({ error: 'This booking has already been cancelled.' });
    }

    const parsed = rescheduleSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid submission.' });
    }
    const { date, startTime } = parsed.data;
    const config = getDemoBookingConfig();

    let booking;
    try {
      booking = await prisma.$transaction(async (tx) => {
        const conflictMessage = await assertSlotAvailable(date, startTime, config, tx);
        if (conflictMessage) {
          const error = new Error(conflictMessage);
          error.isSlotConflict = true;
          throw error;
        }
        return tx.demoBooking.update({ where: { id: existing.id }, data: { date, startTime } });
      });
    } catch (error) {
      if (error.isSlotConflict) return res.status(409).json({ error: error.message });
      throw error;
    }

    const manageUrl = `${appUrl()}/schedule-demo/manage?id=${booking.id}&token=${booking.cancelToken}`;
    const icsUrl = `${apiUrl(req)}/api/schedule-demo/bookings/${booking.id}/ics?token=${booking.cancelToken}`;
    await sendDemoBookingConfirmation({
      to: booking.email,
      name: booking.name,
      dateLabel: formatDateLabel(date),
      timeLabel: formatTimeLabel(startTime, config),
      durationMinutes: config.slotMinutes,
      manageUrl,
      icsUrl,
    });

    res.json({ booking: bookingDto(booking, config), manageUrl });
  })
);

// POST /api/schedule-demo/bookings/:id/cancel?token=... — cancel, freeing
// the slot for someone else.
router.post(
  '/schedule-demo/bookings/:id/cancel',
  requireDemoBookingEnabled(),
  asyncHandler(async (req, res) => {
    const existing = await loadBookingByToken(req, res);
    if (!existing) return;
    if (existing.status === 'cancelled') {
      return res.json({ booking: bookingDto(existing, getDemoBookingConfig()) });
    }

    const booking = await prisma.demoBooking.update({ where: { id: existing.id }, data: { status: 'cancelled' } });
    res.json({ booking: bookingDto(booking, getDemoBookingConfig()) });
  })
);

// GET /api/schedule-demo/bookings/:id/ics?token=... — the "add to calendar"
// download linked from the confirmation email.
router.get(
  '/schedule-demo/bookings/:id/ics',
  requireDemoBookingEnabled(),
  asyncHandler(async (req, res) => {
    const booking = await loadBookingByToken(req, res);
    if (!booking) return;
    const config = getDemoBookingConfig();

    const ics = buildIcsEvent({
      uid: booking.id,
      summary: 'Call with SarasTech',
      description: `A ${config.slotMinutes}-minute call with the SarasTech team about ${booking.organization}.`,
      startsAt: zonedTimeToUtc(booking.date, booking.startTime, config.timezone),
      durationMinutes: config.slotMinutes,
    });

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sarastech-call-${booking.date}.ics"`);
    res.send(ics);
  })
);

module.exports = router;
