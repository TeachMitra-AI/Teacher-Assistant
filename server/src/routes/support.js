// Help & Support — bug reports and lightweight feedback.
//
// SCOPE: this file owns exactly one endpoint, POST /api/support/tickets.
// Phase 1 only (see docs/help-support-architecture.md): no file upload, no
// admin inbox, no AI-conversation opt-in yet — those are Phase 2. Contact
// Support has no route here at all: it's a WhatsApp deep link built entirely
// client-side.
//
// Deliberately makes no LLM call and carries no per-user daily budget, unlike
// routes/attachments.js / routes/assistant.js — the shared per-IP rate
// limiter mounted in index.js is what bounds this endpoint, the same way
// routes/queries.js's POST /feedback has no budget of its own.
const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { readHelpSupportFlags } = require('../lib/flags');

const router = express.Router();

const MAX_DESCRIPTION_LENGTH = 1000;

// Closed vocabularies, one per ticket type — the same "fixed picker list, not
// free text" convention as GRADES/SUBJECTS in client/src/config.ts. Keep in
// step with that file's BUG_CATEGORIES / FEEDBACK_CATEGORIES (same
// duplication convention already used there for LANGUAGES/GRADES/SUBJECTS).
const BUG_CATEGORIES = ['crash', 'connection_issue', 'slow_timeout', 'wrong_answer', 'upload_failed', 'account', 'other'];
const FEEDBACK_CATEGORIES = ['feature_request', 'suggestion', 'praise', 'other'];

// Auto-captured context — a closed, known-safe set of fields (see the design
// doc's privacy section). Every field optional and independently bounded so
// a missing or oversized one degrades gracefully rather than failing the
// whole submission. Deliberately excludes the AI prompt/answer and any
// screenshot — those are opt-in, Phase 2 additions, never folded into this
// auto-captured blob.
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
    // A bug report needs enough for a developer to act on without a
    // follow-up question; feedback is deliberately allowed to be just a type
    // with no message (see the design doc's §5 — forcing text there produces
    // empty/junk submissions instead of a quick "I like this").
    if (data.type === 'bug' && (!data.description || data.description.trim().length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['description'], message: 'Please describe what happened.' });
    }
  });

/**
 * Gate middleware — same shape as routes/attachments.js's
 * requireAttachmentsEnabled: runs before any work is done, so a disabled or
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
