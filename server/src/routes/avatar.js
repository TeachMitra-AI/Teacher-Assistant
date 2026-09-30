// Custom profile pictures: POST/DELETE /api/auth/me/avatar (upload/remove the caller's photo) and GET
// /api/users/:userId/avatar (serve one). A sibling of routes/auth.js; it reuses auth.js's publicUser() so an
// upload/remove returns the same user DTO as PATCH /auth/me, and lib/fileValidation.js's magic-byte sniffing.
// Storage: bytes live in the ProfilePicture table (SQLite BLOB via Prisma's Bytes). Uploads are never written to local
// disk (ephemeral filesystem, see routes/attachments.js) and there's no external object storage, so the DB suits a
// small per-user image.
// Serving: GET /users/:userId/avatar is public (no authRequired), versioned by the picture's updatedAt (see
// publicUser()'s avatarUrl in routes/auth.js). Plain <img> tags send no Authorization header, a profile photo isn't
// sensitive, and User.id is an unguessable cuid, so this beat signed URLs for v1.
const express = require('express');
const multer = require('multer');

const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { sniffMimeType } = require('../lib/fileValidation');
const { prisma } = require('../lib/db');
const { publicUser } = require('./auth');

const router = express.Router();

// Hardcoded, not env-configurable: a core Settings capability, not a cost-tunable AI feature.
const AVATAR_MAX_FILE_SIZE_MB = 5;

// Narrower than fileValidation.js's ALLOWED_MIME_TYPES (which includes PDF for attachments): an avatar is always a photo.
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

    // Magic-byte sniffing, not the client-declared Content-Type, as in fileValidation.js.
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
    // Safe to cache aggressively: the URL is versioned by updatedAt, so a new photo gets a new URL. Content-Type is set
    // with the raw setHeader because res.set() appends "; charset=utf-8" for some types, wrong for binary.
    res.setHeader('Content-Type', picture.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // Overrides helmet()'s app-wide 'same-origin' for this one route. The image is meant to be embedded via <img src>
    // from the client's origin, often different from the API's. Without this, a plain <img> (no-cors) request is blocked
    // even though a fetch() to the same URL works. Other routes keep the same-origin default.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // Prisma's SQLite Bytes come back as a Uint8Array, not a Buffer, so res.send() would JSON-serialize the bytes.
    // Buffer.from() wraps them (a cheap view) so res.send() sends binary.
    return res.send(Buffer.from(picture.data));
  })
);

module.exports = router;
