// Multimodal attachments — POST /api/coach/attachment.
//
// A SIBLING of /api/coach, not an extension of it: same response envelope,
// same auth, same normalization discipline, but its own route so the
// existing, most-used /api/coach handler is never touched by this feature
// (approved design — see docs/multimodal-attachments-architecture.md).
//
// FILES ARE NEVER PERSISTED. multer buffers the upload in PROCESS MEMORY
// only (memoryStorage — diskStorage is never used anywhere in this file, on
// purpose: Railway's filesystem is ephemeral, and writing an upload to disk
// here would be a silent landmine for that deployment target). The buffer is
// discarded when the request completes; there is nothing to clean up because
// nothing is ever stored.
//
// SCOPE: this file owns exactly this one endpoint, the same way
// routes/assistant.js owns the router's three endpoints. It reuses
// lib/fileValidation.js (byte-level validation), attachments/describeAttachment.js
// (the Gemini call), and assistant/budget.js's generic per-user counter
// (already file-agnostic despite its folder) rather than re-implementing any
// of them.

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { readAttachmentFlags } = require('../lib/flags');
const { validateAttachmentBatch } = require('../lib/fileValidation');
const { describeAttachment } = require('../attachments/describeAttachment');
const { normalizeQuery } = require('../safety/inputGuard');
const { LANGUAGE_NAMES } = require('../prompts');
const { prisma } = require('../lib/db');

const router = express.Router();

// Mirrors MAX_QUERY_LENGTH in index.js (the /coach bound). Not imported from
// there — index.js does not export it, and duplicating one constant here is
// cheaper and safer than reaching into the app's entry-point module for it.
// Promote to a shared leaf module if a third file ever needs the same bound
// (see lib/resourceFields.js for the precedent on when that trigger fires).
const MAX_QUERY_LENGTH = 500;

let uploadMiddleware = null;
let cachedKey = null;

/**
 * Builds (and caches) the multer instance for the currently configured
 * per-file size cap and file-count cap. Flags are read per-request elsewhere
 * in this app (so a flag flip + restart is the whole procedure); multer's own
 * `limits` are fixed at middleware-construction time, so this rebuilds only
 * when either configured value actually changes — in practice once, at first
 * use, and again only if a test deliberately varies the env between requests.
 *
 * `.array('files', maxFiles)` accepts one-to-many uploads under the SAME
 * field name ('files') — a single file is just a one-element array, which is
 * how backward compatibility with a single upload is preserved without a
 * second code path for the singular case.
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
 * Same rollout predicate shape as routes/assistant.js's isWithinRollout,
 * scoped to attachments' own flags. Kept local (not shared) since the two
 * features gate on different flag sets and different failure semantics
 * (the router degrades to an inert catalog; this endpoint degrades to a
 * plain 503, matching how routes/resources.js already reports "AI features
 * are unavailable right now" when its own gemini instance is unset).
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

// Same mapping shape as routes/resources.js's sendAiError — kept as its own
// small copy rather than a shared import, matching how index.js's /coach
// handler already has its own independent copy of this same mapping. Three
// near-identical copies already exist in this codebase; unifying them is a
// pre-existing refactor this feature does not need to take on.
function sendAiError(res, error, requestId) {
  if (error.code === 'INPUT_BLOCKED' || error.code === 'OUTPUT_BLOCKED') {
    return res.status(422).json({ error: "This couldn't be processed — try rephrasing your question.", code: 'SAFETY_BLOCKED', requestId });
  }
  if (error.code === 'DEADLINE_EXCEEDED' || error.name === 'TimeoutError' || error.name === 'AbortError') {
    return res.status(504).json({ error: 'The request took too long. Please try again.', code: 'TIMEOUT', requestId });
  }
  if (error.status === 429) {
    return res.status(429).json({ error: 'The service is busy. Please try again shortly.', code: 'RATE_LIMITED', requestId });
  }
  return res.status(502).json({ error: 'Failed to process the attachment. Please try again.', code: 'UPSTREAM_UNAVAILABLE', requestId });
}

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

    // Per-user daily budget, same shape as the router's (assistant/budget.js
    // is already generic — reused directly rather than copied). One unit per
    // REQUEST regardless of how many files it carries — a batch of files is
    // still one message the teacher sent, and the per-request size/count caps
    // below already bound the worst case a single unit of budget can cost.
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
      return sendAiError(res, error, requestId);
    }
  })
);

module.exports = router;
