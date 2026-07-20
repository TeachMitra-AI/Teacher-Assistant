// Teacher Assistant backend proxy.
// Responsibilities:
//   - Keep the LLM API key server-side (never exposed to the browser)
//   - Validate and rate-limit incoming requests
//   - Build prompts server-side and call the LLM
//
// Configure via environment variables (see .env.example).

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { GeminiService } = require('./gemini');
const { LANGUAGE_NAMES } = require('./prompts');
const { prisma } = require('./lib/db');
const { authRequired } = require('./middleware/auth');
const authRouter = require('./routes/auth');
const dataRouter = require('./routes/queries');
const adminRouter = require('./routes/admin');

// ---- Configuration ---------------------------------------------------------

const {
  GEMINI_API_KEY,
  GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  PORT = 3000,
  CORS_ORIGINS = '',
  LLM_TIMEOUT_MS = '30000',
  LLM_MAX_RETRIES = '3',
  RATE_LIMIT_WINDOW_MINUTES = '15',
  RATE_LIMIT_MAX_REQUESTS = '60',
} = process.env;

if (!GEMINI_API_KEY) {
  console.error('FATAL: GEMINI_API_KEY is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}

const MAX_QUERY_LENGTH = 500;

const gemini = new GeminiService({
  apiKey: GEMINI_API_KEY,
  endpoint: GEMINI_ENDPOINT,
  timeoutMs: parseInt(LLM_TIMEOUT_MS, 10),
  maxRetries: parseInt(LLM_MAX_RETRIES, 10),
});

// ---- App setup -------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '16kb' }));

const allowedOrigins = CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// In development we reflect ANY origin so the frontend works no matter how it
// is served (Live Server on 5500, http-server on 8000, or the machine's LAN IP
// like http://10.x.x.x:8000). In production, set NODE_ENV=production and list
// the exact allowed origins in CORS_ORIGINS to lock this down.
//
// isProduction defaults to false (dev-permissive) only when NODE_ENV is unset,
// which is the normal local-dev case. If NODE_ENV IS set to 'production' but
// CORS_ORIGINS is empty, we refuse to boot rather than silently falling back
// to either "block everything" (confusing) or "allow everything" (unsafe) —
// same fail-fast pattern already used for GEMINI_API_KEY and JWT_SECRET.
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && allowedOrigins.length === 0) {
  console.error(
    'FATAL: NODE_ENV=production but CORS_ORIGINS is empty. Set it to a comma-separated allowlist of trusted frontend origins.'
  );
  process.exit(1);
}

function isOriginAllowed(origin) {
  // Non-browser tools (curl, health checks) send no Origin header.
  if (!origin) return true;
  if (!isProduction) return true; // Reflect any origin during development.
  return allowedOrigins.includes(origin);
}

app.use(
  cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }
      console.warn(`CORS blocked origin: ${origin}`);
      return callback(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

const limiter = rateLimit({
  windowMs: parseInt(RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000,
  max: parseInt(RATE_LIMIT_MAX_REQUESTS, 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment and try again.' },
});

// Stricter limiter for auth endpoints to slow down credential guessing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

// ---- Routes ----------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authLimiter, authRouter);

app.post('/api/coach', authRequired, limiter, async (req, res) => {
  const { query, context = {}, language = 'en' } = req.body || {};

  // --- Input validation (system boundary) ---
  if (typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'A non-empty "query" string is required.' });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({ error: `Query must be at most ${MAX_QUERY_LENGTH} characters.` });
  }
  if (typeof context !== 'object' || Array.isArray(context)) {
    return res.status(400).json({ error: '"context" must be an object.' });
  }
  if (typeof language !== 'string' || !LANGUAGE_NAMES[language]) {
    return res.status(400).json({ error: 'Unsupported "language".' });
  }

  // Only pass through known context fields.
  const safeContext = {
    grade: typeof context.grade === 'string' ? context.grade.slice(0, 60) : undefined,
    subject: typeof context.subject === 'string' ? context.subject.slice(0, 60) : undefined,
    classroomType:
      typeof context.classroomType === 'string' ? context.classroomType.slice(0, 60) : undefined,
    issueType: typeof context.issueType === 'string' ? context.issueType.slice(0, 60) : undefined,
  };

  try {
    // Read the teacher's saved response-style preference server-side so it is
    // authoritative and cannot be spoofed by the client.
    let responseStyle = 'balanced';
    try {
      const profile = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { preferences: true },
      });
      if (profile?.preferences) {
        const prefs = JSON.parse(profile.preferences);
        if (prefs && typeof prefs.responseStyle === 'string') responseStyle = prefs.responseStyle;
      }
    } catch {
      /* fall back to balanced */
    }

    const result = await gemini.generateResponse({
      query: query.trim(),
      context: safeContext,
      language,
      responseStyle,
    });

    // Persist the query for history + analytics. A failure here must not break
    // the response the teacher is waiting for.
    let queryId = null;
    try {
      const saved = await prisma.query.create({
        data: {
          userId: req.user.id,
          schoolId: req.user.schoolId,
          queryText: query.trim(),
          language,
          context: JSON.stringify(safeContext),
          responseText: result.text,
          responseTimeMs: result.responseTime || null,
          finishReason: result.finishReason || null,
        },
      });
      queryId = saved.id;
    } catch (persistError) {
      console.error('Failed to persist query:', persistError.message);
    }

    return res.json({ success: true, ...result, context: safeContext, queryId });
  } catch (error) {
    console.error('Coach request failed:', {
      status: error.status,
      message: error.message,
    });

    if (error.status === 429) {
      return res.status(429).json({ error: 'The service is busy. Please try again shortly.' });
    }
    if (error.status === 401 || error.status === 403) {
      // Do not leak configuration details to the client.
      return res.status(502).json({ error: 'Upstream authentication error. Please contact the administrator.' });
    }
    if (error.name === 'TimeoutError' || String(error.message).includes('timeout')) {
      return res.status(504).json({ error: 'The request timed out. Please try again.' });
    }
    return res.status(502).json({ error: 'Failed to generate a response. Please try again.' });
  }
});

// Teacher history + feedback, and admin analytics/management.
app.use('/api', dataRouter);
app.use('/api/admin', adminRouter);

// ---- Start -----------------------------------------------------------------

// Only bind a real port when this file is run directly (`node src/index.js`,
// which is what `npm start`/`npm run dev` do). When the test suite requires
// this module to get `app` for Supertest, we don't want a real listening
// socket — Supertest drives the app in-process instead.
/* istanbul ignore next -- exercised via `npm start`, not the test suite */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Teacher Assistant backend listening on port ${PORT}`);
    // Note: if NODE_ENV=production and CORS_ORIGINS were empty, the process
    // would already have exited above — reaching here means either we're in
    // development (any origin is reflected) or the allowlist is populated.
    if (isProduction) {
      console.log(`CORS allowlist: ${allowedOrigins.join(', ')}`);
    } else {
      console.log('CORS: development mode — reflecting any request origin.');
    }
  });
}

module.exports = app;
