// Access-token (JWT) helpers, refresh-token (opaque, server-tracked) helpers,
// and auth/role middleware.
//
// Architecture: short-lived access JWT (unchanged shape/verification, just a
// shorter TTL) + a rotating opaque refresh token whose hash is stored in the
// Session table. This makes the long-lived credential fully revocable
// server-side without requiring a DB lookup on every request — authRequired
// stays fast and stateless, exactly as before.
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET;
const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TOKEN_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '7', 10);

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Add it to .env (see .env.example).');
  process.exit(1);
}

// ---- Access token (short-lived JWT) ----------------------------------------

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, schoolId: user.schoolId, name: user.name },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function getBearerToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

function decode(token) {
  const payload = jwt.verify(token, JWT_SECRET);
  return {
    id: payload.sub,
    role: payload.role,
    schoolId: payload.schoolId,
    name: payload.name,
  };
}

// Require a valid session; otherwise 401.
function authRequired(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    req.user = decode(token);
    return next();
  } catch {
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
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

// ---- Refresh token (opaque, hashed at rest in the Session table) ----------

function generateRefreshToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function refreshTokenExpiry() {
  return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
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
};
