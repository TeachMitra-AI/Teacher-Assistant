// Authentication. Identity is the email, not the name: common names collide within a school, and Google returns
// a verified email too, so both sign-in methods key off it.
// The school code picks the tenant at sign-up only and is optional there (the website form doesn't collect it;
// DEFAULT_REGISTRATION_SCHOOL_CODE applies). Sign-in resolves by email alone; if one email holds accounts at several
// schools, the client is asked to choose and re-submits with an explicit schoolId.
// New sign-ups are `active` and can sign in at once. statusGateError() still enforces `pending`/`rejected` for
// accounts put in those states (e.g. by an admin through routes/admin.js).
const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { isUniqueConstraintError } = require('../lib/prismaErrors');
const { sendPasswordResetEmail } = require('../lib/email');
// Called through the module object so a test can substitute the one function that reaches Google.
const googleAuth = require('../lib/googleAuth');
const { getEffectiveFeatureFlags } = require('../lib/systemSettings');
const { readTeacherAttendanceFlags } = require('../lib/flags');
const { logTeacherAttendanceActivity } = require('../lib/teacherAttendanceActivityLog');

// Teacher Attendance's activity log: login isn't attendance but is still logged
// (docs/feature-teacher-attendance-implementation-plan.md). Gated like every teacher-attendance route, so a school
// with the feature off gets no rows. Shared by the password and Google login paths.
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
  usesCookieTransport,
  readRefreshCookie,
  setRefreshCookie,
  clearRefreshCookie,
} = require('../middleware/auth');

const router = express.Router();

// Creates a server-tracked refresh-token session and its paired access token. Every login, register and refresh
// goes through this so a session can always be found and revoked.
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

// Sends a new session: the refresh token always goes into the HttpOnly cookie, and into the body only for clients that
// have no cookie jar (mobile, older builds). Web clients never see it in JavaScript.
function sendSession(req, res, { token, refreshToken }, body) {
  setRefreshCookie(res, refreshToken);
  return res.json({
    token,
    ...(usesCookieTransport(req) ? {} : { refreshToken }),
    ...body,
  });
}

// Failed password attempts on one account. From FAILED_LOGIN_SLOWDOWN_AFTER on, each further failure is answered after
// FAILED_LOGIN_SLOWDOWN_MS. That slows a distributed guessing run without locking the owner out, so someone else can't lock
// a teacher out of their own account. Per-(IP, email) rate limiting (index.js) caps a single source.
const FAILED_LOGIN_SLOWDOWN_AFTER = parseInt(process.env.LOGIN_SLOWDOWN_AFTER || '10', 10);
const FAILED_LOGIN_SLOWDOWN_MS = 2000;
const RESET_TOKEN_TTL_MINUTES = parseInt(process.env.PASSWORD_RESET_TTL_MINUTES || '60', 10);

// Refresh-token rotation race window. Two tabs (or two requests) refreshing at the same moment both present the token that
// was just rotated. Within this window that's treated as a retryable conflict, not as theft that revokes every session.
const ROTATION_GRACE_MS = 10000;

// Compared against when the email has no account, so a missing account costs the same bcrypt time as a wrong password.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('dummy-password-for-timing', 10);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Zod's own wording ("Invalid input: expected string, received undefined") is written for developers and names internal
// shapes. Every field below carries a plain message; this is the backstop for anything that still falls through to Zod.
const GENERIC_INVALID = 'Please check your details and try again.';
const ZOD_DEFAULT_WORDING = /\b(expected|received|Invalid input|Too (big|small))\b/i;
function firstValidationMessage(error) {
  const message = error?.issues?.[0]?.message;
  return message && !ZOD_DEFAULT_WORDING.test(message) ? message : GENERIC_INVALID;
}

// Emails are trimmed and lower-cased before validation so matching is case-insensitive; the stored value is the normalized one.
const emailField = z
  .string({ error: 'Enter your email address.' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Enter a valid email address.' }).max(160, { error: 'Email address is too long.' }));

// 72 bytes is bcrypt's own input limit — anything beyond it is silently
// ignored by the hash, so it's rejected up front rather than truncated.
const newPasswordField = z
  .string({ error: 'Enter a password.' })
  .min(8, { error: 'Password must be at least 8 characters.' })
  .max(72, { error: 'Password must be at most 72 characters.' });

// Verifying an existing password skips the length *minimum*. Accounts created before a rule change can hold shorter
// passwords, and rejecting them here would lock those teachers out. The 72-byte maximum still applies: bcrypt can't hash
// more, so no account can hold a longer one.
const existingPasswordField = z
  .string({ error: 'Enter your password.' })
  .min(1, { error: 'Enter your password.' })
  .max(72, { error: 'Password must be at most 72 characters.' });

const registerSchema = z.object({
  // Optional: the website form doesn't send one (see DEFAULT_REGISTRATION_SCHOOL_CODE); a caller that sends a real code (the mobile app) is placed at that school.
  schoolCode: z.string().trim().min(1).max(40).optional(),
  name: z
    .string({ error: 'Enter your name.' })
    .trim()
    .min(2, { error: 'Name must be at least 2 characters.' })
    .max(60, { error: 'Name must be at most 60 characters.' }),
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

// Shared by /register and /google sign-up, for the normal conflict check and for the P2002 a concurrent duplicate can
// still hit. The wording must be identical on both paths.
const EMAIL_ALREADY_REGISTERED = 'An account with this email already exists at this school. Please sign in instead.';

const RESPONSE_STYLES = ['balanced', 'concise', 'detailed', 'step_by_step', 'practical'];

// Site-wide defaults for the exam-paper letterhead. Presentational teacher input, never sent to Gemini, so it's
// validated only to keep the stored JSON well-formed. Per-resource overrides live in Resource.structured (routes/resources.js).
const examPaperDefaultsSchema = z
  .object({
    schoolName: z.string().trim().max(120).optional(),
    teacherName: z.string().trim().max(80).optional(),
    defaultInstructions: z.string().trim().max(500).optional(),
    showDate: z.boolean().optional(),
    showTime: z.boolean().optional(),
  })
  .strict();

// First-run onboarding state: which onboarding surfaces the teacher has seen or dismissed, so they aren't re-shown
// across devices. Rides the same preferences JSON as examPaperDefaults, so no migration. `dismissedTips` is a flat
// string[] so a new tip needs only a new id.
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

// The school a sign-up lands at when no schoolCode is supplied. It must name an existing School, and this one
// already has a school_admin to review new accounts.
const DEFAULT_REGISTRATION_SCHOOL_CODE = 'RAMPUR01';

// The approval gate shared by both sign-in methods so they can't drift on who may enter. Returns the error code
// for a 403, or null if the account may proceed. The strings are a contract the client branches on, not display copy.
function statusGateError(user) {
  if (user.status === 'pending') return 'pending_approval';
  if (user.status === 'rejected') return 'registration_rejected';
  if (user.status === 'suspended') return 'account_suspended';
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

// avatarUrl is relative to the API root; the client prepends API_BASE, since <img> requests don't go through the
// api() wrapper (routes/avatar.js explains why serving is public). It's versioned by the picture's updatedAt so the
// URL changes with the photo, which makes the immutable Cache-Control safe. The caller must load
// `profilePicture: { select: { updatedAt: true } }` with `school`, never `data`.
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

// POST /api/auth/register: first-time teacher sign-up. Issues no session; the account is created `active` and the
// client signs in separately via /auth/login. schoolCode is optional (see registerSchema): with none, the account
// goes to DEFAULT_REGISTRATION_SCHOOL_CODE.
router.post('/register', asyncHandler(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: firstValidationMessage(parsed.error) });
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

  // An address that already has an account here gets the same 201 as a new one, and nothing is written. Answering 409
  // would tell anyone who can reach this endpoint which teachers have accounts. The client then signs in with the password
  // it was given: if that matches the existing account, the teacher is signed in; if not, the sign-in fails generically.
  const existing = await prisma.user.findUnique({
    where: { schoolId_email: { schoolId: school.id, email } },
  });
  if (existing) {
    return res.status(201).json({ status: 'active' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    await prisma.user.create({
      data: { schoolId: school.id, name, email, passwordHash, role: 'teacher', status: 'active' },
    });
  } catch (err) {
    // Two concurrent registrations for the same email and school can both pass the findUnique check; the loser hits the
    // schoolId_email constraint here, and gets the same response as the winner.
    if (isUniqueConstraintError(err)) {
      return res.status(201).json({ status: 'active' });
    }
    throw err;
  }

  return res.status(201).json({ status: 'active' });
}));

// POST /api/auth/login: sign-in with email and password. No school code: the account is found by email across all
// schools. If several match, the client gets a school picker and re-submits with an explicit `schoolId`.
router.post('/login', asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: firstValidationMessage(parsed.error) });
  }
  const { email, password, schoolId } = parsed.data;

  const matches = await prisma.user.findMany({
    where: { email, ...(schoolId ? { schoolId } : {}) },
    include: { school: true, profilePicture: { select: { updatedAt: true } } },
    orderBy: { createdAt: 'asc' },
  });

  // The password is checked before anything about the account is disclosed. Previously the school list for a shared email
  // came back with no password at all, which told anyone which schools a teacher belonged to.
  if (matches.length === 0) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
    return res.status(401).json({ error: INVALID_CREDENTIALS });
  }

  // A Google-only account has no password, so it can never verify here.
  const verified = [];
  for (const candidate of matches) {
    if (candidate.passwordHash && (await bcrypt.compare(password, candidate.passwordHash))) {
      verified.push(candidate);
    }
  }

  if (verified.length === 0) {
    for (const candidate of matches) {
      await prisma.user.update({
        where: { id: candidate.id },
        data: { failedLoginCount: candidate.failedLoginCount + 1 },
      });
    }
    if (matches[0].failedLoginCount + 1 >= FAILED_LOGIN_SLOWDOWN_AFTER) {
      await sleep(FAILED_LOGIN_SLOWDOWN_MS);
    }
    return res.status(401).json({ error: INVALID_CREDENTIALS });
  }

  if (verified.length > 1) {
    return res.json({
      needsSchoolSelection: true,
      schools: verified.map((u) => ({ id: u.school.id, name: u.school.name, code: u.school.code })),
    });
  }

  const user = verified[0];

  // Approval gate, checked only after the password is proven so a pending/rejected state isn't disclosed to someone
  // without the credential. The two error codes are contract: the client shows a dedicated screen for each.
  const statusError = statusGateError(user);
  if (statusError) return res.status(403).json({ error: statusError });

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLogin: new Date() },
  });
  await logAttendanceLoginIfEnabled(user);

  const session = await issueSession(user, req);
  return sendSession(req, res, session, {
    user: publicUser(user, user.school),
    featureFlags: await getEffectiveFeatureFlags(),
  });
}));

const googleAuthSchema = z.object({
  idToken: z.string().trim().min(20).max(4096),
  // Either field makes this a sign-up. schoolCode picks the tenant (as in /register); `signup` is the website's
  // no-code path and lands at DEFAULT_REGISTRATION_SCHOOL_CODE. Neither means sign-in.
  schoolCode: z.string().trim().min(1).max(40).optional(),
  signup: z.boolean().optional(),
  // Display name from the sign-up form. Purely presentational; if omitted, the
  // name on the verified Google profile is used instead.
  name: z.string().trim().min(2).max(60).optional(),
  // Only sent on the second attempt, after a needsSchoolSelection response.
  schoolId: z.string().trim().min(1).max(40).optional(),
});

// POST /api/auth/google: Google sign-up and sign-in in one endpoint, branching on whether a schoolCode or signup
// flag was supplied. It shares User rows, the approval gate and issueSession() with email+password.
// Identity comes from Google's verified `sub`, not the request body. Sign-in matches on `sub` only, never email, so a
// Google token can't take over an account created with a password. Linking Google to an existing account is out of scope.
router.post('/google', asyncHandler(async (req, res) => {
  if (!googleAuth.isGoogleAuthConfigured()) {
    return res.status(503).json({ error: 'google_not_configured' });
  }

  const parsed = googleAuthSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: firstValidationMessage(parsed.error) });
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
      return res.status(409).json({ error: EMAIL_ALREADY_REGISTERED });
    }

    try {
      await prisma.user.create({
        data: {
          schoolId: school.id,
          // Google's profile name is a default; the sign-up form's value wins. Falls back to the email's local part so `name` is never blank.
          name: name || identity.name || identity.email.split('@')[0],
          email: identity.email,
          googleSub: identity.sub,
          role: 'teacher',
          status: 'active',
        },
      });
    } catch (err) {
      // Same concurrent-sign-up race as /register. googleSub has only an index, so this can only be the schoolId_email constraint.
      if (isUniqueConstraintError(err)) {
        return res.status(409).json({ error: EMAIL_ALREADY_REGISTERED });
      }
      throw err;
    }

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

  const session = await issueSession(user, req);
  return sendSession(req, res, session, {
    user: publicUser(user, user.school),
    featureFlags: await getEffectiveFeatureFlags(),
  });
}));

const forgotPasswordSchema = z.object({ email: emailField });

const resetPasswordSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: newPasswordField,
});

// POST /api/auth/forgot-password: start a self-service reset. The response is identical whether or not the address
// has an account, so it can't reveal who is registered; rate limiting comes from authLimiter in index.js.
// The reset token is CSPRNG-generated and only its SHA-256 hash is stored, like a refresh token.
router.post('/forgot-password', asyncHandler(async (req, res) => {
  const parsed = forgotPasswordSchema.safeParse(req.body || {});
  // A malformed address is a client-side format problem, not a statement about
  // who exists, so rejecting it leaks nothing.
  if (!parsed.success) {
    return res.status(400).json({ error: firstValidationMessage(parsed.error) });
  }
  const { email } = parsed.data;

  // Only accounts that could sign in are resettable: a pending or rejected sign-up has no session to restore, and a
  // Google-only account has no password to replace.
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

// POST /api/auth/reset-password: redeem a token and set a new password. Every session is revoked on success, since
// a credential change means whoever holds the old sessions may not be the owner (like reuse detection in /auth/refresh).
router.post('/reset-password', asyncHandler(async (req, res) => {
  // Unknown, redeemed, expired and malformed tokens all get the same response; the caller can't act on the difference.
  const invalid = { error: 'This reset link is invalid or has expired. Please request a new one.' };

  const parsed = resetPasswordSchema.safeParse(req.body || {});
  if (!parsed.success) {
    // A missing or malformed token means the reset link itself is bad, whatever else the body holds, so the link message wins
    // (the form always sends both fields, so an empty body is a bad link, not a missing password). Otherwise a bad password is
    // actionable ("at least 8 characters") and that message is kept.
    if (parsed.error.issues.some((issue) => issue.path[0] === 'token')) {
      return res.status(400).json(invalid);
    }
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
    // Clear the lockout counters: someone who locked themselves out guessing is who uses "forgot password", and they
    // shouldn't hit a 423 right after a successful reset.
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

// POST /api/auth/refresh: exchange a valid refresh token for a new access+refresh pair. It rotates the token every
// time: the old one is revoked (linked via replacedBy) and can't be reused. Presenting an already-revoked token is
// treated as likely theft and revokes all the user's sessions.
// The refresh token comes from the JSON body (mobile, older builds) or, for web clients, from the HttpOnly cookie.
// Cookies are read only when the cookie-transport header is present, so a cross-site request can't ride the cookie.
function refreshTokenFromRequest(req) {
  const fromBody = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : '';
  if (fromBody) return fromBody;
  return usesCookieTransport(req) ? readRefreshCookie(req) : null;
}

router.post('/refresh', asyncHandler(async (req, res) => {
  const refreshToken = refreshTokenFromRequest(req);
  if (!refreshToken || refreshToken.length < 20) {
    return res.status(401).json({ error: 'Session not found. Please log in again.' });
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(refreshToken) },
    include: { user: { include: { school: true, profilePicture: { select: { updatedAt: true } } } } },
  });
  if (!session) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Session not found. Please log in again.' });
  }
  if (session.revokedAt) {
    // A token rotated a moment ago is most likely a second tab or request that lost a race, not theft. Its successor is
    // already in this browser's cookie, so the caller retries. Only a reuse outside the window counts as theft.
    if (session.replacedBy && Date.now() - session.revokedAt.getTime() < ROTATION_GRACE_MS) {
      return res.status(409).json({ error: 'Session is refreshing. Please try again.', code: 'refresh_conflict' });
    }
    await prisma.session.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Session has been revoked. Please log in again.' });
  }
  if (session.expiresAt < new Date()) {
    clearRefreshCookie(res);
    return res.status(401).json({ error: 'Session has expired. Please log in again.' });
  }

  // A suspended account is refused here, before any rotation. The access token stops working at once (authRequired checks
  // status on every request); this stops the refresh cookie from renewing it.
  const accountError = statusGateError(session.user);
  if (accountError) {
    clearRefreshCookie(res);
    return res.status(403).json({ error: accountError });
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

  return sendSession(
    req,
    res,
    { token: signAccessToken(user), refreshToken: newRefreshToken },
    { user: publicUser(user, user.school) }
  );
}));

// POST /api/auth/logout: revoke one refresh-token session and unregister one push device token in the same call.
// Always succeeds, even if either token is already gone, so the client can clear local storage unconditionally.
// `deviceToken` is scoped through the session the refreshToken identifies (logout has no Authorization header), so a
// device token is never deleted for someone else. With no valid session there's no userId, and the device token is
// left alone.
router.post('/logout', asyncHandler(async (req, res) => {
  const refreshToken = refreshTokenFromRequest(req);
  const deviceToken = typeof req.body?.deviceToken === 'string' ? req.body.deviceToken : null;
  clearRefreshCookie(res);

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

// DELETE /api/auth/sessions/:id: revoke one of the caller's own sessions (e.g. "sign out of another device"). Ownership-checked like routes/queries.js.
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

// PATCH /api/auth/me: update the caller's display name and/or preferences. `email` is the identity key and `name`
// is what admins see in Manage, so neither is editable here.
router.patch('/me', authRequired, asyncHandler(async (req, res) => {
  const parsed = profileSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: firstValidationMessage(parsed.error) });
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

// PATCH /api/auth/me/password: change the caller's password after verifying the current one. Unlike a reset, other
// sessions are left alone: the caller just proved they hold the password. Someone who forgot it uses /forgot-password.
// A signed-in session can still be used to guess the current password. Wrong current passwords (401) are capped per
// account, so a stolen access token can't brute-force the password. Only 401s count: a typo in the new password, a
// successful change, or a validation error costs nothing. Keyed by account, not IP, so a shared school address doesn't
// affect anyone else.
const PASSWORD_CHANGE_FAILURES = parseInt(process.env.PASSWORD_CHANGE_FAILURES_PER_15_MIN || '5', 10);
const passwordChangeFailureLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: PASSWORD_CHANGE_FAILURES,
  // Only a 401 counts as a failure. Without skipSuccessfulRequests every request is counted, and the decision above is ignored.
  requestWasSuccessful: (req, res) => res.statusCode !== 401,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `password-change:${req.user?.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many incorrect current-password attempts. Please wait a few minutes and try again.' },
});

router.patch('/me/password', authRequired, passwordChangeFailureLimiter, asyncHandler(async (req, res) => {
  const parsed = passwordChangeSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: firstValidationMessage(parsed.error) });
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
// Attached to the router so routes/avatar.js can build the same user DTO after an upload or remove without duplicating
// it. Express only needs the export to be callable as middleware, so the extra property is invisible to it.
module.exports.publicUser = publicUser;
