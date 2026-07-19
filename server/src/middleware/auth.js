// JWT session helpers + auth/role middleware.
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = process.env.TOKEN_TTL || '7d';

if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set. Add it to .env (see .env.example).');
  process.exit(1);
}

function signToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, schoolId: user.schoolId, name: user.name },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
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

module.exports = { signToken, authRequired, optionalAuth, requireRole };
