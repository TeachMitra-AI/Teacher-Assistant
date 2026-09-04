// Authentication.
//
// Identity is the teacher's EMAIL, not their name — common names collide
// within a single school, and email is also what Google hands back from a
// verified ID token, so both sign-in methods key off the same field.
//
// The school code picks the tenant at sign-UP only, and is now OPTIONAL there
// (the website's Register form no longer collects one — see
// DEFAULT_REGISTRATION_SCHOOL_CODE below); a caller that still supplies one
// (e.g. the mobile app) is placed at that school exactly as before. Sign-in
// resolves an account by email alone, so a returning teacher never needs the
// code; if one email happens to hold accounts at several schools, the client
// is asked to choose one and re-submits with an explicit schoolId.
//
// New sign-ups are created `status: 'active'` and can sign in immediately.
// statusGateError() below still enforces `pending`/`rejected` for any
// existing account in one of those states (e.g. a manual admin action via
// routes/admin.js) — the approval gate itself isn't removed, new accounts
// just no longer start in it.
const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { sendPasswordResetEmail } = require('../lib/email');
// Called through the module object rather than destructured, so the one
// function that reaches out to Google stays substitutable from a test without
// the route needing a seam of its own.
const googleAuth = require('../lib/googleAuth');
const { getEffectiveFeatureFlags } = require('../lib/systemSettings');
const { readTeacherAttendanceFlags } = require('../lib/flags');
const { logTeacherAttendanceActivity } = require('../lib/teacherAttendanceActivityLog');

// Teacher Attendance's own activity log (decision §1.10 in
// docs/feature-teacher-attendance-implementation-plan.md) — "login is not
// attendance" (§1.1), but it's still one of the events that must be logged.
// Gated the same way every teacher-attendance route gates itself, so a
// school with the feature off never gets one of these rows. Shared by both
// login paths below (password and Google) rather than duplicated.
async function logAttendanceLoginIfEnabled(user) {
  const flags = readTeacherAttendanceFlags(process.env);
  const withinRollout =
    flags.enabled && (flags.allowedSchoolCodes.length === 0 || flags.allowedSchoolCodes.includes(user.school.code));
  if (withinRollout) {
    await logTeacherAttendanceActivity({ schoolId: user.schoolId, userId: user.id, action: 'login' });
  }
}
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
const RESET_TOKEN_TTL_MINUTES = parseInt(process.env.PASSWORD_RESET_TTL_MINUTES || '60', 10);

// Emails are trimmed and lower-cased before validation, so the address a
// teacher types is matched the same way however they capitalize it. The stored
// value is always the normalized one.
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.').max(160));

// 72 bytes is bcrypt's own input limit — anything beyond it is silently
// ignored by the hash, so it's rejected up front rather than truncated.
const newPasswordField = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(72, 'Password must be at most 72 characters.');

// Verifying an EXISTING password deliberately doesn't apply the length rule
// above: rules belong on the path that sets a password, and applying them here
// would turn a wrong-password 401 into a confusing 400.
const existingPasswordField = z.string().min(1, 'Enter your password.').max(72);

const registerSchema = z.object({
  // Optional: the website Register form no longer collects one (see
  // DEFAULT_REGISTRATION_SCHOOL_CODE). A caller that still sends a real code
  // (the mobile app) is placed at that school exactly as before.
  schoolCode: z.string().trim().min(1).max(40).optional(),
  name: z.string().trim().min(2).max(60),
  email: emailField,
  password: newPasswordField,
});

const loginSchema = z.object({
  email: emailField,
  password: existingPasswordField,
  // Only sent on the second attempt, after a needsSchoolSelection response.
  schoolId: z.string().trim().min(1).max(40).optional(),
});

// One wording for every "we won't say which part was wrong" outcome: unknown
// email, wrong password, or a Google-only account with no local password.
const INVALID_CREDENTIALS = 'Incorrect email or password.';

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

// First-run onboarding state (Phase 0 of the onboarding rework). Purely a
// record of what onboarding surfaces the teacher has already seen/dismissed so
// they aren't re-shown across devices — no AI or presentational payload. Rides
// the same preferences JSON blob as examPaperDefaults, so no new table/migration
// is needed. `dismissedTips` is an open-ended list of scoped tip ids future
// phases append to; kept a flat string[] on purpose so a new tip needs no
// schema change, only a new id.
const onboardingSchema = z
  .object({
    seenWelcomeIntro: z.boolean().optional(),
    dismissedTips: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
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
    onboarding: onboardingSchema.optional(),
  })
  .strict();

const profileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(60).nullable().optional(),
    preferences: preferencesSchema.optional(),
  })
  .strict();

const passwordChangeSchema = z.object({
  currentPassword: existingPasswordField,
  newPassword: newPasswordField,
});

function normalizeCode(code) {
  return code.trim().toUpperCase();
}

// The school a sign-up is placed at when the caller supplies no schoolCode
// (the website's Register form, since it no longer asks for one). Must name
// an existing School — chosen because it already has a school_admin in place
// to review new pending accounts.
const DEFAULT_REGISTRATION_SCHOOL_CODE = 'RAMPUR01';

// The approval gate, shared by both sign-in methods so email+password and
// Google can never drift apart on who is allowed in. Returns the error code to
// send with a 403, or null when the account may proceed. These strings are a
// contract the client branches on, not display copy.
function statusGateError(user) {
  if (user.status === 'pending') return 'pending_approval';
  if (user.status === 'rejected') return 'registration_rejected';
  return null;
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

// avatarUrl is a path relative to the API root (matching every path the
// client already passes to api(), e.g. '/auth/me') — the client prepends its
// own API_BASE when rendering it in an <img> tag, since <img> requests never
// go through the api() fetch wrapper (no Authorization header to attach
// anyway; see routes/avatar.js for why the serving route is public).
// Versioned by the picture's own updatedAt so the URL changes whenever the
// photo changes, which is what makes the aggressive immutable Cache-Control
// on that route safe. Requires the caller to have loaded
// `profilePicture: { select: { updatedAt: true } }` alongside `school` —
// never `data`, which this DTO must never carry.
function publicUser(user, school) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    displayName: user.displayName || null,
    role: user.role,
    createdAt: user.createdAt,
    preferences: parsePreferences(user.preferences),
    avatarUrl: user.profilePicture
      ? `/users/${user.id}/avatar?v=${user.profilePicture.updatedAt.getTime()}`
      : null,
    school: { id: school.id, name: school.name, code: school.code },
  };
}

// POST /api/auth/register — first-time teacher sign-up. Issues NO session
// itself: the account is created `active`, but this endpoint only reports
// that status back — the client signs the teacher in with a separate
// /auth/login call using the same credentials.
//
// schoolCode is optional (see registerSchema): a caller that supplies one is
// placed at that school; a caller that doesn't (the website form) is placed
// at DEFAULT_REGISTRATION_SCHOOL_CODE automatically.
router.post('/register', asyncHandler(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid details.' });
  }
  const { schoolCode, name, email, password } = parsed.data;

  const school = await prisma.school.findUnique({
    where: { code: schoolCode ? normalizeCode(schoolCode) : DEFAULT_REGISTRATION_SCHOOL_CODE },
  });
  if (!school) {
    return res.status(400).json({
      error: schoolCode
        ? 'Invalid school code. Please check with your administrator.'
        : 'Registration is not available right now. Please try again later.',
    });
  }

  const existing = await prisma.user.findUnique({
    where: { schoolId_email: { schoolId: school.id, email } },
  });
  if (existing) {
    return res.status(409).json({
      error: 'An account with this email already exists at this school. Please sign in instead.',
    });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { schoolId: school.id, name, email, passwordHash, role: 'teacher', status: 'active' },
  });

  return res.status(201).json({ status: 'active' });
}));

// POST /api/auth/login — returning teacher/admin sign-in with email +
// password. No school code: the account is found by email across every
// school. That lookup is intentionally non-unique, because the same address
// could hold accounts at more than one school — when it matches several, the
// client gets a school picker instead of a session and re-submits with an
// explicit `schoolId`.
router.post('/login', asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid details.' });
  }
  const { email, password, schoolId } = parsed.data;

  const matches = await prisma.user.findMany({
    where: { email, ...(schoolId ? { schoolId } : {}) },
    include: { school: true, profilePicture: { select: { updatedAt: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (matches.length === 0) {
    return res.status(401).json({ error: INVALID_CREDENTIALS });
  }
  if (matches.length > 1) {
    return res.json({
      needsSchoolSelection: true,
      schools: matches.map((u) => ({ id: u.school.id, name: u.school.name, code: u.school.code })),
    });
  }

  const user = matches[0];

  // Account lockout after too many failed attempts.
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return res.status(423).json({ error: `Too many attempts. Try again in ${minutes} minute(s).` });
  }

  // A Google-only account has no local password to compare against. Treated as
  // a plain credential failure so this response can't be used to tell a
  // Google-only account apart from a nonexistent one.
  const ok = user.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;
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
    return res.status(401).json({ error: INVALID_CREDENTIALS });
  }

  // Approval gate. Checked only after the password is proven, so an account's
  // pending/rejected state is never disclosed to someone who doesn't hold the
  // credential. These two error codes are contract, not prose — the client
  // switches to a dedicated screen on each.
  const statusError = statusGateError(user);
  if (statusError) return res.status(403).json({ error: statusError });

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLogin: new Date() },
  });
  await logAttendanceLoginIfEnabled(user);

  const { token, refreshToken } = await issueSession(user, req);
  return res.json({
    token,
    refreshToken,
    user: publicUser(user, user.school),
    featureFlags: await getEffectiveFeatureFlags(),
  });
}));

const googleAuthSchema = z.object({
  idToken: z.string().trim().min(20).max(4096),
  // Either one supplied => this is a sign-UP. schoolCode (when present) picks
  // the tenant, same as /register. `signup` is the website's no-code path —
  // it no longer collects a schoolCode, so it sends this instead and the
  // account lands at DEFAULT_REGISTRATION_SCHOOL_CODE. Neither => sign-in.
  schoolCode: z.string().trim().min(1).max(40).optional(),
  signup: z.boolean().optional(),
  // Display name from the sign-up form. Purely presentational; if omitted, the
  // name on the verified Google profile is used instead.
  name: z.string().trim().min(2).max(60).optional(),
  // Only sent on the second attempt, after a needsSchoolSelection response.
  schoolId: z.string().trim().min(1).max(40).optional(),
});

// POST /api/auth/google — one endpoint for both Google sign-up and Google
// sign-in, branching on whether a schoolCode or a signup flag was supplied.
// It's a fully parallel alternative to email+password, not a replacement: the
// two share the same User rows, the same approval gate, and the same
// issueSession().
//
// Identity comes from Google's verified `sub`, not from the email in the
// request body. Signing in is matched on `sub` alone — deliberately NOT on
// email — so a Google token can never be used to take over an account created
// with a password. (Linking a Google identity onto an existing manual account
// is a separate feature, out of scope here.)
router.post('/google', asyncHandler(async (req, res) => {
  if (!googleAuth.isGoogleAuthConfigured()) {
    return res.status(503).json({ error: 'google_not_configured' });
  }

  const parsed = googleAuthSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid Google sign-in request.' });
  }
  const { idToken, schoolCode, signup, name, schoolId } = parsed.data;

  let identity;
  try {
    identity = await googleAuth.verifyGoogleIdToken(idToken);
  } catch (error) {
    // Metadata only — an ID token is a credential and never belongs in a log.
    console.warn('[auth] google_token_rejected', { name: error.name });
    return res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
  }

  // ---- Sign-UP: a school code or an explicit signup flag was supplied ----
  if (schoolCode || signup) {
    const school = await prisma.school.findUnique({
      where: { code: schoolCode ? normalizeCode(schoolCode) : DEFAULT_REGISTRATION_SCHOOL_CODE },
    });
    if (!school) {
      return res.status(400).json({
        error: schoolCode
          ? 'Invalid school code. Please check with your administrator.'
          : 'Registration is not available right now. Please try again later.',
      });
    }

    const existing = await prisma.user.findFirst({
      where: {
        schoolId: school.id,
        OR: [{ email: identity.email }, { googleSub: identity.sub }],
      },
    });
    if (existing) {
      return res.status(409).json({
        error: 'An account with this email already exists at this school. Please sign in instead.',
      });
    }

    await prisma.user.create({
      data: {
        schoolId: school.id,
        // Google's profile name is a reasonable default, but the sign-up form's
        // value wins when present. Falls back to the local part of the address
        // so `name` is never blank.
        name: name || identity.name || identity.email.split('@')[0],
        email: identity.email,
        googleSub: identity.sub,
        role: 'teacher',
        status: 'active',
      },
    });

    return res.status(201).json({ status: 'active' });
  }

  // ---- Sign-IN: neither schoolCode nor signup was supplied ----
  const matches = await prisma.user.findMany({
    where: { googleSub: identity.sub, ...(schoolId ? { schoolId } : {}) },
    include: { school: true, profilePicture: { select: { updatedAt: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (matches.length === 0) {
    // Distinct from a failed token: the token was fine, there's just no
    // account yet. The client uses this to offer sign-up instead.
    return res.status(404).json({ error: 'google_not_registered' });
  }
  if (matches.length > 1) {
    return res.json({
      needsSchoolSelection: true,
      schools: matches.map((u) => ({ id: u.school.id, name: u.school.name, code: u.school.code })),
    });
  }

  const user = matches[0];

  const statusError = statusGateError(user);
  if (statusError) return res.status(403).json({ error: statusError });

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLogin: new Date() },
  });
  await logAttendanceLoginIfEnabled(user);

  const { token, refreshToken } = await issueSession(user, req);
  return res.json({
    token,
    refreshToken,
    user: publicUser(user, user.school),
    featureFlags: await getEffectiveFeatureFlags(),
  });
}));

const forgotPasswordSchema = z.object({ email: emailField });

const resetPasswordSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: newPasswordField,
});

// POST /api/auth/forgot-password — start a self-service password reset.
//
// The response is byte-identical whether or not the address has an account, so
// this endpoint can't be used to discover who is registered. Rate limiting
// comes from the /api/auth-wide authLimiter in index.js.
//
// A reset token follows the same rules as a refresh token: generated from a
// CSPRNG, and only its SHA-256 hash is stored, so the database never holds
// anything replayable.
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body || {});
  // A malformed address is a client-side format problem, not a statement about
  // who exists, so rejecting it leaks nothing.
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Enter a valid email address.' });
  }
  const { email } = parsed.data;

  // Only accounts that could actually sign in are resettable. A pending or
  // rejected sign-up has no session to restore, and a Google-only account has
  // no password to replace.
  const users = await prisma.user.findMany({
    where: { email, status: 'active', passwordHash: { not: null } },
    include: { school: true },
  });

  // The same address may hold accounts at more than one school; each gets its
  // own token and its own email, named so the teacher can tell them apart.
  const namePerSchool = users.length > 1;

  for (const user of users) {
    // Issuing a new link retires any earlier unused one, so a forwarded or
    // intercepted older email stops working the moment a fresh one is asked for.
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = generateRefreshToken();
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60000),
      },
    });

    await sendPasswordResetEmail({
      to: user.email,
      token,
      name: user.displayName || user.name,
      schoolName: namePerSchool ? user.school.name : null,
      expiresInMinutes: RESET_TOKEN_TTL_MINUTES,
    });
  }

  return res.json({ ok: true });
}));

// POST /api/auth/reset-password — redeem a reset token and set a new password.
//
// Every existing session is revoked on success. A password reset is a
// credential change, and whoever prompted it may not be the person holding the
// old sessions — this mirrors the reuse-detection precedent in /auth/refresh,
// which also revokes everything when a credential looks compromised.
router.post('/reset-password', asyncHandler(async (req, res) => {
  // Unknown, already-redeemed, expired and malformed tokens are all reported
  // the same way — there's nothing useful a caller could do with the
  // distinction, and the person holding a truncated link can't tell it from an
  // expired one anyway.
  const invalid = { error: 'This reset link is invalid or has expired. Please request a new one.' };

  const parsed = resetPasswordSchema.safeParse(req.body || {});
  if (!parsed.success) {
    // A bad password IS actionable ("at least 8 characters"), so that message
    // is kept. A bad token is not, so it gets the message above rather than
    // raw schema text like "expected string to have >=20 characters".
    const passwordIssue = parsed.error.issues.find((issue) => issue.path[0] === 'password');
    return res.status(400).json(passwordIssue ? { error: passwordIssue.message } : invalid);
  }
  const { token, password } = parsed.data;

  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
  });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return res.status(400).json(invalid);
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.$transaction([
    // Clearing the lockout counters matters: a teacher who locked themselves
    // out by guessing is exactly who reaches for "forgot password", and they
    // shouldn't hit a 423 immediately after successfully resetting.
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    }),
    prisma.session.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  return res.json({ ok: true });
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
    include: { user: { include: { school: true, profilePicture: { select: { updatedAt: true } } } } },
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

// POST /api/auth/logout — revoke one refresh-token session, and (Phase 7b)
// unregister one push device token in the same call. Always returns success
// even if either token was already gone, so the client can clear its local
// storage unconditionally without special-casing the response.
//
// `deviceToken` is deliberately scoped through the SESSION the refreshToken
// identifies, not through a bearer access token — logout already only
// requires the refresh token (no Authorization header), and reusing that
// same credential to look up `userId` keeps this route's own ownership
// contract (never delete a device token that doesn't belong to whoever is
// logging out) without adding a second auth path. If the refresh token is
// missing/already revoked, there is no `userId` to attribute the device
// token to, so it is left alone — deviceToken cleanup with no valid session
// is silently skipped rather than deleted unowned (mirrors how a missing
// refreshToken already silently skips session revocation above).
router.post('/logout', asyncHandler(async (req, res) => {
  const refreshToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
  const deviceToken = typeof req.body?.deviceToken === 'string' ? req.body.deviceToken : null;

  if (refreshToken) {
    const session = deviceToken
      ? await prisma.session.findUnique({ where: { tokenHash: hashToken(refreshToken) }, select: { userId: true } })
      : null;

    await prisma.session.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (session) {
      await prisma.deviceToken.deleteMany({ where: { token: deviceToken, userId: session.userId } });
    }
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
    include: { school: true, profilePicture: { select: { updatedAt: true } } },
  });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  return res.json({ user: publicUser(user, user.school), featureFlags: await getEffectiveFeatureFlags() });
}));

// PATCH /api/auth/me — update the caller's own display name and/or preferences.
// `email` is the identity key and `name` is what admins see in the Manage
// table, so neither is editable here — only the display name is.
router.patch('/me', authRequired, asyncHandler(async (req, res) => {
  const parsed = profileSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid profile details.' });
  }

  const existing = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { school: true, profilePicture: { select: { updatedAt: true } } },
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
    include: { school: true, profilePicture: { select: { updatedAt: true } } },
  });
  return res.json({ user: publicUser(updated, updated.school) });
}));

// PATCH /api/auth/me/password — change the caller's own password after
// verifying the current one. This is the signed-in path; a teacher who has
// forgotten their password uses /forgot-password instead.
//
// Unlike a reset, existing sessions are deliberately left alone: the caller
// already proved they hold the current password, so signing them out of their
// own other devices would be surprising rather than protective.
router.patch('/me/password', authRequired, asyncHandler(async (req, res) => {
  const parsed = passwordChangeSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid password.' });
  }
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) return res.status(404).json({ error: 'User not found.' });

  // A Google-only account has no local password to verify against, so there is
  // nothing to change here — say so plainly rather than failing as "incorrect".
  if (!user.passwordHash) {
    return res.status(400).json({
      error: 'This account signs in with Google, so it has no password to change.',
    });
  }

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  return res.json({ ok: true });
}));

module.exports = router;
// Attached to the router function so routes/avatar.js can build the same
// user DTO after an upload/remove (it responds with { user: publicUser(...) }
// exactly like PATCH /me does) without duplicating the shape. index.js's
// `app.use('/api/auth', ..., authRouter)` is unaffected — Express only cares
// that the export is callable as middleware, and an extra own property on a
// function is invisible to it.
module.exports.publicUser = publicUser;
