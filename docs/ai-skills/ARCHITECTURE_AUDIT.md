# SarasTech architecture audit (for the AI skills & rules system)

**Date:** 2026-10-26 · **Branch audited:** `feature/homepage-faq-categories` @ `68c31d4`
**Method:** direct reading of source, config, and CI, targeted greps, and the three workspace
gates run locally (results in `FINAL_VERIFICATION_REPORT.md` §6; the `VALIDATION_REPORT.md`
cited earlier was never written). Every claim below cites a file.
Nothing was inferred from the reference archives.

## 1. Product and repository shape

SarasTech (`client/index.html`: "AI Teaching Assistant for Teachers in India",
`sarastech.co.in`) is an AI coaching and resource-generation tool for Indian
government-school teachers. The repo has three independent npm workspaces and **no root
`package.json`**:

| Workspace | Stack | Size (tracked) | Gate (= CI, `.github/workflows/ci.yml`) |
| --- | --- | --- | --- |
| `server/` | Node ≥18 (CI 20), Express 4, CommonJS, Prisma 6 → SQLite, Zod 4, Socket.IO 4 | ~20k LOC src/prisma/tools; 100 test files | `npx prisma generate` → `npm run lint` → `npm test` |
| `client/` | React 18, TypeScript, Vite 5, react-router 6, KaTeX | 78 test files | `npm run lint` → `npm test` → `npm run build` (tsc -b + vite + prerender) |
| `mobile/` | Expo 57, React Native 0.86, TypeScript | 70 test suites | `npm run lint` → `npm run typecheck` → `npm test` (Jest) |

Root `src/`, `test/`, and `archive/` are leftovers (`CLAUDE.md` §1). `docs/` holds about
50 design, plan, and audit documents.

## 2. Backend

**Wiring** (`server/src/index.js`): `dotenv`, then boot guards (exit if `GEMINI_API_KEY` is
missing; exit if `NODE_ENV=production` and `CORS_ORIGINS` is empty), then `trust proxy = 1`
(one Railway hop), `helmet()`, `cors()` (allowlist in production, any origin reflected
otherwise, `credentials: true`), then `express.json` (16 kB default, 64 kB for
`/api/resources*` and classroom-artifacts), then per-feature `express-rate-limit`
limiters mounted before each router, then the routers. A global error handler comes last
and returns 400 for malformed JSON and a generic 500 otherwise, logging shape only.

**Routers** (`server/src/routes/`, 16 files): auth, queries, admin, resources, assistant,
attachments, avatar, support, adminSupport, adminSettings, notifications, classroom,
teacherAttendance, scheduleDemo, adminScheduleDemo, learningRepresentation. `POST /api/coach`
is defined inline in `index.js`.

**Call path:** route → `middleware/auth.js` (`authRequired`, `requireRole`) → lib or
service (`src/lib/*`, `src/assistant/*`, `src/learningRepresentation/*`,
`src/attachments/*`) → Prisma (`src/lib/db.js`). Async handlers are wrapped in
`src/lib/asyncHandler.js`.

**Validation:** Zod `safeParse` in 13 of 16 routers. The other three take no free-form body
or validate in a lib: `adminScheduleDemo` (GET-only with whitelisted query params),
`attachments` and `avatar` (multer + `src/lib/fileValidation.js` magic-byte checks).
`.strict()` is used in some schemas, not all. Zod's default *strips* unknown keys, and
no route passes `req.body` to Prisma (grep for `data: req.body` / `...req.body`: 0 hits),
so non-strict schemas are not a mass-assignment hole. `/api/coach` validates by hand
(type checks, length caps, whitelist of four `context` keys).

**Data access:** 26 Prisma models (School, User, Session, Query, Conversation, Message,
Resource, Notification, DeviceToken, SchoolClass, Student, AttendanceRecord, FeeRecord,
TeacherAttendance, DemoBooking, …). 25 migrations. **No raw SQL** (`$queryRaw` and
`$executeRaw`: 0 hits). Local DB files (`prisma/dev.db`, `dev-RAJEEV.db`, `*.backup*`) are
git-ignored (`server/.gitignore`). `npm start` runs `prisma migrate deploy && node src/index.js`,
so starting the server migrates the target database.

**Ownership and scope:** resources use `findOwned(id, userId)`. Every by-id
`findUnique({ where: { id: req.params.id } })` (11 sites) is followed by an owner, school, or
token check. Users get 404 for not-yours. Admin routes return 403 for out-of-scope targets
(see RCC-008).

## 3. Authentication, sessions, authorization

- **Credentials** (`routes/auth.js`): email + password hashed with bcrypt (cost 10), with a
  timing-equalising dummy compare for unknown emails, `failedLoginCount`/`lockedUntil`
  lockout, a per-email failure limiter, forgot/reset password, and Google sign-in
  (`/api/auth/google`, `src/lib/googleAuth.js`). There is **no PIN** login. The previous
  `CLAUDE.md` wording was stale (fixed, RCC-005).
- **Tokens** (`middleware/auth.js`): HS256 pinned on verify. Access JWT TTL defaults to 15 min.
  `JWT_SECRET` must be ≥32 chars and not the placeholder, or boot fails. Refresh tokens are
  32 random bytes, stored as SHA-256 in `Session`, rotating, revocable, with a 7-day TTL.
- **Per-request status check:** `authRequired` re-reads `status` and `statusChangedAt`, so a
  suspension takes effect immediately, and it fails **closed** (503) if the DB can't be read.
- **Web transport:** refresh token in the HttpOnly cookie `sarastech_refresh`, path
  `/api/auth`, SameSite Lax by default, Secure in production. The client sends
  `X-Session-Transport: cookie` (`client/src/api.ts`).
- **Mobile transport:** `expo-secure-store` (`mobile/src/api/session.ts`).
- **RBAC:** `requireRole` in admin, adminSettings, adminSupport, adminScheduleDemo,
  notifications (send), and teacherAttendance (admin). School and district scoping through
  `schoolScope(req.user)` in `routes/admin.js`.
- **Realtime** (`src/lib/socketServer.js`): token in the handshake, status re-checked,
  sockets disconnected on suspension (`admin.js:363`). `statusChangedAt` is not
  compared (RCC-007).
- `optionalAuth` is exported but unused, and would skip the status check if adopted.

## 4. AI integration (Gemini)

- `server/src/gemini.js` is the only caller, using a key pool (`src/lib/geminiKeyPool.js`)
  with daily reset and auth cooldown. Timeouts, retries, call caps, continuations, and
  output-token caps are all bounded by `parseIntEnv` defaults (`index.js:104-250`).
  Separate budgets apply for the assistant router, attachments, and learning
  representations (`createBudgetCounter`).
- **Prompt structure:** trusted framing goes in `systemInstruction`, and teacher text,
  resource content, attachments, and prior turns go in delimited `contents`
  (`prompts.js`, `gemini.js:134-146`, `describeAttachment.js`, `classroomPlan.js`,
  `lessonPlanPrompt.js`, `routes/resources.js` builders). **Exception:** free-text
  `grade`, `subject`, and `classroomType` values are interpolated into `systemInstruction`
  (RCC-001).
- **Output handling:** `responseSchema` JSON mode for structured features, re-validated with
  Zod and re-checked server-side (`assistant/proposalSchema.js`: "The responseSchema
  constraint is only a hint"). `sanitizeOutput` (`safety/outputGuard.js`) leak-checks
  against the system instruction. `safety/inputGuard.js` normalizes queries (NFKC, strips
  invisible characters) and flags likely injection for telemetry only.
- Evals (`server/evals/`): `eval` hits the live API, and `eval:replay` uses cassettes.

## 5. Frontend and mobile

- **XSS boundary:** the only HTML sink is `dangerouslySetInnerHTML={{ __html: formatResponse(...) }}`
  (8 sites). `client/src/lib/format.ts` escapes `& < > " '` first, then emits a fixed tag
  set. `lib/math.ts` un-escapes only the math source, passes it to `katex.renderToString`
  with default options (`trust: false`), and KaTeX escapes its output.
- No secrets in `VITE_*` or `EXPO_PUBLIC_*` (grep). The client talks only to the server.

## 6. CI/CD, supply chain, tooling

- CI (`ci.yml`): a gitleaks job scanning new commits only (documented reason: pre-existing
  history leaks, see `docs/git-history-secret-purge.md`), plus server, client, and mobile
  lint/test jobs. **No dependency-vulnerability gate** (RCC-003) and no validation of the
  AI guidance (RCC-010).
- Local `.githooks/pre-commit` runs gitleaks on staged files. It is opt-in and fails open
  when gitleaks is absent.
- `npm audit --omit=dev` (2026-10-26): server 1 critical, 9 high, 4 moderate, 1 low; client
  2 moderate, 1 low; mobile 1 critical, 12 high, 6 moderate, 1 low (RCC-002).
- Deploys: Railway (backend) and Vercel (frontend), per `README.md` "Deployment".

## 7. Existing AI instructions before this work

- `CLAUDE.md` (95 lines): project map, principles, security invariants, git safety. Mostly
  accurate. Stale on auth (PINs).
- `mobile/AGENTS.md` (3 lines, Expo 57 docs pointer) and `mobile/CLAUDE.md` (`@AGENTS.md`).
- No `.cursor/`, no project `.claude/settings.json`, no rules, no skills. `.agents/` was empty.
- `.claude/settings.local.json` (git-ignored, user-local) holds 320 accumulated allow
  rules. Twelve are wildcard grants: `Bash(git push *)`, `Bash(git merge *)`,
  `Bash(git commit *)`, `Bash(git checkout *)`, `Bash(git stash *)`, `Bash(npx prisma *)`,
  `Bash(npm install *)`, `Bash(curl *)`, `Bash(node *)`, `Bash(python3 *)`, `Bash(cd *)`, and
  `PowerShell(Remove-Item *)`. Four entries embed literal bearer JWTs, and several embed
  demo credentials inside saved curl commands (RCC-004).
  **Re-checked during final verification (2026-10-26, file modified 11:40):** 285 allow rules,
  2 deny rules. The only wildcard left is `Bash(cd *)`. No entry contains a bearer JWT. The
  remaining credential-like entries are localhost curl calls that use the public seed demo
  password from `server/src/seed.js`, plus obviously fake wrong-password probes. The user
  remediated RCC-004 outside this work.

## 8. Constraints the guidance must respect

- SQLite only. No Postgres migration unless asked (`CLAUDE.md` §4, user memory).
- Three separate workspaces with different module systems: CommonJS (server) and ESM/TSX
  (client, mobile).
- `mobile/AGENTS.md` overrides root guidance for `mobile/`.
- No commit, push, or PR without an explicit request. Conventional Commits on feature
  branches (`CLAUDE.md` §5).
- Gates must be run and reported, not skipped (`CLAUDE.md` §2). This conflicts with the
  reference skills' "do not run tests" stance. `CLAUDE.md` wins.
