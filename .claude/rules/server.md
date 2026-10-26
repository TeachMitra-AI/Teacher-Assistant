---
paths:
  - "server/**"
---

# Server (Express 4, CommonJS, Prisma → SQLite)

Follow the real call path: route (`server/src/routes/*.js`) → middleware
(`src/middleware/auth.js`) → lib/service (`src/lib/`, `src/assistant/`, …) → Prisma
(`src/lib/db.js`). Read the nearest existing route before adding one, and copy its shape.

## Every new or changed endpoint

- Wrap async handlers in `asyncHandler` (`src/lib/asyncHandler.js`). The global error
  handler at the end of `src/index.js` is the only place that answers 500, and it never
  echoes `err.message` to the client.
- Authenticate with `authRequired`. It re-reads the account status on every request and
  fails closed with 503. Do not use `optionalAuth`: it skips the status check and is
  currently unused.
- Gate admin routes with `requireRole(...)` **after** `authRequired`. Scope admin reads and
  writes by school/district with `schoolScope(req.user)`, as `src/routes/admin.js` does.
- Validate the body with a Zod schema and use only `parsed.data` afterwards. Prefer
  `.strict()` for new schemas. Never pass `req.body` to Prisma.
- Owner-scope user data. Look it up with the owner in the query (`findOwned(id, userId)`
  in `src/routes/resources.js`), or load it and compare the owner. Missing and not-yours
  both return **404**.
- Rate-limit new, expensive, or abusable paths. Most limiters are mounted in `src/index.js`
  before the router (`app.use('/api/<path>', limiter)`). `/api/coach` takes its limiter
  inline, `src/lib/limiters.js` builds the generate limiter, and `src/routes/auth.js` adds a
  per-email failure limiter. Body limits are 16 kB by default
  and 64 kB only for the paths listed there; don't raise the global limit.
- Read configuration through `parseIntEnv` (`src/lib/config.js`) and feature flags through
  `src/lib/flags.js`. Document any new variable in `server/.env.example` with an obviously
  fake value.

## Errors and logging

- Map Gemini failures with `sendAiError` (`src/lib/sendAiError.js`). Don't hand-roll upstream
  error text.
- Log event names, ids, status codes, and shapes. Never log a teacher's query, utterance,
  resource content, email, phone, password, token, or attachment bytes.

## Data and migrations

See `.claude/rules/prisma.md`. No raw SQL: there is currently no `$queryRaw` or
`$executeRaw` anywhere in `server/src`. Adding one requires the user's approval and
parameterized tagged-template form only.

## AI code

Anything that builds a Gemini request also falls under `.claude/rules/ai-prompts.md`.

## Gate

From `server/`: `npx prisma generate` → `npm run lint` → `npm test`.
