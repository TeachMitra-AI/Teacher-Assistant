// Authentication: teachers sign in with a school code + their name + a 6-digit PIN.
const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { signToken, authRequired } = require('../middleware/auth');

const router = express.Router();

const MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5', 10);
const LOCKOUT_MINUTES = parseInt(process.env.LOGIN_LOCKOUT_MINUTES || '15', 10);

const credentialsSchema = z.object({
  schoolCode: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(60),
  pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits.'),
});

const RESPONSE_STYLES = ['balanced', 'concise', 'detailed', 'step_by_step', 'practical'];

const preferencesSchema = z
  .object({
    defaultLanguage: z.string().trim().max(20).optional(),
    defaultGrade: z.string().trim().max(60).optional(),
    defaultSubject: z.string().trim().max(60).optional(),
    defaultClassroomType: z.string().trim().max(60).optional(),
    responseStyle: z.enum(RESPONSE_STYLES).optional(),
    avatar: z.string().trim().max(20).optional(),
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
router.post('/register', async (req, res) => {
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

  const token = signToken(user);
  return res.status(201).json({ token, user: publicUser(user, school) });
});

// POST /api/auth/login — returning teacher/admin sign-in.
router.post('/login', async (req, res) => {
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

  const token = signToken(user);
  return res.json({ token, user: publicUser(user, school) });
});

// GET /api/auth/me — current profile from a valid token.
router.get('/me', authRequired, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { school: true },
  });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  return res.json({ user: publicUser(user, user.school) });
});

// PATCH /api/auth/me — update the caller's own display name and/or preferences.
// The login `name` is the identity credential and is intentionally NOT editable.
router.patch('/me', authRequired, async (req, res) => {
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
});

// PATCH /api/auth/me/pin — change the caller's own PIN after verifying the current one.
router.patch('/me/pin', authRequired, async (req, res) => {
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
});

module.exports = router;
