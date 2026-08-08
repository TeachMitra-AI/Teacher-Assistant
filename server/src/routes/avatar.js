// Custom profile pictures — POST/DELETE /api/auth/me/avatar (upload/remove
// the caller's own photo) and GET /api/users/:userId/avatar (serve one).
//
// A SIBLING of routes/auth.js, not an extension of it — same pattern as
// routes/attachments.js being its own file alongside index.js's /coach
// handler. It reuses auth.js's publicUser() (see the export at the bottom of
// that file) so an upload/remove returns the exact same user DTO shape
// PATCH /auth/me already does, and reuses lib/fileValidation.js's magic-byte
// sniffing rather than trusting the client-declared mimetype.
//
// STORAGE: image bytes live in the ProfilePicture table (SQLite BLOB via
// Prisma's Bytes type) — see the approved design review. This project
// deliberately never writes uploads to local disk (routes/attachments.js's
// comments explain why: the deployment target's filesystem is ephemeral),
// and has no external object-storage vendor configured, so the DB is the
// right place for a small, per-user image at this project's current scale.
//
// SERVING: GET /users/:userId/avatar is intentionally PUBLIC (no
// authRequired) and versioned by the picture's updatedAt (see
// publicUser()'s avatarUrl in routes/auth.js) — an approved design decision.
// Plain <img> tags never send an Authorization header, so an authenticated
// endpoint would need a signed URL instead; a teacher's profile photo isn't
// sensitive, and User.id is already an unguessable cuid, so "public but
// unguessable" was chosen over that added complexity for v1.
const express = require('express');
const multer = require('multer');

const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { sniffMimeType } = require('../lib/fileValidation');
const { prisma } = require('../lib/db');
const { publicUser } = require('./auth');

const router = express.Router();

// Deliberately hardcoded, not env-configurable like the attachment/assistant
// flags in lib/flags.js — this is a core Settings capability, not a
// cost-tunable AI feature with a rollout to stage.
const AVATAR_MAX_FILE_SIZE_MB = 5;

// Narrower than fileValidation.js's ALLOWED_MIME_TYPES (which also accepts
// PDF, for the attachments feature) — an avatar is always a photo, so PDF
// (and everything else) is rejected here regardless of what sniffMimeType
// would identify it as.
const AVATAR_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_FILE_SIZE_MB * 1024 * 1024 },
}).single('photo');

/** Maps a multer error to the app's error contract — mirrors routes/attachments.js's handleMulterError. */
function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: `The photo is too large. Maximum size is ${AVATAR_MAX_FILE_SIZE_MB}MB.`,
        code: 'FILE_TOO_LARGE',
      });
    }
    return res.status(400).json({ error: 'Could not process the uploaded photo.', code: 'UPLOAD_ERROR' });
  }
  return next(err);
}

/** Re-fetches the caller's user row with exactly what publicUser() needs, after an upload/remove changed it. */
async function loadPublicUser(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { school: true, profilePicture: { select: { updatedAt: true } } },
  });
  return publicUser(user, user.school);
}

router.post(
  '/auth/me/avatar',
  authRequired,
  (req, res, next) => upload(req, res, (err) => handleMulterError(err, req, res, next)),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'A photo is required.', code: 'FILE_REQUIRED' });
    }

    // Magic-byte sniffing, not req.file.mimetype (the client-declared
    // Content-Type) — same rationale as fileValidation.js: a browser sets it
    // from the file extension, which a hostile client can set to anything.
    const mimeType = sniffMimeType(req.file.buffer);
    if (!mimeType || !AVATAR_ALLOWED_MIME_TYPES.includes(mimeType)) {
      return res.status(400).json({
        error: 'Unsupported file type. Please upload a JPEG, PNG, or WEBP image.',
        code: 'UNSUPPORTED_FILE_TYPE',
      });
    }

    await prisma.profilePicture.upsert({
      where: { userId: req.user.id },
      create: { userId: req.user.id, data: req.file.buffer, mimeType, sizeBytes: req.file.buffer.length },
      update: { data: req.file.buffer, mimeType, sizeBytes: req.file.buffer.length },
    });

    return res.json({ user: await loadPublicUser(req.user.id) });
  })
);

router.delete(
  '/auth/me/avatar',
  authRequired,
  asyncHandler(async (req, res) => {
    await prisma.profilePicture.deleteMany({ where: { userId: req.user.id } });
    return res.json({ user: await loadPublicUser(req.user.id) });
  })
);

router.get(
  '/users/:userId/avatar',
  asyncHandler(async (req, res) => {
    const picture = await prisma.profilePicture.findUnique({
      where: { userId: req.params.userId },
      select: { data: true, mimeType: true },
    });
    if (!picture) {
      return res.status(404).json({ error: 'No profile picture set.' });
    }
    // Safe to cache aggressively: the URL is versioned by updatedAt (see
    // publicUser() in routes/auth.js), so a new photo gets a new URL rather
    // than needing invalidation of this one. Uses the raw Node setHeader
    // (not Express's res.set) for Content-Type — res.set() auto-appends
    // "; charset=utf-8" to the header for some mime types, which is wrong
    // for a binary image.
    res.setHeader('Content-Type', picture.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // Overrides helmet()'s app-wide default of 'same-origin' (index.js) for
    // this ONE route only. This resource is DESIGNED to be embedded via
    // <img src> from wherever the client is hosted — which is routinely a
    // different origin than the API (see README's "ships as two pieces"
    // deployment shape, and CORS_ORIGINS existing at all). Without this, a
    // plain <img> tag's cross-origin (no-cors) request is silently blocked
    // by the browser even though an in-page fetch() to the identical URL
    // succeeds (fetch goes through normal CORS, which this app already
    // allows) — the same-origin default is correct for every OTHER route in
    // this app, which have no business being embedded cross-origin, so it's
    // relaxed only here rather than globally.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // Prisma's SQLite Bytes fields come back as a plain Uint8Array, not a
    // Node Buffer — Buffer.isBuffer() on it is false, which makes Express's
    // res.send() silently fall through to res.json() and JSON-serialize the
    // image bytes as text instead of sending them as binary. Wrapping in
    // Buffer.from() (a cheap view, not a copy of new data) is what makes
    // res.send() take the actual binary path.
    return res.send(Buffer.from(picture.data));
  })
);

module.exports = router;
