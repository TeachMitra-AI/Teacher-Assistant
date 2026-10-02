// Teacher Assistant backend proxy: keeps the LLM API key server-side, validates and rate-limits requests, and
// builds prompts server-side before calling the LLM. Configure through environment variables (see .env.example).

require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const crypto = require('crypto');

const { GeminiService } = require('./gemini');
const { GeminiKeyPool } = require('./lib/geminiKeyPool');
const { LANGUAGE_NAMES } = require('./prompts');
const { normalizeQuery, flagPossibleInjection } = require('./safety/inputGuard');
const { parseIntEnv } = require('./lib/config');
const { prisma } = require('./lib/db');
const { sendAiError } = require('./lib/sendAiError');
const { authRequired } = require('./middleware/auth');
const authRouter = require('./routes/auth');
const dataRouter = require('./routes/queries');
const adminRouter = require('./routes/admin');
const resourcesRouter = require('./routes/resources');
// Routers are required at boot so a malformed module (or capability registry) stops the server here, not at a request.
// assistantRouter's require also validates the capability registry.
const assistantRouter = require('./routes/assistant');
// Attachments are a sibling of the Action Router (docs/multimodal-attachments-architecture.md).
const attachmentsRouter = require('./routes/attachments');
// Reuses auth.js's publicUser().
const avatarRouter = require('./routes/avatar');
// Help & Support: bug reports and feedback.
const supportRouter = require('./routes/support');
// Admin Support Inbox: super_admin-only ticket management, separate from adminRouter (see routes/adminSupport.js).
const adminSupportRouter = require('./routes/adminSupport');
const adminSettingsRouter = require('./routes/adminSettings');
// Notification System — a sibling feature, same "fail at boot on a malformed
// module" reasoning as every router above. See docs/notification-system-plan.md.
const notificationsRouter = require('./routes/notifications');
// Classroom Management (docs/classroom-feature-plan.md): the class/student/attendance/fee workspace. Not "Classroom
// Mode" below (planClassroom/CLASSROOM_MODE_ENABLED), which is an unrelated AI chat feature.
const classroomRouter = require('./routes/classroom');
// Teacher Attendance (docs/feature-teacher-attendance-implementation-plan.md): a teacher's own check-in and
// check-out, reviewed by their Principal. Separate from classroomRouter's student attendance; they share no tables.
const teacherAttendanceRouter = require('./routes/teacherAttendance');
// Schedule a Call: public demo booking for schools and organizations.
const scheduleDemoRouter = require('./routes/scheduleDemo');
const adminScheduleDemoRouter = require('./routes/adminScheduleDemo');
const { runCheckoutReminderSweep, SWEEP_INTERVAL_MS: teacherAttendanceReminderIntervalMs } = require('./lib/teacherAttendanceReminder');
const { initSocketServer } = require('./lib/socketServer');
const { readNotificationsFlags } = require('./lib/flags');
// AI Learning Representation System. Requiring it also runs mapping.js's completeness guard and schemas.js's
// registry-consistency guard, which throw on load if their data is out of sync.
const learningRepresentationRouter = require('./routes/learningRepresentation');
const {
  readAssistantFlags,
  readAttachmentFlags,
  readLearningRepresentationFlags,
  readClassroomModeFlags,
} = require('./lib/flags');
const { planClassroom } = require('./lib/classroomPlan');
const { createBudgetCounter } = require('./assistant/budget');
const { createRenderCache } = require('./learningRepresentation/rendering/cache');
const { createRouterBreaker } = require('./assistant/breaker');
const { createGenerateLimiter } = require('./lib/limiters');

// Logs only non-sensitive metadata about an AI request/response, never the raw query, response text, upstream error
// body, API keys, tokens or PII. One helper makes the safe pattern the easy one.
function logAiEvent(level, event, meta = {}) {
  const fn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
  fn(`[ai] ${event}`, meta);
}

// Configuration

const {
  GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  PORT = 3000,
  CORS_ORIGINS = '',
  RATE_LIMIT_WINDOW_MINUTES = '15',
} = process.env;

// One or more comma-separated Gemini API keys for automatic failover (see lib/geminiKeyPool.js); a single key works as before.
const GEMINI_API_KEYS = (process.env.GEMINI_API_KEY || '')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);

if (GEMINI_API_KEYS.length === 0) {
  console.error('FATAL: GEMINI_API_KEY is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}

const MAX_QUERY_LENGTH = 500;

// Computed here (rather than down near the CORS check, where this used to
// live) because RATE_LIMIT_MAX_REQUESTS below needs it too.
const isProduction = process.env.NODE_ENV === 'production';

// Our own per-IP cap on POST /coach, separate from Gemini's quota (the /coach handler's 429 branch maps that). The
// default is environment-aware: 60/window in production, 300 in development, where iterating on the UI can legitimately
// exceed 60. An explicit RATE_LIMIT_MAX_REQUESTS wins in either.
const RATE_LIMIT_MAX_REQUESTS = parseIntEnv(process.env.RATE_LIMIT_MAX_REQUESTS, {
  name: 'RATE_LIMIT_MAX_REQUESTS', defaultValue: isProduction ? 60 : 300, min: 1, max: 100000,
});

// LLM reliability and cost tunables. Invalid values clamp to safe bounds with a warning (lib/config.js) rather than crashing.
const LLM_TIMEOUT_MS = parseIntEnv(process.env.LLM_TIMEOUT_MS, {
  name: 'LLM_TIMEOUT_MS', defaultValue: 30000, min: 1000, max: 120000,
});
const LLM_TOTAL_TIMEOUT_MS = parseIntEnv(process.env.LLM_TOTAL_TIMEOUT_MS, {
  name: 'LLM_TOTAL_TIMEOUT_MS', defaultValue: 60000, min: 5000, max: 180000,
});
const LLM_MAX_RETRIES = parseIntEnv(process.env.LLM_MAX_RETRIES, {
  name: 'LLM_MAX_RETRIES', defaultValue: 2, min: 0, max: 5,
});
const LLM_MAX_CALLS_PER_REQUEST = parseIntEnv(process.env.LLM_MAX_CALLS_PER_REQUEST, {
  name: 'LLM_MAX_CALLS_PER_REQUEST', defaultValue: 8, min: 1, max: 20,
});
const LLM_MAX_CONTINUATIONS = parseIntEnv(process.env.LLM_MAX_CONTINUATIONS, {
  name: 'LLM_MAX_CONTINUATIONS', defaultValue: 4, min: 0, max: 8,
});
const LLM_MAX_OUTPUT_TOKENS = parseIntEnv(process.env.LLM_MAX_OUTPUT_TOKENS, {
  name: 'LLM_MAX_OUTPUT_TOKENS', defaultValue: 8192, min: 256, max: 8192,
});

// Clock time (IST) a rate-limited Gemini key resets at, matching Gemini's fixed daily quota reset (see
// nextDailyResetAt in lib/geminiPolicy.js). Default 12:30 PM IST.
const GEMINI_KEY_RESET_HOUR_IST = parseIntEnv(process.env.GEMINI_KEY_RESET_HOUR_IST, {
  name: 'GEMINI_KEY_RESET_HOUR_IST', defaultValue: 12, min: 0, max: 23,
});
const GEMINI_KEY_RESET_MINUTE_IST = parseIntEnv(process.env.GEMINI_KEY_RESET_MINUTE_IST, {
  name: 'GEMINI_KEY_RESET_MINUTE_IST', defaultValue: 30, min: 0, max: 59,
});
// How long a key sits out of rotation after a 401/403 (bad or revoked key), in ms. It's duration-based, not tied to the daily reset.
const GEMINI_KEY_AUTH_COOLDOWN_MS = parseIntEnv(process.env.GEMINI_KEY_AUTH_COOLDOWN_MS, {
  name: 'GEMINI_KEY_AUTH_COOLDOWN_MS', defaultValue: 3600000, min: 60000, max: 86400000,
});

// One pool shared by all three GeminiService instances (coach, router, attachments), since they draw on the same
// Google quota and a key rate-limited on one must be skipped by the others.
const geminiKeyPool = new GeminiKeyPool(GEMINI_API_KEYS, {
  resetHourIst: GEMINI_KEY_RESET_HOUR_IST,
  resetMinuteIst: GEMINI_KEY_RESET_MINUTE_IST,
  authCooldownMs: GEMINI_KEY_AUTH_COOLDOWN_MS,
});

const gemini = new GeminiService({
  keyPool: geminiKeyPool,
  endpoint: GEMINI_ENDPOINT,
  timeoutMs: LLM_TIMEOUT_MS,
  totalTimeoutMs: LLM_TOTAL_TIMEOUT_MS,
  maxRetries: LLM_MAX_RETRIES,
  maxCallsPerRequest: LLM_MAX_CALLS_PER_REQUEST,
  maxContinuations: LLM_MAX_CONTINUATIONS,
  maxOutputTokens: LLM_MAX_OUTPUT_TOKENS,
});

// Routing model. A second GeminiService instance rather than a modified one: gemini.js takes every tunable per
// instance, so routing needs no change to the service Coach, AI Assist and the Generator share.
// Coaching gets 30s per call and 60s overall, which is wrong for a routing decision in front of a text box. Routing
// gets ~3.5s per call and a 5s deadline, and exceeding it yields a passthrough, not an error.
const ASSISTANT_GEMINI_ENDPOINT =
  process.env.ASSISTANT_GEMINI_ENDPOINT ||
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent';

const ASSISTANT_LLM_TIMEOUT_MS = parseIntEnv(process.env.ASSISTANT_LLM_TIMEOUT_MS, {
  name: 'ASSISTANT_LLM_TIMEOUT_MS', defaultValue: 3500, min: 1000, max: 10000,
});
const ASSISTANT_LLM_TOTAL_TIMEOUT_MS = parseIntEnv(process.env.ASSISTANT_LLM_TOTAL_TIMEOUT_MS, {
  name: 'ASSISTANT_LLM_TOTAL_TIMEOUT_MS', defaultValue: 5000, min: 2000, max: 15000,
});
const ASSISTANT_LLM_MAX_RETRIES = parseIntEnv(process.env.ASSISTANT_LLM_MAX_RETRIES, {
  name: 'ASSISTANT_LLM_MAX_RETRIES', defaultValue: 1, min: 0, max: 2,
});
const ASSISTANT_LLM_MAX_CALLS = parseIntEnv(process.env.ASSISTANT_LLM_MAX_CALLS, {
  name: 'ASSISTANT_LLM_MAX_CALLS', defaultValue: 2, min: 1, max: 3,
});
const ASSISTANT_LLM_MAX_OUTPUT_TOKENS = parseIntEnv(process.env.ASSISTANT_LLM_MAX_OUTPUT_TOKENS, {
  name: 'ASSISTANT_LLM_MAX_OUTPUT_TOKENS', defaultValue: 512, min: 128, max: 1024,
});

// Cost and availability guards for the router. Both are built here and injected via app.locals, like geminiFast,
// rather than held as module state, since the test suite shares one index.js per worker and a leaked counter or
// open breaker would make failures order-dependent. Neither can fail a request: an exhausted budget and an open
// breaker both produce a passthrough.
const ASSISTANT_BREAKER_429_THRESHOLD = parseIntEnv(process.env.ASSISTANT_BREAKER_429_THRESHOLD, {
  name: 'ASSISTANT_BREAKER_429_THRESHOLD', defaultValue: 5, min: 1, max: 100,
});
const ASSISTANT_BREAKER_WINDOW_MS = parseIntEnv(process.env.ASSISTANT_BREAKER_WINDOW_MS, {
  name: 'ASSISTANT_BREAKER_WINDOW_MS', defaultValue: 60000, min: 1000, max: 3600000,
});
const ASSISTANT_BREAKER_COOLDOWN_MS = parseIntEnv(process.env.ASSISTANT_BREAKER_COOLDOWN_MS, {
  name: 'ASSISTANT_BREAKER_COOLDOWN_MS', defaultValue: 300000, min: 1000, max: 3600000,
});

const assistantFlags = readAssistantFlags(process.env);
const assistantBudget = createBudgetCounter({ limit: assistantFlags.dailyBudgetPerUser });

// A second counter for telemetry rows. POST /api/assistant/events had only the shared IP limiter in front of it, and
// a request may carry a batch, so one looping client could sustain writes against the single-writer table.
// The limit is derived, not a new env var: the ceiling is two rows per routed session, so twice the interpret budget
// covers every legitimate session, with headroom for a re-delivered batch. It's separate from the routing counter so
// telemetry can't use up the budget a teacher needs for routing. Exceeding it drops the batch silently (204).
const assistantEventBudget = createBudgetCounter({
  limit: assistantFlags.dailyBudgetPerUser * 2 + 20,
});
const assistantBreaker = createRouterBreaker({
  threshold: ASSISTANT_BREAKER_429_THRESHOLD,
  windowMs: ASSISTANT_BREAKER_WINDOW_MS,
  cooldownMs: ASSISTANT_BREAKER_COOLDOWN_MS,
});

const geminiFast = new GeminiService({
  keyPool: geminiKeyPool,
  endpoint: ASSISTANT_GEMINI_ENDPOINT,
  timeoutMs: ASSISTANT_LLM_TIMEOUT_MS,
  totalTimeoutMs: ASSISTANT_LLM_TOTAL_TIMEOUT_MS,
  maxRetries: ASSISTANT_LLM_MAX_RETRIES,
  maxCallsPerRequest: ASSISTANT_LLM_MAX_CALLS,
  // Zero continuations: a classification is a small JSON object, and gemini.js already skips continuation for
  // structured responses. Stated here so the intent survives if that changes.
  maxContinuations: 0,
  maxOutputTokens: ASSISTANT_LLM_MAX_OUTPUT_TOKENS,
});

// Multimodal attachments: a third GeminiService instance. A multimodal call (image/PDF tokens) is slower and costlier
// than text, and mustn't silently degrade to passthrough, so it gets its own tunables rather than sharing either
// other instance's budgets.
const ATTACHMENT_GEMINI_ENDPOINT =
  process.env.ATTACHMENT_GEMINI_ENDPOINT || GEMINI_ENDPOINT;

const ATTACHMENT_LLM_TIMEOUT_MS = parseIntEnv(process.env.ATTACHMENT_LLM_TIMEOUT_MS, {
  name: 'ATTACHMENT_LLM_TIMEOUT_MS', defaultValue: 30000, min: 1000, max: 120000,
});
const ATTACHMENT_LLM_TOTAL_TIMEOUT_MS = parseIntEnv(process.env.ATTACHMENT_LLM_TOTAL_TIMEOUT_MS, {
  name: 'ATTACHMENT_LLM_TOTAL_TIMEOUT_MS', defaultValue: 60000, min: 5000, max: 180000,
});
const ATTACHMENT_LLM_MAX_RETRIES = parseIntEnv(process.env.ATTACHMENT_LLM_MAX_RETRIES, {
  name: 'ATTACHMENT_LLM_MAX_RETRIES', defaultValue: 2, min: 0, max: 5,
});
const ATTACHMENT_LLM_MAX_CALLS_PER_REQUEST = parseIntEnv(process.env.ATTACHMENT_LLM_MAX_CALLS_PER_REQUEST, {
  name: 'ATTACHMENT_LLM_MAX_CALLS_PER_REQUEST', defaultValue: 8, min: 1, max: 20,
});
const ATTACHMENT_LLM_MAX_OUTPUT_TOKENS = parseIntEnv(process.env.ATTACHMENT_LLM_MAX_OUTPUT_TOKENS, {
  name: 'ATTACHMENT_LLM_MAX_OUTPUT_TOKENS', defaultValue: 4096, min: 256, max: 8192,
});

const attachmentGemini = new GeminiService({
  keyPool: geminiKeyPool,
  endpoint: ATTACHMENT_GEMINI_ENDPOINT,
  timeoutMs: ATTACHMENT_LLM_TIMEOUT_MS,
  totalTimeoutMs: ATTACHMENT_LLM_TOTAL_TIMEOUT_MS,
  maxRetries: ATTACHMENT_LLM_MAX_RETRIES,
  maxCallsPerRequest: ATTACHMENT_LLM_MAX_CALLS_PER_REQUEST,
  maxContinuations: LLM_MAX_CONTINUATIONS,
  maxOutputTokens: ATTACHMENT_LLM_MAX_OUTPUT_TOKENS,
});

// Per-user daily budget using the router's generic counter (assistant/budget.js), with the same in-memory,
// per-process trade-offs as express-rate-limit's MemoryStore.
const attachmentFlagsAtBoot = readAttachmentFlags(process.env);
const attachmentBudget = createBudgetCounter({ limit: attachmentFlagsAtBoot.dailyBudgetPerUser });

// AI Learning Representation: the same generic counter and the same per-process trade-offs (see assistant/budget.js).
const learningRepresentationFlagsAtBoot = readLearningRepresentationFlags(process.env);
const learningRepresentationBudget = createBudgetCounter({
  limit: learningRepresentationFlagsAtBoot.dailyBudgetPerUser,
});

// Request-level render cache, in-memory and per-process (see learningRepresentation/rendering/cache.js for the trade-offs).
const learningRepresentationRenderCache = createRenderCache();

// Classroom Mode (docs/classroom-mode.md), read once at boot. This is the authoritative gate: the client's
// VITE_CLASSROOM_MODE_ENABLED only decides whether the "+" button renders, and a cached PWA client can be hours
// stale. Turning this off stops the planner and every downstream artifact call for everyone, which makes it a usable spend control.
const classroomModeFlagsAtBoot = readClassroomModeFlags(process.env);

// App setup

const app = express();
app.disable('x-powered-by');
// Expose the GeminiService instance to routers (e.g. the Lesson Plan Workspace AI actions) without rebuilding it or
// leaking the key. Read via req.app.locals.gemini.
app.locals.gemini = gemini;
// The shared key-failover pool (lib/geminiKeyPool.js), exposed so tests can read its status via describe().
app.locals.geminiKeyPool = geminiKeyPool;
// The routing instance, kept a separate local from `gemini` so reaching for the wrong one is visibly wrong.
app.locals.geminiFast = geminiFast;
// Router guards, built once and reached explicitly, never module singletons (same reason as geminiFast).
app.locals.assistantBudget = assistantBudget;
app.locals.assistantEventBudget = assistantEventBudget;
app.locals.assistantBreaker = assistantBreaker;
// Attachments, read by routes/attachments.js as req.app.locals.attachmentGemini / .attachmentBudget; injected so tests can build their own app.
app.locals.attachmentGemini = attachmentGemini;
app.locals.attachmentBudget = attachmentBudget;
// Read by routes/learningRepresentation.js as req.app.locals.learningRepresentationBudget. It uses the existing
// gemini / geminiFast locals (no third instance); see the route for why.
app.locals.learningRepresentationBudget = learningRepresentationBudget;
// Read by routes/learningRepresentation.js as req.app.locals.learningRepresentationRenderCache.
app.locals.learningRepresentationRenderCache = learningRepresentationRenderCache;
// Railway puts one reverse-proxy hop in front of the app. Trusting that hop lets Express derive req.ip from
// X-Forwarded-For, which express-rate-limit needs to limit real client IPs (otherwise it refuses to start with
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR). A fixed hop count, not `true`, keeps req.ip unspoofable by a client-supplied header.
app.set('trust proxy', 1);
app.use(helmet());

const allowedOrigins = CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// In development any origin is reflected, so the frontend works however it's served (Live Server, http-server, a
// LAN IP). In production, set NODE_ENV=production and list exact origins in CORS_ORIGINS.
// isProduction (above) is false only when NODE_ENV is unset. If it is 'production' but CORS_ORIGINS is empty, we
// refuse to boot rather than block everything or allow everything, as with GEMINI_API_KEY and JWT_SECRET.
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

// Registered before the JSON body-parser and every router, on purpose. cors() only sets headers, so the order doesn't
// affect successful requests. When express.json() throws on a malformed body, Express skips to the error handler at
// the bottom; if cors() ran after the parser it would be skipped, the error response would lack
// Access-Control-Allow-Origin, and the browser would show an opaque "Failed to fetch" instead of the clean 400.
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
    // Lets a cross-origin fetch() read Content-Disposition, so CSV/Excel downloads (routes/classroom.js exports) get the server's filename.
    exposedHeaders: ['Content-Disposition'],
  })
);

// JSON bodies are limited to 16kb, except the resources routes (My Library), which allow 64kb since a saved lesson
// plan with several structured sections can exceed 16kb. Scoping the larger limit keeps other endpoints tight.
const jsonSmall = express.json({ limit: '16kb' });
const jsonLarge = express.json({ limit: '64kb' });
app.use((req, res, next) => {
  if (req.path.startsWith('/api/resources')) return jsonLarge(req, res, next);
  // Classroom Mode stores a turn's generated artifacts (up to five documents) in one body, which exceeds 16kb. Scoped to
  // this one path rather than raising the limit for all of /api/queries.
  if (/^\/api\/queries\/[^/]+\/classroom-artifacts$/.test(req.path)) return jsonLarge(req, res, next);
  return jsonSmall(req, res, next);
});

const limiter = rateLimit({
  windowMs: parseInt(RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000,
  max: RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  // Worded differently from the Gemini-upstream 429 message in the /coach catch block so the two aren't ambiguous:
  // this means "you called our API too often", that one "the AI provider is rate-limiting us", which patience alone doesn't fix.
  message: { error: 'You have made too many requests. Please wait a few minutes and try again.' },
});

// Separate bucket for the assistant, not the /coach limiter: sharing would let catalog fetches and routing eat the
// budget a teacher needs for coaching. A higher ceiling since these calls are small and frequent.
const ASSISTANT_RATE_LIMIT_MAX_REQUESTS = parseIntEnv(process.env.ASSISTANT_RATE_LIMIT_MAX_REQUESTS, {
  name: 'ASSISTANT_RATE_LIMIT_MAX_REQUESTS', defaultValue: isProduction ? 120 : 600, min: 1, max: 100000,
});

const assistantLimiter = rateLimit({
  windowMs: parseInt(RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000,
  max: ASSISTANT_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many assistant requests. Please wait a few minutes and try again.' },
});

// Separate bucket for POST /api/coach/attachment, with a lower ceiling than /coach since an attachment request is the
// most expensive call shape (like /resources/generate's limiter).
const ATTACHMENT_RATE_LIMIT_MAX_REQUESTS = parseIntEnv(process.env.ATTACHMENT_RATE_LIMIT_MAX_REQUESTS, {
  name: 'ATTACHMENT_RATE_LIMIT_MAX_REQUESTS', defaultValue: isProduction ? 20 : 300, min: 1, max: 100000,
});

const attachmentLimiter = rateLimit({
  windowMs: parseInt(RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000,
  max: ATTACHMENT_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attachment requests. Please wait a few minutes and try again.' },
});

// Separate, tighter bucket for POST /api/support/tickets, which has no per-user daily budget (see lib/flags.js), so
// this limiter is all that bounds someone repeatedly pressing "Report a Bug".
const SUPPORT_RATE_LIMIT_MAX_REQUESTS = parseIntEnv(process.env.SUPPORT_RATE_LIMIT_MAX_REQUESTS, {
  name: 'SUPPORT_RATE_LIMIT_MAX_REQUESTS', defaultValue: isProduction ? 20 : 300, min: 1, max: 100000,
});

// Separate bucket for POST /api/notifications (send/broadcast), the only route that mutates for others. GET/PATCH on
// the caller's own notifications stay under the general limiter.
const NOTIFICATIONS_SEND_RATE_LIMIT_MAX_REQUESTS = parseIntEnv(process.env.NOTIFICATIONS_SEND_RATE_LIMIT_MAX_REQUESTS, {
  name: 'NOTIFICATIONS_SEND_RATE_LIMIT_MAX_REQUESTS', defaultValue: isProduction ? 20 : 300, min: 1, max: 100000,
});

const notificationsSendLimiter = rateLimit({
  windowMs: parseInt(RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000,
  max: NOTIFICATIONS_SEND_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

// Classroom Management gets its own bucket (docs/classroom-feature-plan.md). Its writes are frequent and cheap, closer
// to /resources CRUD than an AI call, so the ceiling is generous like the general `limiter`.
const CLASSROOM_MANAGEMENT_RATE_LIMIT_MAX_REQUESTS = parseIntEnv(process.env.CLASSROOM_MANAGEMENT_RATE_LIMIT_MAX_REQUESTS, {
  name: 'CLASSROOM_MANAGEMENT_RATE_LIMIT_MAX_REQUESTS', defaultValue: isProduction ? 300 : 1200, min: 1, max: 100000,
});

const classroomLimiter = rateLimit({
  windowMs: parseInt(RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000,
  max: CLASSROOM_MANAGEMENT_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

const supportLimiter = rateLimit({
  windowMs: parseInt(RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000,
  max: SUPPORT_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

// Teacher Attendance gets its own bucket, like classroomLimiter: a check-in or check-out is a small write, about two a
// day per teacher, so the ceiling only matters for retries and offline-queue flushes.
const TEACHER_ATTENDANCE_RATE_LIMIT_MAX_REQUESTS = parseIntEnv(process.env.TEACHER_ATTENDANCE_RATE_LIMIT_MAX_REQUESTS, {
  name: 'TEACHER_ATTENDANCE_RATE_LIMIT_MAX_REQUESTS', defaultValue: isProduction ? 300 : 1200, min: 1, max: 100000,
});

const teacherAttendanceLimiter = rateLimit({
  windowMs: parseInt(RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000,
  max: TEACHER_ATTENDANCE_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

// Separate, tighter bucket for POST /api/schedule-demo/bookings: a public, unauthenticated write with no per-user
// budget (the visitor has no account), as with SUPPORT_RATE_LIMIT_MAX_REQUESTS.
const DEMO_BOOKING_RATE_LIMIT_MAX_REQUESTS = parseIntEnv(process.env.DEMO_BOOKING_RATE_LIMIT_MAX_REQUESTS, {
  name: 'DEMO_BOOKING_RATE_LIMIT_MAX_REQUESTS', defaultValue: isProduction ? 5 : 100, min: 1, max: 100000,
});

const demoBookingLimiter = rateLimit({
  windowMs: parseInt(RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000,
  max: DEMO_BOOKING_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

// Separate bucket for POST /api/coach/learning-representation, as for assistantLimiter: an optional feature mustn't
// eat the budget for ordinary questions. Up to two Gemini calls per request, so the ceiling sits between
// assistantLimiter (one cheap call) and attachmentLimiter (the most expensive).
const LEARNING_REPRESENTATION_RATE_LIMIT_MAX_REQUESTS = parseIntEnv(
  process.env.LEARNING_REPRESENTATION_RATE_LIMIT_MAX_REQUESTS,
  { name: 'LEARNING_REPRESENTATION_RATE_LIMIT_MAX_REQUESTS', defaultValue: isProduction ? 60 : 600, min: 1, max: 100000 }
);

const learningRepresentationLimiter = rateLimit({
  windowMs: parseInt(RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000,
  max: LEARNING_REPRESENTATION_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

// /generate is the most expensive path (a Gemini call with an 8-call budget) and was guarded by authRequired alone.
// Built by a factory so the limiter test can mount the real one on a throwaway app instead of exhausting this shared one.
const generateLimiter = createGenerateLimiter({
  env: process.env,
  isProduction,
  windowMinutes: parseInt(RATE_LIMIT_WINDOW_MINUTES, 10),
});

// Separate bucket for POST/DELETE /api/auth/me/avatar. Hardcoded, not env-parsed: a core Settings capability with no
// rollout to tune. Uploads are infrequent, so it only needs to bound someone hammering the endpoint.
const avatarLimiter = rateLimit({
  windowMs: parseInt(RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000,
  max: isProduction ? 20 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

// Stricter limiter for auth endpoints, to slow credential guessing. The ceiling is env-overridable and development-aware
// like the others. It's mounted on the whole /api/auth router, so POST /refresh and GET /me, which fire on every page
// load, count against the same 30-request budget as login; a developer reloading a dozen times would be locked out
// for 15 minutes with "Too many attempts" pointing at their password.
// The production default stays 30, since slowing online credential guessing is the real goal; only the development
// ceiling is raised. The 15-minute window is intentionally longer than RATE_LIMIT_WINDOW_MINUTES.
const AUTH_RATE_LIMIT_MAX_REQUESTS = parseIntEnv(process.env.AUTH_RATE_LIMIT_MAX_REQUESTS, {
  name: 'AUTH_RATE_LIMIT_MAX_REQUESTS', defaultValue: isProduction ? 30 : 300, min: 1, max: 100000,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: AUTH_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

// Routes

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authLimiter, authRouter);

// Is this teacher inside Classroom Mode's staged rollout? Mirrors `isWithinRollout` in routes/attachments.js, including
// fail-closed: an empty allow-list means every school, a non-empty one costs a lookup, and a lookup that throws denies.
// Not shared with that copy, which is bound to the attachment flag shape and behind that router's gate.
async function isWithinClassroomRollout(user, flags) {
  if (!flags.enabled) return false;
  if (flags.allowedSchoolCodes.length === 0) return true;
  try {
    const school = await prisma.school.findUnique({ where: { id: user.schoolId }, select: { code: true } });
    return Boolean(school && flags.allowedSchoolCodes.includes(school.code));
  } catch {
    return false;
  }
}

app.post('/api/coach', authRequired, limiter, async (req, res) => {
  // Correlation ID for this AI request: logged with every event and returned to the client so a problem report can quote it. Contains no user data.
  const requestId = crypto.randomUUID();

  const { query, context = {}, language = 'en', classroomMode = false, conversationId: rawConversationId } = req.body || {};

  // --- Input validation (system boundary) ---
  // Optional: groups this turn with the earlier turns of the same chat thread (see Query.conversationId).
  if (rawConversationId !== undefined && (typeof rawConversationId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(rawConversationId))) {
    return res.status(400).json({ error: 'Invalid "conversationId".', requestId });
  }
  const conversationId = rawConversationId || null;
  if (typeof query !== 'string' || query.trim().length === 0) {
    return res.status(400).json({ error: 'A non-empty "query" string is required.', requestId });
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return res.status(400).json({ error: `Query must be at most ${MAX_QUERY_LENGTH} characters.`, requestId });
  }
  if (typeof context !== 'object' || Array.isArray(context)) {
    return res.status(400).json({ error: '"context" must be an object.', requestId });
  }
  if (typeof language !== 'string' || !LANGUAGE_NAMES[language]) {
    return res.status(400).json({ error: 'Unsupported "language".', requestId });
  }

  // Only pass through known context fields.
  const safeContext = {
    grade: typeof context.grade === 'string' ? context.grade.slice(0, 60) : undefined,
    subject: typeof context.subject === 'string' ? context.subject.slice(0, 60) : undefined,
    classroomType:
      typeof context.classroomType === 'string' ? context.classroomType.slice(0, 60) : undefined,
    issueType: typeof context.issueType === 'string' ? context.issueType.slice(0, 60) : undefined,
  };

  // Normalize the query (NFKC, strip invisible/control characters; see safety/inputGuard.js) before any use: prompts,
  // the injection heuristic or persistence. A query that normalizes to nothing is treated as empty.
  const normalizedQuery = normalizeQuery(query.trim());
  if (normalizedQuery.length === 0) {
    return res.status(400).json({ error: 'A non-empty "query" string is required.', requestId });
  }

  try {
    // Classroom Mode: start the planner now, alongside the answer, so its latency hides behind the longer coaching call.
    // It's awaited only once the answer is ready.
    // `classroomMode === true` is an exact check, since it decides whether to spend a model call and a stray "false" or 1
    // mustn't buy one. The server flag is checked too, so a client sending classroomMode after the feature is off is
    // ignored; the server is the real kill switch.
    const classroomRequested = classroomMode === true && classroomModeFlagsAtBoot.enabled;
    const classroomPlanPromise = classroomRequested
      ? isWithinClassroomRollout(req.user, classroomModeFlagsAtBoot).then((allowed) =>
          allowed
            ? planClassroom({
                // `geminiFast`, not the coaching `gemini`: the planner is a small classification call with a fixed JSON shape, like
                // the router's (flash-lite, short timeouts, maxContinuations: 0). It's cheaper and faster, which matters for a call
                // that must finish before the answer, and it draws on a different model's quota, so planning can't starve the answer.
                gemini: geminiFast,
                query: normalizedQuery,
                context: safeContext,
                language,
                requestId,
                log: logAiEvent,
              })
            : null
        )
      : Promise.resolve(null);
    // planClassroom swallows its own failures; this guards against an unexpected throw in the rollout lookup becoming an
    // unhandled rejection while the answer call is in flight.
    const classroomPlanSettled = classroomPlanPromise.catch(() => null);

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

    const result = await gemini.generateResponse(
      {
        query: normalizedQuery,
        context: safeContext,
        language,
        responseStyle,
      },
      { correlationId: requestId }
    );

    // `metrics` is internal observability and must not be spread into the client response.
    const { metrics, ...clientResult } = result;

    // Metadata-only structured log for every AI request: call counts,
    // retries, continuations, latency, outcome. No prompt/response text.
    logAiEvent('info', 'coach_completed', { requestId, ...metrics });

    // Persist the query for history + analytics. A failure here must not break
    // the response the teacher is waiting for.
    let queryId = null;
    try {
      // A later turn inherits the thread's rename/pin, which are stored per row and applied to the whole thread. Scoped to
      // this user, so another user's identical id can't leak a title.
      const thread = conversationId
        ? await prisma.query.findFirst({
            where: { userId: req.user.id, OR: [{ id: conversationId }, { conversationId }] },
            orderBy: { createdAt: 'desc' },
            select: { title: true, pinned: true },
          })
        : null;
      const saved = await prisma.query.create({
        data: {
          userId: req.user.id,
          schoolId: req.user.schoolId,
          queryText: normalizedQuery,
          language,
          context: JSON.stringify(safeContext),
          responseText: clientResult.text,
          responseTimeMs: clientResult.responseTime || null,
          finishReason: clientResult.finishReason || null,
          conversationId,
          ...(thread ? { title: thread.title, pinned: thread.pinned } : {}),
        },
      });
      queryId = saved.id;
    } catch (persistError) {
      logAiEvent('error', 'query_persist_failed', { requestId, message: persistError.message });
    }

    // Best-effort prompt-injection telemetry: never blocks the response, and stores only a category label plus IDs,
    // never the raw query or response. See safety/inputGuard.js for why it's advisory.
    const injectionCheck = flagPossibleInjection(normalizedQuery);
    if (injectionCheck.flagged) {
      logAiEvent('warn', 'possible_injection_flagged', { requestId, userId: req.user.id, queryId, category: injectionCheck.category });
      try {
        await prisma.event.create({
          data: {
            userId: req.user.id,
            schoolId: req.user.schoolId,
            type: 'ai_safety_flag',
            metadata: JSON.stringify({ category: injectionCheck.category, queryId }),
          },
        });
      } catch (eventError) {
        logAiEvent('error', 'safety_event_write_failed', { requestId, message: eventError.message });
      }
    }

    // Collect the planner's decision. `null` (mode off, a gate fired, no teachable topic, or any failure) omits the key
    // rather than sending an empty object, so a client that never uses the feature gets the response it always did.
    const classroomPlan = await classroomPlanSettled;

    // Classroom Mode telemetry: best-effort, metadata-only (artifact names and counts, never the question, topic or
    // generated text). Written here because this is the only place that knows the mode was requested, the rollout
    // allowed it, and what the planner decided. `planned: 0` is the row to watch: the mode was on and produced
    // nothing, which means the planner's gates may be too tight.
    if (classroomRequested) {
      // Persist the plan on the Query row so reopening the chat restores the artifact cards. It's an UPDATE after the
      // fact because the plan settles later than the answer, and folding it into the create would make every ordinary
      // question wait on it. Best-effort: a failure only means reopening the chat won't restore the cards.
      if (queryId && classroomPlan) {
        try {
          await prisma.query.update({
            where: { id: queryId },
            data: { classroomPlan: JSON.stringify(classroomPlan) },
          });
        } catch (planError) {
          logAiEvent('error', 'classroom_plan_persist_failed', { requestId, message: planError.message });
        }
      }

      try {
        await prisma.event.create({
          data: {
            userId: req.user.id,
            schoolId: req.user.schoolId,
            type: 'classroom_mode_planned',
            metadata: JSON.stringify({
              planned: classroomPlan ? classroomPlan.artifacts.length : 0,
              artifacts: classroomPlan ? classroomPlan.artifacts : [],
              language: classroomPlan ? classroomPlan.language : language,
              queryId,
            }),
          },
        });
      } catch (eventError) {
        logAiEvent('error', 'classroom_event_write_failed', { requestId, message: eventError.message });
      }
    }

    return res.json({
      success: true,
      ...clientResult,
      context: safeContext,
      queryId,
      requestId,
      ...(conversationId ? { conversationId } : {}),
      ...(classroomPlan ? { classroom: classroomPlan } : {}),
      // Separates "the mode was on and found nothing to make" from "the mode was off"; only the first shows the teacher an
      // explanation, and the client can't tell them apart otherwise since both lack `classroom`.
      ...(classroomRequested ? { classroomMode: true } : {}),
    });
  } catch (error) {
    // Metadata-only failure log, including the reliability metrics attached to the error (call counts, timed out, rate
    // limited). Never the prompt, response or upstream error body.
    logAiEvent('error', 'coach_request_failed', {
      requestId,
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.metrics || {}),
    });

    // Record notable reliability incidents durably (best-effort), not routine failures: rare enough not to bloat the
    // Event table, and useful for spotting upstream outages and rate-limit storms afterwards.
    const notable = { DEADLINE_EXCEEDED: 'ai_deadline_exceeded', BUDGET_EXHAUSTED: 'ai_budget_exhausted' };
    let notableType = notable[error.code];
    if (!notableType && error.status === 429) notableType = 'ai_rate_limit_exhausted';
    else if (!notableType && (error.status >= 500 || error.status == null) && !error.code) notableType = 'ai_upstream_failed';
    if (notableType) {
      try {
        await prisma.event.create({
          data: {
            userId: req.user.id,
            schoolId: req.user.schoolId,
            type: notableType,
            metadata: JSON.stringify({
              requestId,
              status: error.status ?? null,
              outcome: error.metrics?.outcome ?? null,
              callsMade: error.metrics?.callsMade ?? null,
            }),
          },
        });
      } catch (eventError) {
        logAiEvent('error', 'reliability_event_write_failed', { requestId, message: eventError.message });
      }
    }

    // The RATE_LIMITED/TIMEOUT/UPSTREAM_AUTH/UPSTREAM_UNAVAILABLE mapping is in lib/sendAiError.js (shared with
    // routes/resources.js and routes/attachments.js). /coach alone distinguishes DEADLINE_EXCEEDED from a per-call timeout with two messages.
    return sendAiError(res, error, requestId, {
      safetyBlockedMessage: "This question couldn't be processed — try rephrasing it.",
      deadlineExceededMessage: 'The request took too long. Please try again.',
      timeoutMessage: 'The request timed out. Please try again.',
      upstreamUnavailableMessage: 'Failed to generate a response. Please try again.',
    });
  }
});

// Teacher history + feedback, saved resources (My Library), and admin
// analytics/management.
app.use('/api', dataRouter);
// Mounted ahead of the resources router rather than inside it, so routes/resources.js isn't opened again. It must
// precede the router it guards, and only the generate path is matched.
app.use('/api/resources/generate', generateLimiter);
app.use('/api', resourcesRouter);
app.use('/api/admin', adminRouter);
// Admin Support Inbox. No dedicated rate limiter, like the other /api/admin/* routes: authRequired and requireRole('super_admin') gate it.
app.use('/api/admin/support', adminSupportRouter);
// Schedule a Call admin inbox — same "no dedicated rate limiter" reasoning
// as adminSupportRouter above.
app.use('/api/admin/demo-bookings', adminScheduleDemoRouter);
// Admin Settings > Feature Management — same "no dedicated rate limiter"
// reasoning as adminSupportRouter above.
app.use('/api/admin/feature-flags', adminSettingsRouter);

// AI Action Router, mounted after the existing routers and before the global error handler, so no existing chain
// changes and its new paths can't shadow an endpoint. With ASSISTANT_ENABLED unset every response is an inert empty catalog.
app.use('/api/assistant', assistantLimiter, assistantRouter);

// Multimodal attachments. The limiter binds to the exact path ahead of the router, so nothing else is affected.
app.use('/api/coach/attachment', attachmentLimiter);
app.use('/api', attachmentsRouter);

// Limits the POST/DELETE upload and remove paths only: app.use matches the path prefix, so the cache-friendly
// read-only GET /users/:id/avatar stays unlimited.
app.use('/api/auth/me/avatar', avatarLimiter);
app.use('/api', avatarRouter);

// Help & Support. The limiter binds to the exact path ahead of its router. With HELP_SUPPORT_ENABLED unset the route returns 503.
app.use('/api/support/tickets', supportLimiter);
app.use('/api', supportRouter);

// AI Learning Representation. The limiter binds to the exact path ahead of its router. With LEARNING_REPRESENTATION_ENABLED
// unset the route returns its inert `{representation: 'verbal_explanation', data: null}` response.
app.use('/api/coach/learning-representation', learningRepresentationLimiter);
app.use('/api', learningRepresentationRouter);

// Notification System. GET (list, unread-count) and POST (send) share /api/notifications, and app.use() matches by
// path only, so a prefix mount would put the cheap self-scoped GETs behind the tight bucket meant for the send route.
// This scopes the limiter to POST. With NOTIFICATIONS_ENABLED unset every route 503s. routes/notifications.js emits
// realtime events through req.app.locals.socketServer (set near app.listen below).
app.use('/api/notifications', (req, res, next) => {
  if (req.method !== 'POST') return next();
  return notificationsSendLimiter(req, res, next);
});
app.use('/api', notificationsRouter);

// Classroom Management. Its routes already start with "/classroom/...", so the limiter binds to that prefix ahead of
// the router, which mounts at the general "/api" (mounting at "/api/classroom" would double the prefix). With
// CLASSROOM_MANAGEMENT_ENABLED unset every /api/classroom/* route returns 503.
app.use('/api/classroom', classroomLimiter);
app.use('/api', classroomRouter);

// Teacher Attendance, mounted like Classroom Management above: routes self-prefix "/teacher-attendance/...", the
// limiter binds to that prefix, and the router mounts at "/api". With TEACHER_ATTENDANCE_ENABLED unset every route returns 503.
app.use('/api/teacher-attendance', teacherAttendanceLimiter);
app.use('/api', teacherAttendanceRouter);

// Schedule a Call. Its routes already start with "/schedule-demo/...". Only POST/PATCH (create, reschedule, cancel)
// are behind the tight bucket, as with the notifications send limiter, so paging through GET /slots isn't throttled.
// With DEMO_BOOKING_ENABLED unset every /api/schedule-demo/* route returns 503.
app.use('/api/schedule-demo', (req, res, next) => {
  if (req.method !== 'POST' && req.method !== 'PATCH') return next();
  return demoBookingLimiter(req, res, next);
});
app.use('/api', scheduleDemoRouter);

// Global error handler, the last line of defence. Routes wrapped in asyncHandler forward a rejected promise here via
// next(err) instead of an unhandled rejection, which on Node 18+ crashes the process (as a single Prisma P2021 once
// caused a full outage). Must be registered after all routers. It never echoes the raw error message or stack to
// the client; only status, path, method and error identity are logged.
app.use((err, req, res, _next) => {
  // A body that isn't valid JSON is a client error: body-parser throws a SyntaxError with status 400, which this
  // handler used to flatten into a 500. That was wrong twice:
  //   1. POST /api/assistant/interpret may never return a 5xx; the client treats one as "endpoint unhealthy" and opens
  //      its circuit breaker, so a single malformed request disabled routing for a minute.
  //   2. Node's JSON parser puts ~20 characters of the raw body in its message, which was logged verbatim, and on that
  //      endpoint the body is the teacher's utterance.
  // So this answers 400 and logs the shape of the failure, never its content, for every endpoint.
  // The 400 also has to reach the browser: cors() is registered above the body-parser, so its
  // Access-Control-Allow-Origin header is already on `res` (see the cors() registration above).
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    console.warn('Malformed JSON body:', { method: req.method, path: req.path });
    if (res.headersSent) return;
    return res.status(400).json({ error: 'The request body was not valid JSON.' });
  }

  console.error('Unhandled request error:', {
    method: req.method,
    path: req.path,
    message: err.message,
    code: err.code,
  });
  if (res.headersSent) return;
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// Notification System: Socket.IO. Wired unconditionally (not just under require.main === module below) so
// req.app.locals.socketServer is populated for anything holding this `app`, including a test that wraps it in its
// own http.createServer. It needs an http.Server to attach to but opens no port; only httpServer.listen() below does, and only when run directly.
const http = require('http');
const httpServer = http.createServer(app);
app.locals.socketServer = initSocketServer(httpServer, {
  isOriginAllowed,
  // Read live on every handshake, so the env var is an immediately effective kill switch (see lib/flags.js).
  isEnabled: () => readNotificationsFlags(process.env).enabled,
});

// Start

// Only bind a real port when this file is run directly (`node src/index.js`, i.e. `npm start`/`npm run dev`). When
// the tests require it for Supertest, no real socket is opened; Supertest drives the app in-process.
/* istanbul ignore next -- exercised via `npm start`, not the test suite */
if (require.main === module) {
  // httpServer, not app.listen: Socket.IO is already attached, so this one listen() serves both the REST API and realtime notifications.
  httpServer.listen(PORT, () => {
    console.log(`Teacher Assistant backend listening on port ${PORT}`);
    // If NODE_ENV=production and CORS_ORIGINS were empty the process would already have exited above, so here we're
    // either in development (any origin reflected) or the allowlist is populated.
    if (isProduction) {
      console.log(`CORS allowlist: ${allowedOrigins.join(', ')}`);
    } else {
      console.log('CORS: development mode — reflecting any request origin.');
    }
  });

  // Teacher Attendance's checkout reminder (docs/feature-teacher-attendance-implementation-plan.md), only under this
  // require.main guard like listen(): a test requiring this module for `app` must not start a background timer nothing
  // tears down. Each tick is a no-op when the feature or notifications are off (checked live in the sweep).
  setInterval(() => {
    runCheckoutReminderSweep(new Date(), app.locals.socketServer).catch((err) => {
      console.error('[teacher-attendance] checkout reminder sweep failed', { message: err.message });
    });
  }, teacherAttendanceReminderIntervalMs);
}

module.exports = app;
