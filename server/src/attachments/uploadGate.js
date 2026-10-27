// The upload gate shared by every route that takes image/PDF attachments: POST /api/coach/attachment
// (routes/attachments.js) and POST /api/resources/generate-from-source (routes/resources.js). Moved here unchanged
// from routes/attachments.js so both routes run the same flag check, rollout filter and multer limits.
// Files are never persisted: multer uses memoryStorage and the buffer is discarded when the request completes. Never
// use diskStorage here; Railway's filesystem is ephemeral.

const multer = require('multer');

const { asyncHandler } = require('../lib/asyncHandler');
const { readAttachmentFlags } = require('../lib/flags');
const { prisma } = require('../lib/db');

// One multer instance per (size, count) pair. Two routes use different file-count caps, so a single cached instance
// would be rebuilt on every alternating request.
const uploadMiddlewares = new Map();

/**
 * Builds and caches the multer instance for the configured per-file size and file-count caps. Flags are read
 * per request, but multer's `limits` are fixed at construction, so this rebuilds only when a configured value changes.
 * `.array('files', maxFiles)` takes one or many files under the same field name, so a single upload is just a
 * one-element array with no separate code path.
 */
function getUploadMiddleware(maxFileSizeMb, maxFiles) {
  const key = `${maxFileSizeMb}:${maxFiles}`;
  if (!uploadMiddlewares.has(key)) {
    uploadMiddlewares.set(key, multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: maxFileSizeMb * 1024 * 1024, files: maxFiles },
    }).array('files', maxFiles));
  }
  return uploadMiddlewares.get(key);
}

/**
 * Same rollout predicate as routes/assistant.js's isWithinRollout, on attachments' own flags. Kept separate since the
 * two features gate differently: the router degrades to an inert catalog, this gate to a plain 503.
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

/**
 * Gate middleware — runs BEFORE multer, so a disabled/out-of-rollout request never buffers an upload.
 * `extraGate` (optional) is a second switch layered on ATTACHMENTS_ENABLED for a route with its own kill switch:
 * `{ isEnabled: () => boolean, code: string }`. Both must pass; each failure has its own 503 code.
 */
function requireAttachmentsEnabled({ extraGate } = {}) {
  return asyncHandler(async (req, res, next) => {
    const flags = readAttachmentFlags(process.env);
    if (!(await isWithinRollout(req.user, flags))) {
      return res.status(503).json({ error: 'This feature is not available right now.', code: 'ATTACHMENTS_DISABLED' });
    }
    if (extraGate && !extraGate.isEnabled()) {
      return res.status(503).json({ error: 'This feature is not available right now.', code: extraGate.code });
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

/** Runs multer with the limits on `req.attachmentFlags` (set by requireAttachmentsEnabled), mapping its errors. */
function uploadFiles(req, res, next) {
  return getUploadMiddleware(req.attachmentFlags.maxFileSizeMb, req.attachmentFlags.maxFiles)(req, res, (err) =>
    handleMulterError(err, req, res, next)
  );
}

module.exports = { requireAttachmentsEnabled, uploadFiles, getUploadMiddleware, handleMulterError };
