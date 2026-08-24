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

const crypto = require('crypto');

const { GeminiService } = require('./gemini');
const { LANGUAGE_NAMES } = require('./prompts');
const { normalizeQuery, flagPossibleInjection } = require('./safety/inputGuard');
const { parseIntEnv } = require('./lib/config');
const { prisma } = require('./lib/db');
const { authRequired } = require('./middleware/auth');
const authRouter = require('./routes/auth');
const dataRouter = require('./routes/queries');
const adminRouter = require('./routes/admin');
const resourcesRouter = require('./routes/resources');
// AI Action Router (Phase 1). Requiring this validates the capability registry
// at boot, so a malformed action descriptor stops the server here rather than
// surfacing later as a strange routing failure.
const assistantRouter = require('./routes/assistant');
// Multimodal attachments (Coach: image/PDF upload). A sibling feature to the
// Action Router, not part of it — see docs/multimodal-attachments-architecture.md
// for why. Requiring it here is the same "fail at boot, not at request time"
// reasoning as assistantRouter above.
const attachmentsRouter = require('./routes/attachments');
// Custom profile pictures — a sibling feature, same "fail at boot" reasoning
// as the routers above. Reuses auth.js's publicUser() internally (see that
// file's exports).
const avatarRouter = require('./routes/avatar');
// Help & Support (Phase 1: bug reports + feedback, no attachment upload yet).
// A sibling feature, same "fail at boot on a malformed module" reasoning as
// assistantRouter/attachmentsRouter above.
const supportRouter = require('./routes/support');
// Admin Support Inbox (Phase 2) — super_admin-only ticket management. A
// sibling of adminRouter, not an extension of it (see routes/adminSupport.js
// for why access is modeled differently here).
const adminSupportRouter = require('./routes/adminSupport');
const adminSettingsRouter = require('./routes/adminSettings');
// Notification System — a sibling feature, same "fail at boot on a malformed
// module" reasoning as every router above. See docs/notification-system-plan.md.
const notificationsRouter = require('./routes/notifications');
// Classroom Management (docs/classroom-feature-plan.md) — a teacher-first
// class/student/attendance/fee workspace. A sibling feature, same "fail at
// boot on a malformed module" reasoning as every router above. NOT the same
// feature as "Classroom Mode" below (planClassroom/CLASSROOM_MODE_ENABLED) —
// that is an unrelated AI chat feature; this router never touches it.
const classroomRouter = require('./routes/classroom');
const { initSocketServer } = require('./lib/socketServer');
const { readNotificationsFlags } = require('./lib/flags');
// AI Learning Representation System (ADR Phase D). A sibling feature, same
// "fail at boot on a malformed module" reasoning as assistantRouter/
// attachmentsRouter/supportRouter above. Requiring it here also validates
// mapping.js's completeness guard and schemas.js's registry-consistency
// guard at boot (both throw on load if their data is out of sync) rather
// than surfacing as a strange failure on the first real request.
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

// Logs only non-sensitive metadata about an AI request/response — never the
// raw query text, response text, upstream error body, API keys, tokens, or
// PII. Centralizing this in one helper makes the safe pattern the path of
// least resistance for future changes to this route, rather than relying on
// convention alone.
function logAiEvent(level, event, meta = {}) {
  const fn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
  fn(`[ai] ${event}`, meta);
}

// ---- Configuration ---------------------------------------------------------

const {
  GEMINI_API_KEY,
  GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
  PORT = 3000,
  CORS_ORIGINS = '',
  RATE_LIMIT_WINDOW_MINUTES = '15',
} = process.env;

if (!GEMINI_API_KEY) {
  console.error('FATAL: GEMINI_API_KEY is not set. Copy .env.example to .env and set it.');
  process.exit(1);
}

const MAX_QUERY_LENGTH = 500;

// Computed here (rather than down near the CORS check, where this used to
// live) because RATE_LIMIT_MAX_REQUESTS below needs it too.
const isProduction = process.env.NODE_ENV === 'production';

// Our own per-IP cap on POST /coach — distinct from Gemini's own quota (see
// the 429 branch in the /coach handler below, which maps that separately).
// Defaults are environment-aware: production keeps the existing conservative
// 60/window unless explicitly raised, but local development defaults much
// higher (300/window) because a single person iterating on the UI can
// legitimately exceed 60 requests in 15 minutes, and that shouldn't produce
// the same 429 a real high-volume/abusive client would trigger. An explicit
// RATE_LIMIT_MAX_REQUESTS always wins in either environment.
const RATE_LIMIT_MAX_REQUESTS = parseIntEnv(process.env.RATE_LIMIT_MAX_REQUESTS, {
  name: 'RATE_LIMIT_MAX_REQUESTS', defaultValue: isProduction ? 60 : 300, min: 1, max: 100000,
});

// LLM reliability / cost tunables. Invalid values clamp to safe bounds with a
// warning (see lib/config.js) rather than crashing — a bad tunable must not
// take the whole server down, while production still gets a safe value.
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

const gemini = new GeminiService({
  apiKey: GEMINI_API_KEY,
  endpoint: GEMINI_ENDPOINT,
  timeoutMs: LLM_TIMEOUT_MS,
  totalTimeoutMs: LLM_TOTAL_TIMEOUT_MS,
  maxRetries: LLM_MAX_RETRIES,
  maxCallsPerRequest: LLM_MAX_CALLS_PER_REQUEST,
  maxContinuations: LLM_MAX_CONTINUATIONS,
  maxOutputTokens: LLM_MAX_OUTPUT_TOKENS,
});

// ---- AI Action Router: the routing model (M5) ------------------------------
//
// A SECOND GeminiService instance, not a modified one. gemini.js already
// accepts every tunable per instance, so routing needs no change to a service
// that Coach, AI Assist and the Generator all share (guardrail G21) — editing
// it to serve routing would put three working features at risk for one new one.
//
// The budgets below are the whole reason this instance exists. Coaching gets 30s
// per call and 60s overall, which is right for writing a lesson plan and
// catastrophic for a routing decision sitting in front of a text box: the
// teacher is waiting to send a message, not to receive an essay. Routing gets
// ~3.5s per call and a 5s overall deadline, and EXCEEDING THAT DEADLINE IS A
// DECISION, NOT AN ERROR — the pipeline returns passthrough and the teacher
// gets their coaching answer (guardrail G20).
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

// ---- AI Action Router: the cost and availability guards (M9) ---------------
//
// Two stateful objects, both constructed HERE and injected via app.locals in
// the same way geminiFast is, rather than held as module state inside the
// assistant folder (approval A4). The server suite shares one required index.js
// per worker, so a module-level counter — or a breaker one test left open —
// would leak into unrelated test files and make failures order-dependent.
//
// Neither can make a request fail. An exhausted budget and an open breaker both
// produce a passthrough, which is a normal coaching answer (G22).
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

// A SECOND counter, for telemetry ROWS — added by the M9 security review, which
// found that POST /api/assistant/events had no per-user bound at all. Only the
// shared IP limiter stood in front of it, and each request may carry a batch, so
// one hostile or simply looping client could sustain writes against exactly the
// single-writer table CHANGE-6 exists to keep quiet (threat 4).
//
// The limit is DERIVED rather than a new env var, because it is not an
// independent policy: the design ceiling is two rows per routed session, so
// twice the interpret budget covers every legitimate session a teacher can
// have, and the constant is headroom for a client that re-delivers a batch.
// Separate from the routing counter on purpose — telemetry must never be able
// to eat the budget a teacher needs for actual routing.
//
// Exceeding it drops the batch silently (204). Telemetry is fire-and-forget by
// contract and already fails soft, so this can lose a measurement and can never
// cost a teacher anything.
const assistantEventBudget = createBudgetCounter({
  limit: assistantFlags.dailyBudgetPerUser * 2 + 20,
});
const assistantBreaker = createRouterBreaker({
  threshold: ASSISTANT_BREAKER_429_THRESHOLD,
  windowMs: ASSISTANT_BREAKER_WINDOW_MS,
  cooldownMs: ASSISTANT_BREAKER_COOLDOWN_MS,
});

const geminiFast = new GeminiService({
  apiKey: GEMINI_API_KEY,
  endpoint: ASSISTANT_GEMINI_ENDPOINT,
  timeoutMs: ASSISTANT_LLM_TIMEOUT_MS,
  totalTimeoutMs: ASSISTANT_LLM_TOTAL_TIMEOUT_MS,
  maxRetries: ASSISTANT_LLM_MAX_RETRIES,
  maxCallsPerRequest: ASSISTANT_LLM_MAX_CALLS,
  // Zero continuations: a classification result is a small JSON object, and
  // gemini.js already skips the continuation loop for structured responses.
  // Stating it here means the intent survives if that ever changes.
  maxContinuations: 0,
  maxOutputTokens: ASSISTANT_LLM_MAX_OUTPUT_TOKENS,
});

// ---- Multimodal attachments: a THIRD GeminiService instance ---------------
//
// Same reasoning as geminiFast above: a multimodal call (image/PDF tokens)
// is slower and more expensive than a text-only coaching call, and it is not
// a classification decision that should ever silently degrade to
// passthrough — so it gets its OWN tunables rather than sharing either of
// the other two instances' budgets.
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
  apiKey: GEMINI_API_KEY,
  endpoint: ATTACHMENT_GEMINI_ENDPOINT,
  timeoutMs: ATTACHMENT_LLM_TIMEOUT_MS,
  totalTimeoutMs: ATTACHMENT_LLM_TOTAL_TIMEOUT_MS,
  maxRetries: ATTACHMENT_LLM_MAX_RETRIES,
  maxCallsPerRequest: ATTACHMENT_LLM_MAX_CALLS_PER_REQUEST,
  maxContinuations: LLM_MAX_CONTINUATIONS,
  maxOutputTokens: ATTACHMENT_LLM_MAX_OUTPUT_TOKENS,
});

// Per-user daily budget, reusing the router's already-generic counter
// (assistant/budget.js has no actual dependency on the router — see its own
// module doc). Same in-memory, per-process, resets-on-restart tradeoffs,
// accepted for the same reason: it matches express-rate-limit's existing
// MemoryStore behavior rather than introducing a new class of weakness.
const attachmentFlagsAtBoot = readAttachmentFlags(process.env);
const attachmentBudget = createBudgetCounter({ limit: attachmentFlagsAtBoot.dailyBudgetPerUser });

// AI Learning Representation System (ADR Phase D). Same generic counter,
// same per-process/in-memory tradeoffs already accepted for
// assistantBudget/attachmentBudget above — see assistant/budget.js's own
// header for the reasoning, which is not repeated per call site.
const learningRepresentationFlagsAtBoot = readLearningRepresentationFlags(process.env);
const learningRepresentationBudget = createBudgetCounter({
  limit: learningRepresentationFlagsAtBoot.dailyBudgetPerUser,
});

// Phase E — request-level render cache. In-memory, per-process, resets on
// restart; the full reasoning (why that trade-off is accepted, and why a
// persistent cache was rejected for V1) lives in
// learningRepresentation/rendering/cache.js's own header rather than being
// repeated here — the same "documented once, at the source" discipline
// already applied to assistantBudget/attachmentBudget above.
const learningRepresentationRenderCache = createRenderCache();

// Classroom Mode (docs/classroom-mode.md). Read once at boot, like every flag
// above. This is the authoritative gate: the client's own
// VITE_CLASSROOM_MODE_ENABLED decides only whether the "+" button renders, and
// a PWA can serve a cached client whose flag is stale by hours. Turning this
// off stops the planner and every downstream artifact call for everyone,
// including those clients — which is what makes it a usable spend control (D13).
const classroomModeFlagsAtBoot = readClassroomModeFlags(process.env);

// ---- App setup -------------------------------------------------------------

const app = express();
app.disable('x-powered-by');
// Expose the single GeminiService instance to routers (e.g. the resources
// router's Lesson Plan Workspace AI actions) without re-constructing it or
// leaking the API key. Read via req.app.locals.gemini.
app.locals.gemini = gemini;
// The routing instance, read by the assistant router as req.app.locals.geminiFast.
// Kept a SEPARATE local rather than a field on `gemini` so that reaching for the
// wrong one is a visibly wrong line of code rather than a subtle option.
app.locals.geminiFast = geminiFast;
// M9 guards, read by the assistant router. Same pattern and the same reason as
// geminiFast: constructed once, reached explicitly, never a module singleton.
app.locals.assistantBudget = assistantBudget;
app.locals.assistantEventBudget = assistantEventBudget;
app.locals.assistantBreaker = assistantBreaker;
// Multimodal attachments, read by routes/attachments.js as
// req.app.locals.attachmentGemini / .attachmentBudget. Same pattern as
// geminiFast/assistantBudget above: constructed once, injected explicitly,
// never a module singleton (so the test suite can build its own app).
app.locals.attachmentGemini = attachmentGemini;
app.locals.attachmentBudget = attachmentBudget;
// AI Learning Representation System, read by routes/learningRepresentation.js
// as req.app.locals.learningRepresentationBudget. Uses the EXISTING gemini /
// geminiFast locals above directly (no third instance) — see the route's
// own comment for why each is the right fit for its call.
app.locals.learningRepresentationBudget = learningRepresentationBudget;
// Phase E, read by rendering/cache.js's caller as
// req.app.locals.learningRepresentationRenderCache.
app.locals.learningRepresentationRenderCache = learningRepresentationRenderCache;
// Railway (like most PaaS) puts exactly one reverse-proxy hop in front of
// this app. Trusting that one hop lets Express derive req.ip from the
// X-Forwarded-For header Railway sets, which express-rate-limit needs to
// rate-limit real client IPs instead of Railway's proxy IP for everyone —
// and without this, express-rate-limit refuses to start with
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR (it won't trust a forwarded-for header
// unless Express is explicitly configured to expect one). Trusting a fixed
// hop count (not `true`, which would trust the whole chain) keeps req.ip
// unspoofable by a client-supplied X-Forwarded-For value.
app.set('trust proxy', 1);
app.use(helmet());

const allowedOrigins = CORS_ORIGINS.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// In development we reflect ANY origin so the frontend works no matter how it
// is served (Live Server on 5500, http-server on 8000, or the machine's LAN IP
// like http://10.x.x.x:8000). In production, set NODE_ENV=production and list
// the exact allowed origins in CORS_ORIGINS to lock this down.
//
// isProduction (computed above, near RATE_LIMIT_MAX_REQUESTS) defaults to
// false (dev-permissive) only when NODE_ENV is unset, which is the normal
// local-dev case. If NODE_ENV IS set to 'production' but CORS_ORIGINS is
// empty, we refuse to boot rather than silently falling back to either
// "block everything" (confusing) or "allow everything" (unsafe) — same
// fail-fast pattern already used for GEMINI_API_KEY and JWT_SECRET.
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

// Registered BEFORE the JSON body-parser below (and before every router), on
// purpose. cors() sets its response headers synchronously and then calls
// next() — it does not touch the request body — so this ordering has no
// effect on any successful request. What it fixes: when express.json() below
// throws on a malformed body, Express jumps straight to the error-handling
// middleware at the bottom of this file, skipping every regular middleware
// in between. If cors() were still registered after the body-parser (as it
// used to be), it would never run for that request, the error response would
// go out with no Access-Control-Allow-Origin header, and the browser would
// discard it as a CORS violation — surfacing to the frontend as an opaque
// "Failed to fetch" instead of the clean 400 the error handler already sends
// (see the SyntaxError branch below). Running cors() first means its headers
// are already attached to `res` by the time that branch responds, for every
// request regardless of whether a later middleware throws.
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
    // Without this, a cross-origin fetch() can't read Content-Disposition
    // from the response (browsers only expose a small "simple header" list
    // by default) — needed so a CSV download (routes/classroom.js's fee/
    // attendance export) can read the server's suggested filename via
    // res.headers.get() instead of falling back to a generic one.
    exposedHeaders: ['Content-Disposition'],
  })
);

// Parse JSON bodies with a 16kb limit everywhere, except the resources routes
// (My Library), which accept up to 64kb because a saved lesson plan with
// several structured sections can legitimately exceed 16kb. Scoping the larger
// limit to just those paths keeps every other endpoint on the tighter bound.
const jsonSmall = express.json({ limit: '16kb' });
const jsonLarge = express.json({ limit: '64kb' });
app.use((req, res, next) => {
  if (req.path.startsWith('/api/resources')) return jsonLarge(req, res, next);
  // Classroom Mode stores a turn's generated artifacts (D25) — up to five full
  // documents in one body, which comfortably exceeds 16kb. Same reasoning as
  // the resources routes above, scoped to the one path that needs it rather
  // than raising the limit for all of /api/queries.
  if (/^\/api\/queries\/[^/]+\/classroom-artifacts$/.test(req.path)) return jsonLarge(req, res, next);
  return jsonSmall(req, res, next);
});

const limiter = rateLimit({
  windowMs: parseInt(RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000,
  max: RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  // Deliberately worded differently from the Gemini-upstream 429 message
  // below (in the /coach handler's catch block) so the two are never
  // ambiguous: this one means "you (this IP) called our API too often";
  // that one means "the AI provider itself is rate-limiting us right now",
  // which more patience on the client side alone doesn't fix.
  message: { error: 'You have made too many requests. Please wait a few minutes and try again.' },
});

// Separate bucket for the assistant, deliberately NOT the /coach limiter above.
// Sharing one would let catalog fetches and routing decisions eat the budget a
// teacher needs for actual coaching answers — the optional feature must never
// degrade the core one. Higher ceiling than /coach because these calls are
// small and frequent (a catalog fetch per session, a routing decision per
// message) rather than large and occasional.
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

// Separate bucket for POST /api/coach/attachment, deliberately NOT shared
// with the /coach limiter above — attachment requests carry a file and cost
// far more per call, so they must not be able to eat the budget a teacher
// needs for ordinary text/voice questions. Lower ceiling than /coach's for
// the same reason /resources/generate got its own (tighter) limiter: this is
// the most expensive request shape in the product.
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

// Separate bucket for POST /api/support/tickets — deliberately its own,
// tighter limiter rather than reusing the general /coach `limiter`: this
// endpoint has no per-user daily budget (see lib/flags.js's Help & Support
// section), so the rate limiter is the only thing bounding a teacher who
// mashes "Report a Bug" repeatedly.
const SUPPORT_RATE_LIMIT_MAX_REQUESTS = parseIntEnv(process.env.SUPPORT_RATE_LIMIT_MAX_REQUESTS, {
  name: 'SUPPORT_RATE_LIMIT_MAX_REQUESTS', defaultValue: isProduction ? 20 : 300, min: 1, max: 100000,
});

// Separate bucket for POST /api/notifications (send/broadcast) — the only
// mutating-for-OTHERS notification route; GET/PATCH on the caller's own
// notifications stay under the general limiter, matching every other
// "cheap, frequent, self-scoped" endpoint in this app.
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

// Classroom Management — own bucket, matching the resourcesRouter/
// supportRouter precedent (docs/classroom-feature-plan.md §7). Classroom
// writes (create a class, add a student, mark a day's attendance, set a fee
// status) are frequent-but-cheap, closer to /resources CRUD than to an AI
// call, so this gets a generous ceiling like the general `limiter` rather
// than a generateLimiter-style tight one.
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

// Separate bucket for POST /api/coach/learning-representation — deliberately
// NOT the /coach limiter above, same reasoning as assistantLimiter: an
// optional, explicitly-triggered feature must never eat the budget a
// teacher needs for ordinary questions. Costs up to two Gemini calls per
// request (classify + render), so the ceiling sits between assistantLimiter
// (cheap, one call) and attachmentLimiter (most expensive call shape).
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

// M9. The generation endpoint is the most expensive path in the product — a
// real Gemini call with an 8-call budget behind it — and until now it was
// guarded by authRequired and nothing else. Architecture 10.4 calls this a
// pre-existing gap to close "regardless of this project"; the router only makes
// reaching it one utterance cheaper. Built by a factory so the limiter test can
// mount the real thing on a throwaway app instead of exhausting this shared one.
const generateLimiter = createGenerateLimiter({
  env: process.env,
  isProduction,
  windowMinutes: parseInt(RATE_LIMIT_WINDOW_MINUTES, 10),
});

// Separate bucket for POST/DELETE /api/auth/me/avatar. Hardcoded (not
// env-parsed like the AI-feature limiters above) — this is a core Settings
// capability with no rollout to tune, not a cost-tunable AI call. Uploads are
// infrequent for a legitimate user, so this only needs to be generous enough
// to not be annoying while still bounding someone hammering the endpoint.
const avatarLimiter = rateLimit({
  windowMs: parseInt(RATE_LIMIT_WINDOW_MINUTES, 10) * 60 * 1000,
  max: isProduction ? 20 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' },
});

// Stricter limiter for auth endpoints to slow down credential guessing.
//
// The ceiling is env-overridable and development-aware, like every other
// limiter in this file. It previously was not, and that was a bug rather than
// extra strictness: this limiter is mounted on the whole /api/auth router, so
// it counts POST /refresh and GET /me — which fire on EVERY page load — against
// the same 30-request budget as login itself. A developer reloading the client
// a dozen times would exhaust it without a single failed sign-in and then be
// locked out for the full 15 minutes, with "Too many attempts" pointing at
// their password.
//
// The PRODUCTION default is deliberately unchanged at 30. The security property
// here — making online credential guessing slow — is real, and only the
// development ceiling is raised. The 15-minute window is also unchanged (it is
// intentionally longer than RATE_LIMIT_WINDOW_MINUTES; a guessing attack is
// measured in minutes, not seconds).
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

// ---- Routes ----------------------------------------------------------------

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authLimiter, authRouter);

// Is this teacher inside Classroom Mode's staged rollout? Mirrors
// `isWithinRollout` in routes/attachments.js, including its fail-closed
// behaviour: an empty allow-list means every school, a non-empty one costs a
// single indexed lookup, and a lookup that throws denies rather than allows.
//
// Not shared with the attachments copy on purpose — that one is bound to the
// attachment flag shape and lives behind that router's own gate middleware.
// Two short readable functions beat one parameterised one that both features
// must then agree on forever.
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
  // Correlation ID for this AI request — logged with every event and returned
  // to the client so a teacher/admin can quote it when reporting a problem.
  // Not sensitive; contains no user data.
  const requestId = crypto.randomUUID();

  const { query, context = {}, language = 'en', classroomMode = false } = req.body || {};

  // --- Input validation (system boundary) ---
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

  // Normalize the query (Unicode NFKC + strip invisible/control characters —
  // see safety/inputGuard.js) before it's used anywhere: prompt construction,
  // the injection heuristic, or persistence. A query that normalizes down to
  // nothing (e.g. it was only invisible characters) is treated the same as
  // an empty query.
  const normalizedQuery = normalizeQuery(query.trim());
  if (normalizedQuery.length === 0) {
    return res.status(400).json({ error: 'A non-empty "query" string is required.', requestId });
  }

  try {
    // ---- Classroom Mode: start the planner NOW, alongside the answer -------
    //
    // Issued before the answer call rather than after it, so the two overlap
    // and the planner's latency is hidden entirely behind the (much longer)
    // coaching call. Awaited only once the answer is in hand.
    //
    // `classroomMode === true` is an exact check, not truthiness: this decides
    // whether to spend a model call, so a stray "false" string or a 1 must not
    // buy one. The server flag is checked here too — a client sending
    // classroomMode after the feature has been switched off gets it ignored,
    // which is the whole point of the server being the real kill switch.
    const classroomRequested = classroomMode === true && classroomModeFlagsAtBoot.enabled;
    const classroomPlanPromise = classroomRequested
      ? isWithinClassroomRollout(req.user, classroomModeFlagsAtBoot).then((allowed) =>
          allowed
            ? planClassroom({
                // `geminiFast`, NOT the coaching `gemini`. The planner is a
                // small classification call returning a fixed JSON shape —
                // structurally identical to the AI Action Router's intent
                // classification, which is what geminiFast was built for
                // (flash-lite, short timeouts, maxContinuations: 0).
                //
                // Three things follow from this, all of them wanted:
                //   - it is much cheaper per call than the coaching model;
                //   - it is faster, which matters for a call whose entire job
                //     is to finish before the answer does;
                //   - it draws on a DIFFERENT model's quota, so planning can
                //     never starve the coaching answer of rate limit — the
                //     answer is the thing the teacher is actually waiting for.
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
    // planClassroom already swallows its own failures; this is belt-and-braces
    // so that an unexpected throw in the rollout lookup can never surface as an
    // unhandled rejection while the answer call is still in flight.
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

    // `metrics` is metadata-only observability — it must NOT be spread into
    // the client response (kept internal). Pull it out before building the
    // client payload.
    const { metrics, ...clientResult } = result;

    // Metadata-only structured log for every AI request: call counts,
    // retries, continuations, latency, outcome. No prompt/response text.
    logAiEvent('info', 'coach_completed', { requestId, ...metrics });

    // Persist the query for history + analytics. A failure here must not break
    // the response the teacher is waiting for.
    let queryId = null;
    try {
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
        },
      });
      queryId = saved.id;
    } catch (persistError) {
      logAiEvent('error', 'query_persist_failed', { requestId, message: persistError.message });
    }

    // Best-effort, non-blocking prompt-injection telemetry: never blocks the
    // response, and never logs/stores the raw query or response text — only
    // a category label plus IDs. See safety/inputGuard.js for why this is
    // advisory-only rather than a gate.
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

    // The answer is ready; collect whatever the planner decided. `null` — the
    // mode being off, a gate firing, no teachable topic, or any failure — omits
    // the key entirely rather than sending an empty object, so a client that
    // never uses this feature receives the response it has always received.
    const classroomPlan = await classroomPlanSettled;

    // Classroom Mode telemetry (P7). Best-effort and non-blocking, exactly like
    // the injection telemetry above: a failed write must never cost the teacher
    // their answer. METADATA ONLY — the artifact names and counts, never the
    // question, the topic, or any generated text.
    //
    // Written here rather than in the planner because this is the only place
    // that knows all three of: the mode was requested, the rollout gate
    // allowed it, and what the planner ultimately decided. `planned: 0` is the
    // interesting row — it is a teacher who turned the mode on and got
    // nothing, which is the signal that the planner's gates are too tight.
    if (classroomRequested) {
      // Persist the plan on the Query row so reopening this chat can restore
      // the artifact cards (D24). Done as an UPDATE after the fact rather than
      // as part of the create above, deliberately: the plan settles later than
      // the answer, and folding it in would make every ORDINARY question wait
      // on a promise it has no interest in. Mode off is one write, exactly as
      // before — §7 rule 3.
      //
      // Best-effort. A failure here costs the teacher nothing they can see
      // right now; the cards for this turn are already on screen. It only
      // means reopening the chat later will not restore them.
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
      ...(classroomPlan ? { classroom: classroomPlan } : {}),
      // Distinguishes "the mode was on and found nothing to make" from "the
      // mode was off". Only the first should show the teacher an explanation;
      // without this the client cannot tell them apart, because both are the
      // absence of `classroom`.
      ...(classroomRequested ? { classroomMode: true } : {}),
    });
  } catch (error) {
    // Metadata-only failure log, including the reliability metrics the service
    // attaches to the error (call counts, whether we timed out / were rate
    // limited, etc.). Never the prompt, response, or upstream error body.
    logAiEvent('error', 'coach_request_failed', {
      requestId,
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.metrics || {}),
    });

    // Record NOTABLE reliability incidents durably (best-effort, non-blocking)
    // — not routine failures. Rare enough not to bloat the Event table, useful
    // for spotting upstream outages / rate-limit storms after the fact.
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

    // Safety blocks: Gemini's own filters blocked the input or generated
    // output — an expected, occasional outcome, not a system failure.
    if (error.code === 'INPUT_BLOCKED' || error.code === 'OUTPUT_BLOCKED') {
      return res.status(422).json({
        error: "This question couldn't be processed — try rephrasing it.",
        code: 'SAFETY_BLOCKED',
        requestId,
      });
    }
    // Overall time budget exhausted (retries + continuations took too long).
    if (error.code === 'DEADLINE_EXCEEDED') {
      return res.status(504).json({ error: 'The request took too long. Please try again.', code: 'TIMEOUT', requestId });
    }
    // Per-call timeout that ultimately failed (no overall-deadline error).
    if (error.name === 'TimeoutError' || error.name === 'AbortError' || String(error.message).includes('timeout')) {
      return res.status(504).json({ error: 'The request timed out. Please try again.', code: 'TIMEOUT', requestId });
    }
    if (error.status === 429) {
      return res.status(429).json({ error: 'The service is busy. Please try again shortly.', code: 'RATE_LIMITED', requestId });
    }
    if (error.status === 401 || error.status === 403) {
      // Do not leak configuration details to the client.
      return res.status(502).json({ error: 'Upstream authentication error. Please contact the administrator.', code: 'UPSTREAM_AUTH', requestId });
    }
    // Everything else (upstream 5xx exhausted, network failure, budget
    // exhaustion, malformed response) → generic upstream failure. Status 502
    // preserved for backward compatibility; `code` distinguishes the cause.
    return res.status(502).json({ error: 'Failed to generate a response. Please try again.', code: 'UPSTREAM_UNAVAILABLE', requestId });
  }
});

// Teacher history + feedback, saved resources (My Library), and admin
// analytics/management.
app.use('/api', dataRouter);
// M9. Mounted on the path AHEAD of the resources router rather than inside it,
// so routes/resources.js — protected area 1, the generation contract — is not
// opened a second time. Order matters: this must precede the router it guards.
// Everything else on /api/resources is untouched; only the generate path is
// matched here.
app.use('/api/resources/generate', generateLimiter);
app.use('/api', resourcesRouter);
app.use('/api/admin', adminRouter);
// Admin Support Inbox (Phase 2). No dedicated rate limiter, matching every
// other /api/admin/* route — this isn't a public-facing endpoint the way
// /api/coach is, and authRequired + requireRole('super_admin') already gate
// every route in this router.
app.use('/api/admin/support', adminSupportRouter);
// Admin Settings > Feature Management — same "no dedicated rate limiter"
// reasoning as adminSupportRouter above.
app.use('/api/admin/feature-flags', adminSettingsRouter);

// AI Action Router. Mounted alongside the existing routers — after them, before
// the global error handler — so no existing route's middleware chain changes.
// Its own paths are new, so nothing here can shadow an established endpoint.
// With ASSISTANT_ENABLED unset (the default) every response is an inert empty
// catalog, and the application behaves exactly as it did before this line.
app.use('/api/assistant', assistantLimiter, assistantRouter);

// Multimodal attachments. Mounted the same way M9 scoped generateLimiter:
// the limiter binds to the exact path ahead of the router that serves it, so
// nothing else under attachmentsRouter (there is only the one route today)
// is affected, and no existing router's mount changes.
app.use('/api/coach/attachment', attachmentLimiter);
app.use('/api', attachmentsRouter);

// The GET serving route inside avatarRouter is deliberately NOT behind this
// limiter — app.use('/api/auth/me/avatar', ...) only matches that exact path
// prefix, so it applies to the POST/DELETE upload/remove paths only, leaving
// the cache-friendly, read-only GET /users/:id/avatar unlimited.
app.use('/api/auth/me/avatar', avatarLimiter);
app.use('/api', avatarRouter);

// Help & Support. Same mounting shape as the attachment limiter above: bound
// to the exact path ahead of the router that serves it, so nothing else on
// /api is affected. With HELP_SUPPORT_ENABLED unset (the default) the route
// returns 503 and the application otherwise behaves exactly as it did before
// this line.
app.use('/api/support/tickets', supportLimiter);
app.use('/api', supportRouter);

// AI Learning Representation System (ADR Phase D). Same mounting shape as
// the attachment/generate limiters above: bound to the exact path ahead of
// the router that serves it, so nothing else on /api is affected. With
// LEARNING_REPRESENTATION_ENABLED unset (the default) the route returns its
// inert `{representation: 'verbal_explanation', data: null}` response and
// the application otherwise behaves exactly as it did before this line.
app.use('/api/coach/learning-representation', learningRepresentationLimiter);
app.use('/api', learningRepresentationRouter);

// Notification System. Unlike every other limiter-then-router pair above,
// GET (list, unread-count) and POST (send) share the exact same
// /api/notifications path — app.use() matches by path only, not method, so
// a plain prefix-mount would put the frequent, cheap, self-scoped GETs
// behind the same tight bucket meant for the rare, mutating-for-OTHERS send
// route. This scopes the limiter to POST only. With NOTIFICATIONS_ENABLED
// unset (the default) every route still 503s and the application otherwise
// behaves exactly as it did before this line. req.app.locals.socketServer
// (set near app.listen below) is what routes/notifications.js reaches for
// to emit realtime events.
app.use('/api/notifications', (req, res, next) => {
  if (req.method !== 'POST') return next();
  return notificationsSendLimiter(req, res, next);
});
app.use('/api', notificationsRouter);

// Classroom Management. Its own routes already start with "/classroom/..."
// (see routes/classroom.js), so — same mounting shape as
// generateLimiter/attachmentLimiter/supportLimiter above — the limiter binds
// to that exact path prefix ahead of the router, and the router itself
// mounts at the general "/api" (mounting it at "/api/classroom" would double
// the prefix to "/api/classroom/classroom/..."). With
// CLASSROOM_MANAGEMENT_ENABLED unset (the default) every /api/classroom/*
// route returns 503 and the application otherwise behaves exactly as it did
// before this line.
app.use('/api/classroom', classroomLimiter);
app.use('/api', classroomRouter);

// Global error handler — last line of defense. Routes wrapped in
// asyncHandler (see lib/asyncHandler.js) forward a rejected promise here via
// next(err) instead of letting it become an unhandled rejection, which on
// Node 18+ would otherwise crash the whole process (this is what turned a
// single Prisma P2021 "table does not exist" error into a full outage).
// Must be registered after all routers. Never echoes the raw error
// message/stack to the client — only status/path/method/error identity are
// logged server-side.
app.use((err, req, res, _next) => {
  // A body that is not valid JSON is a CLIENT error, and body-parser already
  // says so — it throws a SyntaxError carrying status 400, which this handler
  // used to flatten into a 500. Two things were wrong with that, both found by
  // the M9 security review rather than by a user report:
  //
  //   1. G22. POST /api/assistant/interpret may NEVER return a 5xx, and this
  //      was the one path that could. The client treats any 5xx as "the
  //      endpoint is unhealthy" and opens its circuit breaker, so a single
  //      malformed request disabled routing for a minute.
  //
  //   2. G11. Node's JSON parser puts a ~20-character WINDOW OF THE RAW BODY
  //      into its message ("Unexpected token 'Z', ...\"terance\": ZZPROBEBOD\"...
  //      is not valid JSON"), and this handler logged that message verbatim.
  //      On this endpoint the raw body is the teacher's utterance. A probe
  //      string was watched into the log; it is not hypothetical.
  //
  // So the branch answers 400 and logs the SHAPE of the failure, never its
  // content. Applies to every endpoint, which is the point: the leak was never
  // specific to the assistant.
  //
  // This response also needs to actually reach the browser: cors() is
  // registered ABOVE, before the JSON body-parser that throws this error, so
  // its Access-Control-Allow-Origin header is already attached to `res` by
  // the time we get here. Without that ordering, a malformed body from a
  // legitimate allowed origin would still get this clean 400 on the wire, but
  // the browser would discard it as a CORS violation and the caller would see
  // a generic "Failed to fetch" instead — see cors() registration above for
  // the full explanation.
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

// ---- Notification System: Socket.IO --------------------------------------
//
// Wired unconditionally (not just under require.main === module below) so
// req.app.locals.socketServer is always populated for anything that holds
// this `app` — including a test file that wraps it in its own
// http.createServer for a realtime test. It requires an http.Server to
// attach to either way, so this alone does not open a listening port; only
// httpServer.listen(...) below does that, and only when this file is run
// directly.
const http = require('http');
const httpServer = http.createServer(app);
app.locals.socketServer = initSocketServer(httpServer, {
  isOriginAllowed,
  // Read live on every handshake, not captured once here — same "the env
  // var is the real, immediately-effective kill switch" contract every
  // other feature flag in this app has (see lib/flags.js).
  isEnabled: () => readNotificationsFlags(process.env).enabled,
});

// ---- Start -----------------------------------------------------------------

// Only bind a real port when this file is run directly (`node src/index.js`,
// which is what `npm start`/`npm run dev` do). When the test suite requires
// this module to get `app` for Supertest, we don't want a real listening
// socket — Supertest drives the app in-process instead.
/* istanbul ignore next -- exercised via `npm start`, not the test suite */
if (require.main === module) {
  // httpServer (not app.listen) — the Socket.IO instance above is already
  // attached to it, so this one listen() call brings up both the REST API
  // and realtime notifications on the same port.
  httpServer.listen(PORT, () => {
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
