// Authentication: teachers sign in with a school code + their name + a 6-digit PIN.
const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const {
  signAccessToken,
  authRequired,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
} = require('../middleware/auth');

const router = express.Router();

// Creates a new server-tracked refresh-token session and its paired access
// token. Every login/register/refresh call goes through this so a session
// can always be found and revoked later (Section 2 of the Phase 0 plan).
async function issueSession(user, req) {
  const refreshToken = generateRefreshToken();
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshTokenExpiry(),
      userAgent: (req.headers['user-agent'] || '').slice(0, 255) || null,
    },
  });
  return { token: signAccessToken(user), refreshToken };
}

const MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5', 10);
const LOCKOUT_MINUTES = parseInt(process.env.LOGIN_LOCKOUT_MINUTES || '15', 10);

const credentialsSchema = z.object({
  schoolCode: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(60),
  pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits.'),
});

const RESPONSE_STYLES = ['balanced', 'concise', 'detailed', 'step_by_step', 'practical'];

// Site-wide defaults for the quiz/worksheet exam-paper letterhead (Phase 3 of
// the quiz/worksheet generator rework). Purely presentational teacher input —
// never sent to Gemini — so it's validated here only to keep the stored JSON
// well-formed, not for any AI-safety reason. Per-resource overrides live in
// Resource.structured (see server/src/routes/resources.js), not here.
const examPaperDefaultsSchema = z
  .object({
    schoolName: z.string().trim().max(120).optional(),
    teacherName: z.string().trim().max(80).optional(),
    defaultInstructions: z.string().trim().max(500).optional(),
    showDate: z.boolean().optional(),
    showTime: z.boolean().optional(),
  })
  .strict();

const preferencesSchema = z
  .object({
    defaultLanguage: z.string().trim().max(20).optional(),
    defaultGrade: z.string().trim().max(60).optional(),
    defaultSubject: z.string().trim().max(60).optional(),
    defaultClassroomType: z.string().trim().max(60).optional(),
    responseStyle: z.enum(RESPONSE_STYLES).optional(),
    avatar: z.string().trim().max(20).optional(),
    examPaperDefaults: examPaperDefaultsSchema.optional(),
  })
  .strict();

const profileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60).nullable().optional(),
    preferences: preferencesSchema.optional(),
  })
  .strict();

const pinChangeSchema = z.object({
  currentPin: z.string().regex(/^\d{6}$/, 'Current PIN must be 6 digits.'),
  newPin: z.string().regex(/^\d{6}$/, 'New PIN must be exactly 6 digits.'),
});

function normalizeCode(code) {
  return code.trim().toUpperCase();
}

function parsePreferences(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function publicUser(user, school) {
  return {
    id: user.id,
    name: user.name,
    displayName: user.displayName || null,
    role: user.role,
    preferences: parsePreferences(user.preferences),
    school: { id: school.id, name: school.name, code: school.code },
  };
}

// POST /api/auth/register — first-time teacher sign-up under a valid school code.
router.post('/register', asyncHandler(async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid details.' });
  }
  const { schoolCode, name, pin } = parsed.data;

  const school = await prisma.school.findUnique({ where: { code: normalizeCode(schoolCode) } });
  if (!school) {
    return res.status(400).json({ error: 'Invalid school code. Please check with your administrator.' });
  }

  const existing = await prisma.user.findUnique({
    where: { schoolId_name: { schoolId: school.id, name } },
  });
  if (existing) {
    return res.status(409).json({
      error: 'This name is already registered at this school. Please log in, or add an initial to your name.',
    });
  }

  const pinHash = await bcrypt.hash(pin, 10);
  const user = await prisma.user.create({
    data: { schoolId: school.id, name, pinHash, role: 'teacher', lastLogin: new Date() },
  });

  const { token, refreshToken } = await issueSession(user, req);
  return res.status(201).json({ token, refreshToken, user: publicUser(user, school) });
}));

// POST /api/auth/login — returning teacher/admin sign-in.
router.post('/login', asyncHandler(async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid details.' });
  }
  const { schoolCode, name, pin } = parsed.data;

  const school = await prisma.school.findUnique({ where: { code: normalizeCode(schoolCode) } });
  if (!school) {
    return res.status(401).json({ error: 'Invalid school code.' });
  }

  const user = await prisma.user.findUnique({
    where: { schoolId_name: { schoolId: school.id, name } },
  });
  if (!user) {
    return res.status(401).json({ error: 'Incorrect name or PIN.' });
  }

  // Account lockout after too many failed attempts.
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return res.status(423).json({ error: `Too many attempts. Try again in ${minutes} minute(s).` });
  }

  const ok = await bcrypt.compare(pin, user.pinHash);
  if (!ok) {
    const failed = user.failedLoginCount + 1;
    const shouldLock = failed >= MAX_ATTEMPTS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: shouldLock ? 0 : failed,
        lockedUntil: shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60000) : null,
      },
    });
    if (shouldLock) {
      return res.status(423).json({ error: `Too many attempts. Try again in ${LOCKOUT_MINUTES} minute(s).` });
    }
    return res.status(401).json({ error: 'Incorrect name or PIN.' });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLogin: new Date() },
  });

  const { token, refreshToken } = await issueSession(user, req);
  return res.json({ token, refreshToken, user: publicUser(user, school) });
}));

// POST /api/auth/refresh — exchange a still-valid refresh token for a new
// access+refresh pair. Rotates the refresh token on every call: the old one
// is marked revoked (and linked via replacedBy) so it can never be used
// again. Presenting an already-revoked token is treated as likely theft and
// revokes every session the user has, forcing a fresh login everywhere.
const refreshSchema = z.object({ refreshToken: z.string().min(20) });

router.post('/refresh', asyncHandler(async (req, res) => {
  const parsed = refreshSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid refresh token.' });
  const { refreshToken } = parsed.data;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: { include: { school: true } } },
  });
  if (!session) {
    return res.status(401).json({ error: 'Session not found. Please log in again.' });
  }
  if (session.revokedAt) {
    await prisma.session.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.status(401).json({ error: 'Session has been revoked. Please log in again.' });
  }
  if (session.expiresAt < new Date()) {
    return res.status(401).json({ error: 'Session has expired. Please log in again.' });
  }

  const { user } = session;
  const newRefreshToken = generateRefreshToken();
  const newSession = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(newRefreshToken),
      expiresAt: refreshTokenExpiry(),
      userAgent: (req.headers['user-agent'] || '').slice(0, 255) || null,
    },
  });
  await prisma.session.update({
    where: { id: session.id },
    data: { revokedAt: new Date(), replacedBy: newSession.id, lastUsedAt: new Date() },
  });

  return res.json({
    token: signAccessToken(user),
    refreshToken: newRefreshToken,
    user: publicUser(user, user.school),
  });
}));

// POST /api/auth/logout — revoke one refresh-token session. Always returns
// success even if the token was already gone, so the client can clear its
// local storage unconditionally without special-casing the response.
router.post('/logout', asyncHandler(async (req, res) => {
  const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
  if (refreshToken) {
    await prisma.session.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  return res.json({ success: true });
}));

// GET /api/auth/sessions — the caller's own active (non-revoked, non-expired) sessions.
router.get('/sessions', authRequired, asyncHandler(async (req, res) => {
  const sessions = await prisma.session.findMany({
    where: { userId: req.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, lastUsedAt: true, userAgent: true, expiresAt: true },
  });
  return res.json({ sessions });
}));

// DELETE /api/auth/sessions/:id — revoke one of the caller's own sessions
// (e.g. "sign out of another device"). Ownership-checked the same way
// routes/queries.js checks a query's userId.
router.delete('/sessions/:id', authRequired, asyncHandler(async (req, res) => {
  const session = await prisma.session.findUnique({ where: { id: req.params.id } });
  if (!session || session.userId !== req.user.id) {
    return res.status(404).json({ error: 'Session not found.' });
  }
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  return res.json({ success: true });
}));

// GET /api/auth/me — current profile from a valid token.
router.get('/me', authRequired, asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { school: true },
  });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  return res.json({ user: publicUser(user, user.school) });
}));

// PATCH /api/auth/me — update the caller's own display name and/or preferences.
// The login `name` is the identity credential and is intentionally NOT editable.
router.patch('/me', authRequired, asyncHandler(async (req, res) => {
  const parsed = profileSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid profile details.' });
  }

  const existing = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { school: true },
  });
  if (!existing) return res.status(404).json({ error: 'User not found.' });

  const data = {};
  if ('displayName' in parsed.data) {
    data.displayName = parsed.data.displayName ? parsed.data.displayName : null;
  }
  if (parsed.data.preferences) {
    // Merge with any existing preferences so partial updates don't wipe others.
    const merged = { ...parsePreferences(existing.preferences), ...parsed.data.preferences };
    data.preferences = JSON.stringify(merged);
  }

  const updated = await prisma.user.update({
    where: { id: req.user.id },
    data,
    include: { school: true },
  });
  return res.json({ user: publicUser(updated, updated.school) });
}));

// PATCH /api/auth/me/pin — change the caller's own PIN after verifying the current one.
router.patch('/me/pin', authRequired, asyncHandler(async (req, res) => {
  const parsed = pinChangeSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid PIN.' });
  }
  const { currentPin, newPin } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found.' });

  const ok = await bcrypt.compare(currentPin, user.pinHash);
  if (!ok) return res.status(401).json({ error: 'Current PIN is incorrect.' });

  const pinHash = await bcrypt.hash(newPin, 10);
  await prisma.user.update({ where: { id: user.id }, data: { pinHash } });
  return res.json({ ok: true });
}));

module.exports = router;
