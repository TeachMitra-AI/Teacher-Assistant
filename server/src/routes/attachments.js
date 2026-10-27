// Multimodal attachments: POST /api/coach/attachment, a sibling of /api/coach rather than an extension, with the same
// response envelope, auth and normalization, so the most-used /coach handler is untouched
// (docs/multimodal-attachments-architecture.md).
// Files are never persisted: multer uses memoryStorage and the buffer is discarded when the request completes. Never
// use diskStorage here; Railway's filesystem is ephemeral.
// It reuses attachments/uploadGate.js (flag gate + multer), lib/fileValidation.js, attachments/describeAttachment.js and
// assistant/budget.js's generic per-user counter.

const crypto = require('crypto');
const express = require('express');

const { asyncHandler } = require('../lib/asyncHandler');
const { sendAiError } = require('../lib/sendAiError');
const { authRequired } = require('../middleware/auth');
const { requireAttachmentsEnabled, uploadFiles } = require('../attachments/uploadGate');
const { validateAttachmentBatch } = require('../lib/fileValidation');
const { describeAttachment } = require('../attachments/describeAttachment');
const { normalizeQuery } = require('../safety/inputGuard');
const { LANGUAGE_NAMES } = require('../prompts');

const router = express.Router();

// Mirrors MAX_QUERY_LENGTH in index.js (the /coach bound), which index.js doesn't export. Promote to a shared leaf
// module if a third file needs it (see lib/resourceFields.js).
const MAX_QUERY_LENGTH = 500;

// Wording for this route's Gemini-failure responses, passed to the shared sendAiError mapper (lib/).
const AI_ERROR_MESSAGES = {
  safetyBlockedMessage: "This couldn't be processed — try rephrasing your question.",
  upstreamUnavailableMessage: 'Failed to process the attachment. Please try again.',
};

router.post(
  '/coach/attachment',
  authRequired,
  requireAttachmentsEnabled(),
  uploadFiles,
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
