// Access-token (JWT) helpers, refresh-token helpers and auth/role middleware. A short-lived access JWT plus a
// rotating opaque refresh token whose hash is stored in the Session table, so the long-lived credential is
// revocable server-side while authRequired stays stateless and fast.
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { prisma } = require('../lib/db');

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TOKEN_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '7', 10);

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Add it to .env (see .env.example).');
  process.exit(1);
}
if (JWT_SECRET.length < 32 || JWT_SECRET === 'change-me-to-a-long-random-secret') {
  console.error('FATAL: JWT_SECRET is too short or is still the .env.example placeholder. Set a long, random value.');
  process.exit(1);
}

const JWT_ALGORITHM = 'HS256';

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, schoolId: user.schoolId, name: user.name },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL, algorithm: JWT_ALGORITHM }
  );
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

function decode(token) {
  const payload = jwt.verify(token, JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
  return {
    id: payload.sub,
    role: payload.role,
    schoolId: payload.schoolId,
    name: payload.name,
    // Seconds since epoch, from the signed token. authRequired compares it with the account's last status change.
    issuedAt: payload.iat,
  };
}

// The message for a valid token whose account is no longer active (suspended, rejected or removed). The client treats the
// 401 as an expired session, and the refresh that follows is refused with the account_suspended code.
const ACCOUNT_INACTIVE_ERROR = 'Your account is no longer active. Please sign in again.';

// Require a valid session; otherwise 401. The token is checked against the account's current status on every request, so
// suspending a teacher stops their existing access token at once rather than when it expires (up to ACCESS_TOKEN_TTL).
async function authRequired(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  let claims;
  try {
    claims = decode(token);
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
  try {
    const account = await prisma.user.findUnique({
      where: { id: claims.id },
      select: { status: true, statusChangedAt: true },
    });
    if (!account || account.status !== 'active') {
      return res.status(401).json({ error: ACCOUNT_INACTIVE_ERROR });
    }
    // A token issued before the last status change belongs to a session that change ended. After a reactivation, the teacher's
    // pre-suspension token must not work again: they sign in again instead.
    if (account.statusChangedAt && claims.issuedAt * 1000 < account.statusChangedAt.getTime()) {
      return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
    }
  } catch {
    // Fail closed: if the status can't be read, the request is refused rather than trusted. A 503 tells the client to retry.
    return res.status(503).json({ error: 'We could not verify your session. Please try again.' });
  }
  req.user = claims;
  return next();
}

// Attach req.user when a valid token is present, but never block the request.
function optionalAuth(req, res, next) {
  const token = getBearerToken(req);
  if (token) {
    try {
      req.user = decode(token);
    } catch {
      /* ignore invalid token for optional auth */
    }
  }
  return next();
}

// Restrict a route to specific roles.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to do this.' });
    }
    return next();
  };
}

function generateRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function refreshTokenExpiry() {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// ---- Refresh-token cookie (web clients) -------------------------------------------------------------------------------
// The browser keeps the refresh token in an HttpOnly cookie, so page scripts (and any XSS) can't read it. It's scoped to
// /api/auth, so it's sent only to the auth routes. Mobile and other non-browser clients have no cookie jar and keep
// receiving the token in the JSON body.
const REFRESH_COOKIE_NAME = 'sarastech_refresh';
const REFRESH_COOKIE_PATH = '/api/auth';

// The web client sends this header on /api/auth calls. A custom header makes a cross-site form or no-cors request unable to
// reach the cookie-authenticated endpoints, and a cross-origin fetch needs a CORS preflight that only allowlisted origins
// pass in production. It also tells login/refresh to leave the refresh token out of the response body.
const SESSION_TRANSPORT_HEADER = 'x-session-transport';

function usesCookieTransport(req) {
  return req.headers[SESSION_TRANSPORT_HEADER] === 'cookie';
}

function readRefreshCookie(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === REFRESH_COOKIE_NAME) return value.join('=') || null;
  }
  return null;
}

// Secure is on in production (browsers accept it on http://localhost too). SameSite defaults to Lax: the web app and API
// share a site in dev and in the usual same-domain deploy. Set REFRESH_COOKIE_SAMESITE=none only for a cross-site deploy;
// SameSite=None always forces Secure.
function refreshCookieAttributes() {
  const sameSite = (process.env.REFRESH_COOKIE_SAMESITE || 'lax').toLowerCase();
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || sameSite === 'none',
    sameSite,
    path: REFRESH_COOKIE_PATH,
  };
}

function setRefreshCookie(res, refreshToken) {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    ...refreshCookieAttributes(),
    maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieAttributes());
}

module.exports = {
  signAccessToken,
  decode,
  authRequired,
  optionalAuth,
  requireRole,
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
  REFRESH_TOKEN_TTL_DAYS,
  SESSION_TRANSPORT_HEADER,
  usesCookieTransport,
  readRefreshCookie,
  setRefreshCookie,
  clearRefreshCookie,
};
