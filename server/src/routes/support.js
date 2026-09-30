// Help & Support: bug reports and lightweight feedback. Owns one endpoint, POST /api/support/tickets (no file
// upload or AI-conversation opt-in yet; see docs/help-support-architecture.md). Contact Support is a client-side WhatsApp link.
// It makes no LLM call and has no per-user daily budget; the shared per-IP limiter in index.js bounds it, as with
// POST /feedback in routes/queries.js.
const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { readHelpSupportFlags } = require('../lib/flags');

const router = express.Router();

const MAX_DESCRIPTION_LENGTH = 1000;

// Closed vocabularies per ticket type, a fixed picker list like GRADES/SUBJECTS. Keep in step with BUG_CATEGORIES /
// FEEDBACK_CATEGORIES in client/src/config.ts.
const BUG_CATEGORIES = ['crash', 'connection_issue', 'slow_timeout', 'wrong_answer', 'upload_failed', 'account', 'other'];
const FEEDBACK_CATEGORIES = ['feature_request', 'suggestion', 'praise', 'other'];

// Auto-captured context: a closed set of known-safe fields (see the design doc's privacy section), each optional and
// bounded so a missing or oversized one degrades gracefully. It excludes the AI prompt/answer and screenshots, which are opt-in.
const contextSchema = z
  .object({
    route: z.string().max(200),
    buildId: z.string().max(100),
    userAgent: z.string().max(300),
    viewport: z.string().max(40),
    theme: z.enum(['light', 'dark']),
    language: z.string().max(20),
    requestId: z.string().max(100),
    grade: z.string().max(60),
    subject: z.string().max(60),
    classroomType: z.string().max(60),
  })
  .partial();

const ticketSchema = z
  .object({
    type: z.enum(['bug', 'feedback']),
    category: z.string().max(40).optional(),
    description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
    context: contextSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const validCategories = data.type === 'bug' ? BUG_CATEGORIES : FEEDBACK_CATEGORIES;
    if (!data.category || !validCategories.includes(data.category)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['category'], message: 'Please choose a valid category.' });
    }
    // A bug report needs enough to act on without a follow-up; feedback may be just a type with no message, since
    // forcing text produces empty or junk submissions.
    if (data.type === 'bug' && (!data.description || data.description.trim().length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['description'], message: 'Please describe what happened.' });
    }
  });

/**
 * Gate middleware, like routes/attachments.js's requireAttachmentsEnabled: runs before any work, so a disabled or
 * out-of-rollout request never touches the database.
 */
function requireHelpSupportEnabled() {
  return asyncHandler(async (req, res, next) => {
    const flags = readHelpSupportFlags(process.env);
    if (!flags.enabled) {
      return res.status(503).json({ error: 'This feature is not available right now.', code: 'HELP_SUPPORT_DISABLED' });
    }
    if (flags.allowedSchoolCodes.length > 0) {
      const school = await prisma.school.findUnique({ where: { id: req.user.schoolId }, select: { code: true } });
      if (!school || !flags.allowedSchoolCodes.includes(school.code)) {
        return res.status(503).json({ error: 'This feature is not available right now.', code: 'HELP_SUPPORT_DISABLED' });
      }
    }
    return next();
  });
}

// POST /api/support/tickets — file a bug report or send feedback.
router.post(
  '/support/tickets',
  authRequired,
  requireHelpSupportEnabled(),
  asyncHandler(async (req, res) => {
    const parsed = ticketSchema.safeParse(req.body || {});
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return res.status(400).json({ error: firstIssue?.message || 'Invalid submission.' });
    }
    const { type, category, description, context } = parsed.data;

    const ticket = await prisma.supportTicket.create({
      data: {
        type,
        category,
        description: description ? description.trim() : '',
        userId: req.user.id,
        schoolId: req.user.schoolId,
        context: context ? JSON.stringify(context) : null,
      },
    });

    // Metadata-only log — never the description text, matching every other
    // route's logAiEvent-style discipline in this app.
    console.log('[support] ticket_created', { id: ticket.id, type, category, status: ticket.status });

    res.status(201).json({ success: true, id: ticket.id, status: ticket.status });
  })
);

module.exports = router;
