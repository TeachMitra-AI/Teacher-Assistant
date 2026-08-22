# Security test plan — manual audit, fixes, and OWASP ZAP / Nuclei dynamic scanning

**Status legend:** `Pending` · `In progress` · `Completed` · `Deferred (user action required)`

## 1. Purpose & scope

Harden Teacher-Assistant against real security bugs before shipping, using two passes:

1. **Manual/static audit** (this session) — read the server code directly, focused on auth, RBAC/multi-tenant isolation, injection, uploads, SSRF, and secrets. Fix confirmed issues in the codebase.
2. **Dynamic scanning** (follow-up) — run [OWASP ZAP](https://github.com/zaproxy/zaproxy) and [Nuclei](https://github.com/projectdiscovery/nuclei) against the running local dev instance to catch runtime issues static reading can't (live header behavior, active injection confirmation, spidering for forgotten routes).

**In scope:** `client` SPA (`localhost:5173`) and `server` API (`localhost:3000`), local dev only, seeded demo data only.
**Out of scope:** `mobile/` Expo app, any staging/production URL, third-party services the server calls (Gemini API, Google Sign-In) — never scan third-party infrastructure. Never point ZAP/Nuclei at a deployed environment without separate, explicit authorization.

## 2. Manual audit findings & fix status

Audited by reading `server/src/middleware/auth.js`, `server/src/routes/*.js`, `server/prisma/schema.prisma`, `server/src/seed.js`, and git history — not just a tool scan.

| # | Finding | Severity | Impact | Status |
|---|---|---|---|---|
| 1 | Leaked Gemini API keys in git history (`QUICK-FIX.md`, `archive/test-api.html`, old `config.js` — gone from `HEAD`, still in ~11 historical commits) | Critical | Anyone who ever cloned the repo can recover 3 working API keys via `git log --all -p \| grep AIza`, causing quota abuse/cost | **Deferred (user action required)** — see §2.1 |
| 2 | IDOR: `Query` rows with `userId = null` bypass ownership checks in `server/src/routes/queries.js` (5 spots) | Medium-High | Any authenticated user, any school, could read/edit/delete a null-owner query and its Classroom Mode artifacts | **Completed** — guard flipped from `query.userId && query.userId !== req.user.id` to `!query.userId \|\| query.userId !== req.user.id` (and the `!row \|\| ...` variant) at lines 74, 112, 132, 167, 206, so a null owner is now always denied instead of always allowed |
| 3 | `server/src/seed.js` has no production guard; hardcodes `demo1234` for a `super_admin` account | Medium | Running `npm run seed` against prod by mistake creates a publicly-known-password super-admin login | **Completed** — `main()` now exits with `FATAL` before any DB call if `NODE_ENV === 'production'` |
| 4 | `JWT_SECRET` strength/placeholder not validated at startup (`server/src/middleware/auth.js`) | Low | Deploying with the `.env.example` placeholder secret lets an attacker forge tokens for any user/role | **Completed** — startup now also exits `FATAL` if the secret is under 32 chars or equals the `.env.example` placeholder string |
| 5 | JWT algorithm not explicitly pinned on sign/verify (`server/src/middleware/auth.js`) | Low | Not currently exploitable; defense-in-depth against a future library/refactor change | **Completed** — added `JWT_ALGORITHM = 'HS256'`, passed as `algorithm` to `jwt.sign` and `algorithms: [JWT_ALGORITHM]` to `jwt.verify`. Confirmed via grep this is the only place JWTs are signed/verified in the codebase (refresh tokens are opaque CSPRNG strings, not JWTs) |

**Checked and cleared** (no fix needed): refresh-token rotation + reuse detection, password hashing (bcrypt cost 10) and reset-token handling, login rate-limiting/lockout, Google Sign-In audience verification, CORS (fails closed in prod, no wildcard+credentials issue), `helmet` + security headers, body-size limits, error handler (no stack-trace leaks), SQL/command injection (Prisma-only, no raw queries, no `eval`/`exec`), file uploads (memory-only storage, magic-byte content sniffing, no path traversal possible), SSRF (no user-supplied-URL fetch surface exists), and RBAC/tenant scoping across `admin.js`, `classroom.js`, `resources.js`, `notifications.js`, `adminSettings.js`, `adminSupport.js` (all server-derive scope from the JWT, never trust body/query for authorization decisions). Noted but not fixed: rate limiting is per-process/in-memory (fine for single-instance dev, a real gap only for multi-instance prod — infra decision, not a code fix); `lucide-react@^1.25.0` in `client/package.json` is worth a manual `npm outdated` glance but isn't a confirmed vulnerability.

### 2.1 Finding #1 — required manual steps (not run automatically)

This was already caught in an earlier pass — `docs/git-history-secret-purge.md` has a full ready-to-run runbook, and `docs/enterprise-engineering-audit.md` flags it as top priority. It is **not** re-run automatically here because it's destructive to shared git history (every commit SHA changes, every existing clone/fork diverges) and force-pushes to `origin` — that must be your own deliberate action.

1. Rotate all 3 Gemini API keys in Google AI Studio now (assume already scraped — rotation is what actually neutralizes them, independent of any history cleanup).
2. When ready, run the runbook at `docs/git-history-secret-purge.md` yourself, or ask Claude to run one specific step at a time.

## 3. Dynamic scanning plan (OWASP ZAP + Nuclei) — follow-up phase

Run after the static-audit fixes above are in, to validate the fixes and catch anything a code-reading pass can't (live behavior, forgotten/undocumented routes, header misconfig).

### 3.1 Setup (neither tool is installed yet)
- ZAP: `brew install --cask owasp-zap`, or `docker pull zaproxy/zap-stable` (app isn't dockerized, but ZAP itself can run in Docker and reach the host via `host.docker.internal`).
- Nuclei: `brew install nuclei`, then `nuclei -update-templates`.
- Bring the app up locally: `cd server && npm install && cp .env.example .env` (fill `JWT_SECRET`, `GEMINI_API_KEY`), `npx prisma migrate dev && npx prisma generate && npm run seed`, `npm run dev` (port 3000, confirm via `curl localhost:3000/api/health`). Separately `cd client && npm install && cp .env.example .env && npm run dev` (port 5173).

### 3.2 Target inventory (no OpenAPI spec exists)
Enumerate routes from `server/src/routes/*.js` and their mount points in `server/src/index.js` (~lines 616–1025) to build a minimal OpenAPI doc or a HAR file (captured via ZAP's Manual Explore while clicking through the SPA with ZAP as proxy). This becomes the seed target list for both tools.

### 3.3 Authenticated identities
Use `npm run seed` demo accounts (`demo1234` — see finding #3 above; only ever use this for local scanning, never prod) to get one JWT per role (Teacher, School Admin, Resource Person, Super Admin), across ≥2 different `schoolId`s, for authz cross-testing.

### 3.4 ZAP plan
- Ajax Spider (headless Chrome, since the client is a React SPA) against `:5173`; traditional spider against `:3000/api`.
- Authenticated Context per role using the JWTs from §3.3.
- Active scan (SQLi/XSS/header checks/etc.) per role against the target inventory.
- **Authz-specific**: for every endpoint, cross-test with a lower-privilege role's token and a same-role-different-`schoolId` token, hunting IDOR/BOLA/privilege escalation — same class of bug as finding #2 above, now checked live instead of by reading code.
- Output: HTML + JSON report per run (git-ignored, may contain sensitive data), summarized findings copied back into this doc.

### 3.5 Nuclei plan
- Baseline: built-in templates (`exposures`, `misconfig`, `exposed-panels`, `tech`, `default-logins`) against `:3000` and `:5173`.
- Custom templates: a handful of YAML templates hitting sensitive endpoints (admin routes, cross-`schoolId` fetches, attachment/avatar paths) with a low-priv token, asserting expected 403 vs. actual — a scripted authz regression check that could later run in CI.
- Output: JSON export per run, summarized here.

### 3.6 Reporting & next steps
Findings get triaged (true/false positive, severity, owner, fix) using the same table format as §2. Future work (not this pass): wire a ZAP baseline + the custom Nuclei templates into `.github/workflows/ci.yml` alongside the existing Gitleaks job, once this manual pass's findings are fully resolved.

## 4. Change log
- 2026-08-22: Doc created; manual audit completed. Findings #2–#5 fixed in `server/src/routes/queries.js`, `server/src/seed.js`, `server/src/middleware/auth.js`. Full server test suite (`npm test`, 84 files / 2145 tests, including `test/routes/queries.test.js` and `test/auth.test.js`) passes with no regressions. Finding #1 (leaked keys in git history) remains deferred — requires your manual key rotation + optional history purge per §2.1.
- Test-coverage note: no existing test specifically exercises a `Query` row with `userId = null` reaching these routes (the bug case for finding #2), so the fix is verified by code review + full suite passing, not by a dedicated regression test. Worth adding one if this route sees future changes.
