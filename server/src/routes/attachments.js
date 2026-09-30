// Multimodal attachments: POST /api/coach/attachment, a sibling of /api/coach rather than an extension, with the same
// response envelope, auth and normalization, so the most-used /coach handler is untouched
// (docs/multimodal-attachments-architecture.md).
// Files are never persisted: multer uses memoryStorage and the buffer is discarded when the request completes. Never
// use diskStorage here; Railway's filesystem is ephemeral.
// It reuses lib/fileValidation.js, attachments/describeAttachment.js and assistant/budget.js's generic per-user counter.

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const { asyncHandler } = require('../lib/asyncHandler');
const { sendAiError } = require('../lib/sendAiError');
const { authRequired } = require('../middleware/auth');
const { readAttachmentFlags } = require('../lib/flags');
const { validateAttachmentBatch } = require('../lib/fileValidation');
const { describeAttachment } = require('../attachments/describeAttachment');
const { normalizeQuery } = require('../safety/inputGuard');
const { LANGUAGE_NAMES } = require('../prompts');
const { prisma } = require('../lib/db');

const router = express.Router();

// Mirrors MAX_QUERY_LENGTH in index.js (the /coach bound), which index.js doesn't export. Promote to a shared leaf
// module if a third file needs it (see lib/resourceFields.js).
const MAX_QUERY_LENGTH = 500;

let uploadMiddleware = null;
let cachedKey = null;

/**
 * Builds and caches the multer instance for the configured per-file size and file-count caps. Flags are read
 * per request, but multer's `limits` are fixed at construction, so this rebuilds only when a configured value changes.
 * `.array('files', maxFiles)` takes one or many files under the same field name, so a single upload is just a
 * one-element array with no separate code path.
 */
function getUploadMiddleware(maxFileSizeMb, maxFiles) {
  const key = `${maxFileSizeMb}:${maxFiles}`;
  if (uploadMiddleware && cachedKey === key) return uploadMiddleware;
  uploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSizeMb * 1024 * 1024, files: maxFiles },
  }).array('files', maxFiles);
  cachedKey = key;
  return uploadMiddleware;
}

/**
 * Same rollout predicate as routes/assistant.js's isWithinRollout, on attachments' own flags. Kept local since the
 * two features gate differently: the router degrades to an inert catalog, this endpoint to a plain 503.
 */
function isWithinRollout(user, flags) {
  if (!flags.enabled) return false;
  if (flags.allowedSchoolCodes.length === 0) return true;
  return isSchoolAllowed(user, flags);
}

async function isSchoolAllowed(user, flags) {
  try {
    const school = await prisma.school.findUnique({ where: { id: user.schoolId }, select: { code: true } });
    return Boolean(school && flags.allowedSchoolCodes.includes(school.code));
  } catch {
    return false; // fails closed, same reasoning as routes/assistant.js
  }
}

/** Gate middleware — runs BEFORE multer, so a disabled/out-of-rollout request never buffers an upload. */
function requireAttachmentsEnabled() {
  return asyncHandler(async (req, res, next) => {
    const flags = readAttachmentFlags(process.env);
    if (!(await isWithinRollout(req.user, flags))) {
      return res.status(503).json({ error: 'This feature is not available right now.', code: 'ATTACHMENTS_DISABLED' });
    }
    req.attachmentFlags = flags;
    next();
  });
}

/** Maps a multer error (oversized file, too many files, wrong field, etc.) to the app's error contract. */
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      const maxMb = req.attachmentFlags?.maxFileSizeMb ?? 8;
      return res.status(400).json({ error: `A file is too large. Maximum size is ${maxMb}MB per file.`, code: 'FILE_TOO_LARGE' });
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      const maxFiles = req.attachmentFlags?.maxFiles ?? 5;
      return res.status(400).json({ error: `Too many files attached. Maximum is ${maxFiles} at once.`, code: 'TOO_MANY_FILES' });
    }
    return res.status(400).json({ error: 'Could not process the uploaded file(s).', code: 'UPLOAD_ERROR' });
  }
  return next(err);
}

// Wording for this route's Gemini-failure responses, passed to the shared sendAiError mapper (lib/).
const AI_ERROR_MESSAGES = {
  safetyBlockedMessage: "This couldn't be processed — try rephrasing your question.",
  upstreamUnavailableMessage: 'Failed to process the attachment. Please try again.',
};

router.post(
  '/coach/attachment',
  authRequired,
  requireAttachmentsEnabled(),
  (req, res, next) =>
    getUploadMiddleware(req.attachmentFlags.maxFileSizeMb, req.attachmentFlags.maxFiles)(req, res, (err) =>
      handleMulterError(err, req, res, next)
    ),
  asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const flags = req.attachmentFlags;

    const attachmentGemini = req.app.locals.attachmentGemini || req.app.locals.gemini;
    if (!attachmentGemini || typeof attachmentGemini.generateContent !== 'function') {
      return res.status(503).json({ error: 'AI features are unavailable right now.', requestId });
    }

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ error: 'At least one file is required.', code: 'FILE_REQUIRED', requestId });
    }

    const { query, language = 'en' } = req.body || {};
    if (typeof query !== 'string' || query.trim().length === 0) {
      return res.status(400).json({ error: 'A non-empty "query" string is required.', requestId });
    }
    if (query.length > MAX_QUERY_LENGTH) {
      return res.status(400).json({ error: `Query must be at most ${MAX_QUERY_LENGTH} characters.`, requestId });
    }
    if (typeof language !== 'string' || !LANGUAGE_NAMES[language]) {
      return res.status(400).json({ error: 'Unsupported "language".', requestId });
    }

    const normalizedQuery = normalizeQuery(query.trim());
    if (normalizedQuery.length === 0) {
      return res.status(400).json({ error: 'A non-empty "query" string is required.', requestId });
    }

    // Per-user daily budget using assistant/budget.js's generic counter. One unit per request however many files it
    // carries; the per-request size and count caps bound the worst case.
    const budget = req.app.locals.attachmentBudget;
    if (budget && !budget.consume(req.user.id)) {
      return res.status(429).json({
        error: 'You have used up today\'s attachment budget. Please try again tomorrow.',
        code: 'BUDGET_EXHAUSTED',
        requestId,
      });
    }

    const validation = validateAttachmentBatch(
      files.map((f) => f.buffer),
      {
        maxBytes: flags.maxFileSizeMb * 1024 * 1024,
        maxPdfPages: flags.maxPdfPages,
        maxFiles: flags.maxFiles,
        maxTotalBytes: flags.maxTotalSizeMb * 1024 * 1024,
      }
    );
    if (!validation.ok) {
      return res.status(400).json({ error: validation.message, code: validation.code, requestId });
    }

    try {
      const attachments = files.map((file, i) => ({ buffer: file.buffer, mimeType: validation.files[i].mimeType }));
      const result = await describeAttachment({
        gemini: attachmentGemini,
        attachments,
        query: normalizedQuery,
        language,
        correlationId: requestId,
      });

      console.log('[attachments] coach_attachment_completed', { requestId, fileCount: files.length, ...result.metrics });

      return res.json({
        success: true,
        text: result.text,
        responseTime: result.metrics.latencyMs,
        timestamp: new Date().toISOString(),
        language,
        context: {},
        queryId: null,
        requestId,
      });
    } catch (error) {
      console.error('[attachments] coach_attachment_failed', {
        requestId,
        fileCount: files.length,
        status: error.status,
        code: error.code,
        message: error.message,
        ...(error.metrics || {}),
      });
      return sendAiError(res, error, requestId, AI_ERROR_MESSAGES);
    }
  })
);

module.exports = router;
