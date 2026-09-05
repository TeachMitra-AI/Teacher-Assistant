# Error Handling Audit

## Audit Scope

- **Client:** `client/`
- **Backend:** `server/`
- **Audit date:** 2026-09-05
- **Overall current health score:** 7/10

This document is the living source of truth for tracking remediation of the
findings below. It is derived from a full read-only, code-level audit of both
workspaces (no code was modified as part of producing this document or the
audit itself).

## Status Legend

- 🔴 **OPEN** — identified but not fixed
- 🟡 **IN PROGRESS** — currently being fixed
- 🟢 **FIXED** — implemented and verified
- ⚪ **DEFERRED** — intentionally postponed

At the time this document was created, **all findings are 🔴 OPEN** — no
fixes have been implemented yet.

---

## Findings

### #1

- **Severity:** 🔴 Critical
- **Area:** Backend
- **File(s):** `server/src/routes/resources.js` (lines 870, 904, 997, 1004, 1206, 1259, 1379, 1520, 1603)
- **Function/route:** All 9 routes — `GET/POST /resources`, `GET/PATCH/DELETE /resources/:id`, `POST /resources/:id/ai-action`, `POST /resources/generate`, `/generate-set`, `/generate-lesson-plan`
- **Problem:** None of these handlers use `asyncHandler` (0 occurrences in the file), and the file's existing `try/catch` blocks only wrap narrow best-effort sub-operations (e.g. notification/telemetry writes), not the main Prisma calls.
- **Current behavior:** A rejected promise from a Prisma call (`findMany`, `create`, `update`, `delete`) becomes an unhandled promise rejection instead of reaching the global error middleware.
- **User impact:** An unhandled rejection can crash the whole Node process on Node 18+ by default. A code comment in `index.js` (~line 1114) documents that exactly this failure mode once turned a single Prisma P2021 error into a full outage. These are the busiest, most business-critical routes in the app (My Library CRUD, quiz/worksheet/lesson-plan generation) — a transient DB hiccup here can take the app down for every user, not just the requester.
- **Recommended fix:** Wrap every handler in the existing `asyncHandler` utility (already used everywhere else in the codebase) — a mechanical, one-line-per-route fix.
- **Status:** 🟢 FIXED (2026-09-05)
- **Implementation:** All 9 routes in `server/src/routes/resources.js` (`GET /resources`, `POST /resources`, `GET /resources/:id`, `PATCH /resources/:id`, `POST /resources/:id/ai-action`, `POST /resources/generate`, `POST /resources/generate-set`, `POST /resources/generate-lesson-plan`, `DELETE /resources/:id`) now wrap their handler in the existing `asyncHandler` from `server/src/lib/asyncHandler.js`, matching the pattern already used in every other route file (`auth.js`, `admin.js`, `attachments.js`, `teacherAttendance.js`, etc.). No new error-handling mechanism was introduced — this reuses the existing utility. No business logic, validation, ownership checks, status codes, or response bodies were changed; the diff is purely `async (req, res) => { ... }` → `asyncHandler(async (req, res) => { ... })` per route, plus the one new `require('../lib/asyncHandler')` import.
- **Verification:**
  - `grep`/`node -c` confirmed no remaining bare (unwrapped) async route handlers in the file, no merge-conflict markers, and valid JS syntax.
  - `git diff` reviewed line-by-line — confirmed the change is mechanical (wrap only), no logic/status-code/message changes.
  - `npm run lint` (server) — passed clean, no errors or warnings.
  - `npm test` (server, full suite) — **2375/2376 passed**. The 1 failing test (`resources.test.js` › "creates exactly one lesson_generated notification...") was reproduced as failing identically on the unmodified code (verified via `git stash`), confirming it is a pre-existing test-isolation flake unrelated to this change.
  - Manual verification (temporary, throwaway test file, deleted after use): mocked `prisma.resource.findMany` and `prisma.resource.delete` to reject, then called `GET /api/resources` and `DELETE /api/resources/:id`. Both requests were caught by the existing global error middleware (`server/src/index.js`), which logged only `{method, path, message, code}` (no stack, no leaked error text) and returned a controlled `500` response — confirming the rejection is now forwarded to `next(err)` instead of becoming an unhandled promise rejection.
  - `npx prisma generate` could not be re-run cleanly in this environment (`EPERM` renaming the Windows query-engine DLL, likely held open by another running process) — this is a local file-lock issue unrelated to the code change; the schema was not touched, and the already-generated Prisma client (present in `node_modules/.prisma/client`) was used for all test runs above.
- **Not yet run:** `client/` and `mobile/` gates — out of scope, no client/mobile files were touched.

---

### #2

- **Severity:** 🔴 Critical
- **Area:** Backend
- **File(s):** `server/src/routes/queries.js` (lines 11, 67, 105, 126, 153, 165, 201)
- **Function/route:** All 7 routes — `GET /queries`, `POST /feedback`, `GET/PUT /queries/:id/classroom-artifacts`, `DELETE /queries`, `DELETE /queries/:id`, `PATCH /queries/:id`
- **Problem:** Same root cause as #1 — `asyncHandler` is used 0 times in this file.
- **Current behavior:** Same as #1: unhandled promise rejections instead of controlled error responses.
- **User impact:** Same crash risk as #1. `GET /queries` (chat history) and `DELETE /queries` (uses `prisma.$transaction`) are hit on essentially every session.
- **Recommended fix:** Wrap every handler in `asyncHandler`, identical to #1.
- **Status:** 🟢 FIXED (2026-09-05)
- **Implementation:** All 7 routes in `server/src/routes/queries.js` (`GET /queries`, `POST /feedback`, `GET /queries/:id/classroom-artifacts`, `PUT /queries/:id/classroom-artifacts`, `DELETE /queries`, `DELETE /queries/:id`, `PATCH /queries/:id`) now wrap their handler in the existing `asyncHandler` from `server/src/lib/asyncHandler.js`, matching #1 and every other route file. No new error-handling mechanism was introduced. No business logic, validation, ownership checks, status codes, or response bodies were changed — the diff is purely `async (req, res) => { ... }` → `asyncHandler(async (req, res) => { ... })` per route, plus the one new `require('../lib/asyncHandler')` import.
- **Verification:**
  - `grep`/`node -c` confirmed all 7 routes wrapped, no remaining bare async handlers, no merge-conflict markers, valid JS syntax.
  - `git diff` reviewed line-by-line — confirmed the change is mechanical (wrap only).
  - **Local live-server verification (mandatory, performed this fix):** Started the real backend via its normal entrypoint (`node src/index.js`, the same file `npm start`/`npm run dev` run) as a separate throwaway instance on an alternate port, against a throwaway copy of the dev SQLite DB, so the developer's already-running dev server (a pre-existing process on port 3000, not started by this session) was never touched. Confirmed the server started successfully (`/api/health` returned 200) and exercised all 7 affected endpoints end-to-end with a real minted JWT and a real seeded `Query` row: `GET /queries`, `POST /feedback`, `GET`/`PUT /queries/:id/classroom-artifacts`, `PATCH /queries/:id`, `DELETE /queries/:id`, `DELETE /queries` all returned their expected normal success responses (200/201) with unchanged bodies.
  - **Controlled failure test:** Loaded a temporary, throwaway `--require` fault-injection module (deleted after use) that made the *first* call to `prisma.query.findMany` reject with a simulated error, then let subsequent calls behave normally. `GET /queries` (request 1) returned a controlled `500 {"error":"Something went wrong. Please try again."}` — no stack trace, no raw error text, no internal details in the response body. The server's own log recorded only `{method, path, message, code}` server-side (the simulated message, but no stack) — consistent with the existing global error middleware's established, non-leaking logging behavior. `GET /queries` (request 2, immediately after) returned a normal `200 {"queries":[]}`, and `/api/health` continued responding — confirming the process survived the rejection and kept serving requests instead of crashing.
  - All temporary files (fault-injection module, token-minting script, throwaway DB copies, ad hoc curl output) were deleted after verification; no debugging code or console logs were left in `queries.js` or any production file.
  - `npm run lint` (server) — passed clean, no errors or warnings.
  - `npm test` (server, full suite) — **2375/2376 passed**. The 1 failing test is the same pre-existing `resources.test.js` notification-count flake already confirmed unrelated to `asyncHandler` changes when Finding #1 was fixed (reproduces identically against unmodified code); it is unrelated to `queries.js`.
  - `npx prisma generate` again hit the same pre-existing environment-level `EPERM` (the developer's own already-running dev server on port 3000 holds the Windows Prisma query-engine DLL open) — unrelated to this change; no schema was touched, and the already-generated Prisma client was used successfully for every test/verification run above.
- **Not yet run:** `client/` and `mobile/` gates — out of scope, no client/mobile files were touched.

---

### #3

- **Severity:** 🟠 High
- **Area:** Backend
- **File(s):** `server/src/index.js:979-1012`, `server/src/routes/resources.js:765-782`, `server/src/routes/attachments.js:127-144`
- **Function/route:** `/coach` (inline), `sendAiError` (resources.js), `sendAiError` (attachments.js)
- **Problem:** Gemini/AI error-mapping logic is duplicated three times with no shared source of truth. The three copies have already drifted: different fallback messages/codes (`'Failed to generate a response.'` vs `'Failed to generate content.'` vs `'Failed to process the attachment.'`), and `index.js` has a 401/403→502 "upstream auth" branch the other two lack. `attachments.js` itself contains a comment acknowledging the duplication.
- **Current behavior:** Each of the three call sites maps Gemini failures to HTTP responses independently.
- **User impact:** A future fix to one Gemini failure mode is easy to apply to only one or two of the three copies, silently reintroducing inconsistent user-facing behavior for the same underlying failure across different features (coach chat, resource generation, attachments).
- **Recommended fix:** Consolidate into one shared `lib/sendAiError.js` (or equivalent) used by all three call sites.
- **Status:** 🟢 FIXED (2026-09-05)
- **New shared utility:** `server/src/lib/sendAiError.js` — exports `sendAiError(res, error, requestId, messages)`. `messages` is an explicit per-caller object (`safetyBlockedMessage`, `deadlineExceededMessage`, `timeoutMessage`, `upstreamUnavailableMessage`) so each caller's existing user-facing wording is passed in rather than hardcoded, while the mapping logic itself (which `error.code`/`error.status`/`error.name` maps to which HTTP status/response `code`) now lives in exactly one place.
- **Files migrated:** `server/src/index.js` (`/coach` handler's catch block), `server/src/routes/resources.js` (`sendAiError`, used by the ai-action/generate/generate-set/generate-lesson-plan routes), `server/src/routes/attachments.js` (`sendAiError`, used by `/coach/attachment`) — all three now call the shared function instead of maintaining their own copy.
- **Behavior comparison (before consolidating), verified line-by-line:**
  | Case | index.js (/coach) | resources.js | attachments.js |
  |---|---|---|---|
  | INPUT_BLOCKED/OUTPUT_BLOCKED | 422 SAFETY_BLOCKED, "This question couldn't be processed — try rephrasing it." | 422 SAFETY_BLOCKED, "This couldn't be processed — try adjusting your request." | 422 SAFETY_BLOCKED, "This couldn't be processed — try rephrasing your question." |
  | DEADLINE_EXCEEDED | 504 TIMEOUT, "The request took too long. Please try again." | 504 TIMEOUT, same message as TimeoutError/AbortError below | 504 TIMEOUT, same message as TimeoutError/AbortError below |
  | TimeoutError/AbortError name | 504 TIMEOUT, **different** message: "The request timed out. Please try again." | 504 TIMEOUT, same message as DEADLINE_EXCEEDED | 504 TIMEOUT, same message as DEADLINE_EXCEEDED |
  | message contains "timeout" (no matching name) | ✅ caught (extra fallback check) | ❌ not checked — fell through to generic 502 | ❌ not checked — fell through to generic 502 |
  | status 429 | 429 RATE_LIMITED (+ `retryAt` if present) | identical | identical |
  | status 401/403 | ✅ 502 UPSTREAM_AUTH, "Upstream authentication error. Please contact the administrator." | ❌ **missing** — fell through to generic 502 UPSTREAM_UNAVAILABLE | ❌ **missing** — fell through to generic 502 UPSTREAM_UNAVAILABLE |
  | default/malformed | 502 UPSTREAM_UNAVAILABLE, "Failed to generate a response. Please try again." | 502 UPSTREAM_UNAVAILABLE, "Failed to generate content. Please try again." | 502 UPSTREAM_UNAVAILABLE, "Failed to process the attachment. Please try again." |
- **Reconciliation decisions (documented per the task's instructions, nothing silently changed):**
  1. **Every existing user-facing message was preserved exactly**, for all three callers, for every case that previously worked — passed into the shared function via the `messages` argument rather than hardcoded, so `resources.js` and `attachments.js` keep producing byte-identical text to before for INPUT_BLOCKED/OUTPUT_BLOCKED, DEADLINE_EXCEEDED/TimeoutError/AbortError, 429, and the generic fallback.
  2. **The `TimeoutError`/`AbortError`/message-includes-"timeout" fallback check** (previously only in `index.js`) is now applied for all three callers, since it is strictly more complete Gemini-timeout detection and could only ever reclassify a request that would otherwise have fallen through to the generic 502 UPSTREAM_UNAVAILABLE — no case that previously matched a specific branch changes branch.
  3. **The 401/403 → 502 `UPSTREAM_AUTH` branch** (previously only in `index.js`) is now applied for all three callers, per the task's explicit instruction to preserve/carry forward "the existing 401/403 → 502 handling in the implementation that has it." `resources.js` and `attachments.js` gain this protection (a genuine gap the audit flagged, not a message change) using `index.js`'s exact existing wording, since neither had any wording of their own to preserve for this case.
  4. **index.js's TIMEOUT-message split is preserved as-is**: `/coach` still passes two different strings for `deadlineExceededMessage` vs `timeoutMessage`, exactly reproducing its pre-existing two-message nuance. `resources.js` and `attachments.js` do not set `timeoutMessage`, so it defaults to their `deadlineExceededMessage` value — i.e. they keep using ONE message for both cases, exactly matching their pre-consolidation behavior (no new message split was introduced for them).
  5. **Unrelated logic in `index.js`'s catch block was left untouched**: the metadata-only `logAiEvent` call and the best-effort `Event` write for notable reliability incidents (rate-limit exhaustion, deadline exceeded) happen before the mapping and are `/coach`-specific instrumentation, not part of `sendAiError` — they are unchanged, only the final response-construction block was replaced with a call to the shared function.
- **Verification:**
  - Line-by-line comparison of all 3 old implementations (table above) performed before writing any code, per the task's instructions.
  - `grep`/`node -c` confirmed no remaining `function sendAiError` definitions anywhere except the new shared module, no merge-conflict markers, valid JS syntax in all 4 changed/added files.
  - Searched the whole `src/` tree for other Gemini-error-mapping duplicates: `assistant/classifier.js`, `learningRepresentation/classifier.js`, `learningRepresentation/rendering/renderer.js`, and `lib/geminiPolicy.js` all reference `INPUT_BLOCKED`/`OUTPUT_BLOCKED`, but for an unrelated purpose (internal classification into a string reason, or retry-policy decisions — never building an HTTP response) — correctly left untouched, out of scope for this finding.
  - `git diff` reviewed line-by-line for all 3 modified files — confirmed every existing message string survives unchanged, and the only behavioral additions are the two documented, sanctioned ones (items 2 and 3 above).
  - Existing test coverage run and passed: `test/coach.reliability.test.js` (9/9 — safety block, rate limit, exhausted-429 reliability event, persistent timeout, generic 5xx → UPSTREAM_UNAVAILABLE), `test/attachments.test.js`, and `test/resources.test.js` (only the pre-existing unrelated notification-count flake failed, see below).
  - Coverage gap identified: no existing test exercised the newly-shared 401/403 → UPSTREAM_AUTH branch for the `resources.js`/`attachments.js` callers specifically (it was previously untestable there since the branch didn't exist). Wrote a temporary, throwaway script (`_verify_sendAiError.js`, deleted after use) that called the shared mapper directly with a fake `res` for all 15 representative cases: INPUT_BLOCKED/OUTPUT_BLOCKED (both message variants), DEADLINE_EXCEEDED (both the coach two-message and the resources one-message form), TimeoutError name, AbortError name, message-includes-"timeout" fallback, 429 with and without `retryAt`, 401 and 403 → UPSTREAM_AUTH (specifically the two callers that previously lacked this), a generic 5xx, and a malformed-response error with no `status`/`code`. All 15 passed. Two additional checks confirmed a raw `error.details` payload (simulating gemini.js's upstream response body, seeded with a fake secret and fake prompt content) and a raw `error.message` containing an internal hostname never appear anywhere in the JSON response body — no stack traces, API keys, upstream bodies, or other internals are exposed to clients.
  - `npm run lint` (server) — passed clean, no errors or warnings.
  - `npm test` (server, full suite) — **2375/2376 passed**. The 1 failing test is the same pre-existing `resources.test.js` notification-count flake already confirmed unrelated to this codebase area (documented under Finding #1/#2's verification).
  - `npx prisma generate` again hit the same pre-existing environment-level `EPERM` (the developer's own already-running dev server holds the Windows Prisma query-engine DLL open) — unrelated to this change; no schema was touched, and the already-generated Prisma client was used successfully for every run above.
- **Not yet run:** `client/` and `mobile/` gates — out of scope, no client/mobile files were touched.

---

### #4

- **Severity:** 🟠 High
- **Area:** Backend
- **File(s):** `server/src/routes/auth.js`, `server/src/routes/notifications.js` (contrast: `server/src/routes/teacherAttendance.js:803, 830`)
- **Function/route:** Register / Google sign-up (auth.js), device-token upsert (notifications.js)
- **Problem:** Only `teacherAttendance.js` catches `err.code === 'P2002'` (Prisma unique constraint) and maps it to a clean 409. Other routes with a check-then-create race on a unique field (auth register/Google sign-up on `schoolId_email`/`googleSub`; notification device-token upsert on `token`) have no such handling.
- **Current behavior:** A concurrent duplicate insert falls through to the generic 500 "Something went wrong. Please try again."
- **User impact:** A benign, expected race condition is presented to the user as a generic server error instead of a clear "already exists" message.
- **Recommended fix:** Centralize a small Prisma-error-to-HTTP mapper (`P2002`→409, `P2025`→404) that routes call the way `teacherAttendance.js` already does inline, rather than duplicating the `if (err.code === 'P2002')` block per route.
- **Status:** 🟢 FIXED (2026-09-05)
- **New shared utility:** `server/src/lib/prismaErrors.js` — exports `isUniqueConstraintError(err)` and `isRecordNotFoundError(err)`, small named predicates for `err.code === 'P2002'`/`'P2025'`. Deliberately NOT a global middleware or a response-building helper (per the task's explicit instruction not to blindly add a global Prisma mapper): each call site keeps its own `try/catch` and its own tailored user-facing message/status, exactly like `teacherAttendance.js`'s existing pattern — this only replaces the repeated magic-string code checks with a named predicate. `teacherAttendance.js`'s own two existing `err.code === 'P2002'` checks were left untouched (already correct, out of scope for this finding, per "do not touch unrelated files").
- **Exact races closed:**
  1. **`server/src/routes/auth.js` `POST /register`** — `prisma.user.create` (check-then-create on the `@@unique([schoolId, email])` index). On `isUniqueConstraintError`, returns the same `409` + the same message already used for the non-race duplicate-email check (`EMAIL_ALREADY_REGISTERED`, extracted to a shared constant so both paths can never drift in wording).
  2. **`server/src/routes/auth.js` `POST /google` sign-up branch** — same race, same fix, same shared message. Note: `googleSub` has only an `@@index`, not `@@unique`, in `prisma/schema.prisma` — confirmed via inspection that a P2002 here can only ever come from the `schoolId_email` side, never from `googleSub` itself.
  3. **`server/src/routes/notifications.js` `POST /notifications/device-tokens`** — `prisma.deviceToken.upsert` is update-then-insert-on-miss, not atomic; two concurrent registrations of the identical token can both take the insert branch, and the loser hits P2002 on the unique `token` column. Fix: on `isUniqueConstraintError`, retry the upsert once (the row now exists, so the retry resolves via the update branch) — preserves the exact same `201 {id}` success response instead of surfacing an error for what is, from the caller's perspective, a successful idempotent registration.
  4. **`server/src/routes/notifications.js` `DELETE /notifications/device-tokens/:token`** — an additional, adjacent P2025 gap found during inspection (not named in the original audit prose, which only called out the upsert): a concurrent delete between the ownership check and the delete call throws P2025. Included in scope since it's the same file/feature and directly matches the task's explicit instruction to close "P2025 cases that currently need explicit handling." On `isRecordNotFoundError`, returns the same `404 "Device token not found."` already used for the check-based not-found case.
- **Preserved unchanged:** every existing successful response shape, every existing error message/status for the non-race cases, and `teacherAttendance.js`'s own inline P2002 handling.
- **Verification:**
  - Line-by-line inspection performed before coding: confirmed `googleSub` has no unique constraint (only an index), confirmed `deviceToken.upsert`'s update/create shape, confirmed `teacherAttendance.js`'s existing pattern (try/catch + inline `err.code === 'P2002'` + re-throw via `throw err` for anything else, reaching `asyncHandler`/the global error middleware).
  - 4 new regression tests added, one per race, using the project's real end-to-end HTTP test pattern:
    - `test/auth.test.js` — "a P2002 unique-constraint race on create() is still a 409, not a 500" (register).
    - `test/google-auth.test.js` — the same for the Google sign-up branch.
    - `test/deviceTokens.test.js` — "a P2002 unique-constraint race on the insert branch still succeeds (retries through to the update branch)" (asserts the retry actually happens — the mock is called exactly twice — and the final row reflects the caller's own data).
    - `test/deviceTokens.test.js` — "a P2025 record-not-found race on delete() is still a 404, not a 500".
  - **Testing-methodology finding, itself worth recording:** the first implementation of these tests used `vi.spyOn(prisma.user, 'create').mockRejectedValueOnce(...)` (the same technique used for Finding #1's one-off manual verification script). In the permanent suite this corrupted the shared Prisma client for the rest of the file — after `mockRestore()`, `prisma.user.create` became `undefined` ("prisma.user.create is not a function"), causing 5 unrelated downstream tests in the same file to fail with 500s. Root-caused via `git stash` (confirmed 0 failures on the unmodified baseline) and a minimal repro script. Fixed by switching to plain save/reassign/restore of the method (`const original = prisma.user.create; prisma.user.create = fakeImpl; try { ... } finally { prisma.user.create = original; }`) instead of `vi.spyOn`, which restores cleanly (verified with a standalone repro). All 4 new tests use this pattern. **Any future test that needs to simulate a Prisma error on this shared client should use this same plain-reassignment pattern, not `vi.spyOn`, on this codebase's Prisma Client version.**
  - Full targeted run: `test/auth.test.js`, `test/google-auth.test.js`, `test/deviceTokens.test.js`, `test/notifications.test.js`, `test/teacherAttendance.test.js` — **160/160 passed**, including all 4 new tests, with no downstream leakage.
  - Every new test asserts the response body does NOT contain the raw Prisma error text/code (`P2002`, `P2025`, "Unique constraint", "operation failed") — confirming no raw Prisma error/details/stack reaches the client.
  - `npm run lint` (server) — passed clean, no errors or warnings.
  - `npm test` (server, full suite) — **2379/2380 passed** (2376 → 2380: the 4 new tests, all passing). The 1 failing test is the same pre-existing `resources.test.js` notification-count flake already confirmed unrelated (documented under Finding #1's verification).
  - `npx prisma generate` again hit the same pre-existing environment-level `EPERM` (the developer's own already-running dev server holds the Windows Prisma query-engine DLL open) — unrelated to this change; no schema was touched, and the already-generated Prisma client was used successfully for every run above.
  - `git diff` reviewed line-by-line for `auth.js`, `notifications.js`, and all 3 test files — confirmed every change is either the new try/catch + shared predicate, or a message deduplicated into a constant with identical text; no conflict markers found anywhere in the changed files.
- **Not yet run:** `client/` and `mobile/` gates — out of scope, no client/mobile files were touched.

---

### #5

- **Severity:** 🟡 Medium
- **Area:** Client
- **File(s):** `client/src/api.ts`
- **Function/route:** `api<T>()` / `apiDownload()`
- **Problem:** When the backend returns a non-2xx response with no JSON body, or a body without an `error` string field, the client falls back to the literal string `` `Request failed (${res.status}).` ``.
- **Current behavior:** This raw, technically-phrased string is shown verbatim wherever the calling screen doesn't special-case it. There is no status-code → friendly-message mapping layer in the shared client (no generic 5xx or 429 fallback message).
- **User impact:** Teachers see messages like "Request failed (500)." or "Request failed (503)." instead of actionable, plain-language guidance. Every screen that wants better wording currently has to special-case `err.status`/`err.code` itself (some do — Coach/Generator handle `RATE_LIMITED` — most don't for 5xx/503).
- **Recommended fix:** Add a small status→message fallback map inside `api.ts` (used only when the backend didn't supply an `error` string), e.g. 429→"Too many requests, try again shortly", 502/503/504→"Temporarily unavailable, please try again", 500→"Something went wrong on our end."
- **Status:** 🟢 FIXED (2026-09-05)
- **New shared utility:** `client/src/lib/apiErrorMessages.ts` — exports a pure `fallbackErrorMessage(status: number): string`. Not placed directly inline in `api.ts` because `client/vitest.config.ts` deliberately scopes its `include` to `src/assistant/**`, `src/lib/**`, `src/pages/**`, `src/components/**` — a root-level `src/api.test.ts` would silently never run. Putting the mapping in `lib/` (the codebase's existing convention for pure-logic modules) keeps it testable without touching the test runner's scoping.
- **Files migrated:** `client/src/api.ts` — both fallback sites now call `fallbackErrorMessage(res.status)` instead of inlining the raw string: `apiDownload()`'s catch-all default, and `api<T>()`'s `!res.ok` branch (used only when `body.error` isn't a string, i.e. exactly the same condition as before).
- **Behavior:**
  - Backend already sends an `error` string (the normal case — confirmed server-side, every backend route uses a consistent `{error, code?}` shape) → **completely unchanged**, zero difference.
  - No body / no `error` string, status `429` → "Too many requests. Please wait a moment and try again."
  - No body / no `error` string, status `502`/`503`/`504` → "The service is temporarily unavailable. Please try again in a moment."
  - No body / no `error` string, status `500` → "Something went wrong on our end. Please try again."
  - No body / no `error` string, any other status → unchanged existing text (`` `Request failed (${status}).` ``) — intentionally left as-is, outside this finding's explicit 429/5xx scope.
  - None of the three new friendly messages contain the numeric status code (verified by a dedicated test) — no raw HTTP status text or technical detail is shown to the teacher.
- **Preserved unchanged:** every backend-provided `error` string (the overwhelming majority of responses), every existing `.status`/`.code`-based special case elsewhere in the client (`auth.tsx`'s pending/rejected/not-registered/unavailable branches, Coach/Generator's `RATE_LIMITED` handling, `ResourceView`/`AdminSupportTicketPage`'s 404-specific messages) — all match on `.status`/`.code` directly, never on this fallback's wording, confirmed by inspection before coding.
- **Verification:**
  - Searched the client for existing status→message helpers before writing new code — none existed; confirmed via `grep` that the raw `` `Request failed (${status}).` `` literal appeared in exactly the two call sites the audit named, and (after the fix) appears nowhere outside the one intentional line inside the new helper itself.
  - 5 new unit tests in `client/src/lib/apiErrorMessages.test.ts`: 429 wording, 502/503/504 share the same wording, 500 wording, an unmapped status (418, 400) keeps the exact pre-existing raw text, and none of the three friendly messages contain a digit.
  - `npx vitest run src/lib/apiErrorMessages.test.ts` — 5/5 passed.
  - `npm test` (client, full suite) — **723/723 passed**, no regressions.
  - `npm run lint` (client) — 0 errors (1 pre-existing, unrelated warning in `useClassroomQueue.ts`, untouched by this change).
  - `npm run build` (client's typecheck gate — `tsc -b && vite build`) — succeeded with no type errors.
  - `git diff` reviewed line-by-line for `api.ts` — confirmed the only change is swapping the inline string literal for a function call at the exact two sites named in the audit; no conflict markers found in any changed/new file.
- **Not yet run:** `server/` and `mobile/` gates — out of scope, no backend/mobile files were touched.

---

### #6

- **Severity:** 🟡 Medium
- **Area:** Client
- **File(s):** `client/src/pages/LibraryPage.tsx:133`, `client/src/pages/AdminPage.tsx:52`, `ClassroomPage.tsx`, `StudentRoster.tsx`, `ReportsPanel.tsx` (load paths)
- **Function/route:** Initial data-load effects on each page
- **Problem:** Initial data-load failures (network, 5xx, timeout) set an `error` state that renders as a plain, static error string with no retry affordance.
- **Current behavior:** The only way to retry today is to change a filter/search (which happens to re-trigger the effect) or reload the whole page. This is despite `usePagedList` already exposing `refetch`, and page-local `load` callbacks already existing on every affected page.
- **User impact:** Inconsistent with the app's otherwise strong "always give the user a way forward" pattern (seen in `CheckInTab`'s offline banner, `ReportsPanel`'s retry-able download). A teacher on a flaky connection has no obvious next action besides a full page reload.
- **Recommended fix:** Add a "Try again" button next to these error messages calling the existing `load`/`refetch` function.
- **Status:** 🟢 FIXED (2026-09-05)
- **Implementation:** Reused the codebase's existing "error banner + inline retry" idiom verbatim (`LearningRepresentationPanel`'s `.lr-error`/CheckInTab's `.attendance-queued-banner`) rather than inventing a new one: every affected error block changed from `<p className="auth-error">{error}</p>` to `<div className="auth-error" role="alert">{error}<button type="button" className="btn-text" onClick={load}>Try again</button></div>`. One small scoped CSS rule added (`.auth-error .btn-text { margin-left: auto; ... }`), mirroring the existing `.attendance-queued-banner .btn-text` rule — no new button style, reuses the global `.btn-text` class.
  - `LibraryPage.tsx`, `StudentRoster.tsx`, `ReportsPanel.tsx` — each already had a self-contained `load` (`useCallback`); the button calls it directly.
  - `ClassroomPage.tsx` / `ClassList.tsx` — the error UI lives in the child `ClassList` component, not the page that owns `load`. Added one new prop, `onRetry: () => void`, threaded from `ClassroomPage.tsx` (`onRetry={load}`) into `ClassList.tsx`'s button.
  - `AdminPage.tsx` — the only file with no reusable `load` (it fetched inline in a `useEffect` IIFE). Extracted a `load` `useCallback`, and — since this was the one page with an existing unmount-safety `cancelled` guard the other four don't have — preserved that exact protection via a `mountedRef` (set false on unmount in a cleanup effect, checked before every `setState`) rather than dropping it, so `load` remains safe to call from both the mount effect and the new Retry button.
- **Behavior confirmed for every affected view:** clicking Try again clears the error (`setError('')` inside the reused `load`), re-triggers the exact same fetch (no new/duplicate data-fetching path), restores the loading state via the same `finally` block already in each `load`, and the error node is unmounted (not just hidden) once loading starts — so a stale error can never remain visible alongside a later loading/success state. No case was found where a page could enter a state showing both the error and the success view simultaneously.
- **Accessibility:** `role="alert"` added to every converted error block (matching the pattern already used elsewhere — `ReportsTab`, `ActivityLogTab`, `LearningRepresentationPanel`); the retry control is a plain `<button type="button">`, natively focusable and activatable by keyboard (Tab + Enter/Space) with no custom keyboard handling needed.
- **Left unchanged (out of this finding's scope):** the existing error message text (per "keep the existing error messages unless there is a clear reason to improve them" — none were changed); the attendance module's `ReportsTab.tsx`/`ActivityLogTab.tsx`, which have the same static-error pattern but were not named in this finding and were left untouched to avoid scope creep; `usePagedList`'s `refetch` (mentioned in the finding's prose as available infrastructure) — `ManagePage`, the only current consumer, was not named as an affected file in this finding's file list, so it was not touched.
- **Verification:**
  - 6 new focused regression tests across 5 new test files (`LibraryPage.test.tsx` ×2, `AdminPage.test.tsx`, `ClassroomPage.test.tsx`, `StudentRoster.test.tsx`, `ReportsPanel.test.tsx`), each mocking the real API module the component calls (not a fake wrapper) and asserting: the error renders with `role="alert"`, clicking "Try again" re-invokes the load function exactly once more (`toHaveBeenCalledTimes(2)` — proving no duplicate request), the success view then renders, and `screen.queryByRole('alert')` is gone (proving the stale error doesn't linger). `LibraryPage.test.tsx` additionally covers a second consecutive failure after a retry, confirming the flow is fully repeatable, not a one-shot special case.
  - `npx vitest run` on each new test file individually — all passed before the full-suite run.
  - `npm test` (client, full suite) — **729/729 passed** (723 → 729: the 6 new tests, all green, zero regressions elsewhere).
  - `npm run lint` (client) — 0 errors (1 pre-existing, unrelated warning in `useClassroomQueue.ts`, untouched by this change).
  - `npm run build` (`tsc -b && vite build`) — succeeded with no type errors, including `ClassList.tsx`'s new required `onRetry` prop being satisfied at its one call site.
  - `grep` confirmed the raw `<p className="auth-error">{error}</p>` (no retry) pattern no longer appears in any of the 5 named files/components — every instance was converted.
  - `git diff` reviewed line-by-line for all 6 production files and the CSS — confirmed each change is exactly the button/prop addition described above, nothing else.
  - No merge-conflict markers found in any new or changed file.
- **Not yet run:** `server/` and `mobile/` gates — out of scope, no backend/mobile files were touched.
- **⚠️ Known issue found during manual runtime verification (2026-09-05), not caught by the automated test above:** `AdminPage.tsx`'s `mountedRef` never resets to `true`. Under React 18 `<StrictMode>` (this app wraps `<App />` in it — `client/src/main.tsx`), React intentionally mounts, cleans up, and remounts every effect once in development. The `mountedRef` cleanup (`() => { mountedRef.current = false; }`) fires during that synthetic teardown and is never set back to `true` on the synthetic remount (unlike the *original* pre-fix code, which declared `cancelled` fresh inside each effect invocation via a local closure variable — safe under double-invocation by construction). The result: in `npm run dev` specifically, `/admin` gets stuck on "Loading analytics…" forever, on every load, including completely ordinary successful ones with no injected fault — confirmed via `performance.getEntriesByType('resource')` showing both underlying network calls completing successfully while the UI never leaves the loading state. **Confirmed production-safe**: a real `vite build` + `vite preview` of the same code, same backend, shows AdminPage loading and retrying correctly (StrictMode's double-invoke is dev-only and is stripped from production builds) — so this does not affect real users, only local development via `npm run dev`. The automated `AdminPage.test.tsx` test does not catch this because React Testing Library's `render()` does not wrap in `StrictMode` by default. Left unfixed pending user direction (this verification pass was scoped to verification, not further implementation) — the fix is small: also set `mountedRef.current = true` inside the effect's setup function, not just at `useRef(true)` declaration, e.g. `useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, [])`.

---

### #7

- **Severity:** 🟡 Medium
- **Area:** Client
- **File(s):** `client/src/components/GraphChartView.tsx` and sibling Learning-Representation view components (`ProcessDiagramView`, `HierarchyTreeView`, `LabeledPartsView`, `TimelineView`, `ComparisonTableView`)
- **Function/route:** Structured AI-response renderers
- **Problem:** These components render Gemini-produced "Learning Representation" structured data directly (`data.series`, `data.chartType`, etc.) with no defensive shape-checking, relying entirely on the TypeScript type and server-side schema validation. The root `ErrorBoundary` in `App.tsx` is mounted once at the app root, with no per-message/per-card boundary around individual AI-rendered content blocks.
- **Current behavior:** If a malformed/unexpected shape ever slips through validation, the component throws during render, and the single app-root `ErrorBoundary` catches it.
- **User impact:** A single bad card crashes the **entire app** to the full-page "Something went wrong / Reload" screen, not just that one card — blast radius is much larger than the underlying failure, wiping the in-progress conversation view (though history is safely persisted server-side).
- **Recommended fix:** Wrap message-level content renderers (the dynamic view dispatch in the message/response card) in a lightweight local `ErrorBoundary` instance so one bad card degrades to "Could not display this content" instead of taking down the page. Reuses the existing `ErrorBoundary` component with a smaller fallback.
- **Status:** 🟢 FIXED (2026-09-05)
- **Implementation:** Reused the existing `client/src/components/ErrorBoundary.tsx` exactly as the recommended fix specified — no new component. Added two optional, fully backward-compatible props: `fallback?: ReactNode` (defaults to the existing full-page `CrashFallback` when omitted, so `App.tsx`'s root usage — `<ErrorBoundary>{children}</ErrorBoundary>`, no props — is byte-for-byte unaffected) and `resetKey?: unknown` (a `componentDidUpdate` check clears a caught error when this changes by reference, so an old card's error can never permanently block a later, valid one). `componentDidCatch`'s existing metadata-only logging (`error.message` only, never the error object/stack) was left untouched.
- **Card wrapped:** `client/src/components/LearningRepresentationPanel.tsx` — the actual "card" (one instance per Coach turn) — now wraps its `<LearningRepresentationDisplay representation={...} data={...} />` call (the "dynamic view dispatch" the finding names) in `<ErrorBoundary fallback={<p className="lr-note">Could not display this content.</p>} resetKey={state.data}>`. This protects all 6 sibling view components (`GraphChartView`, `ProcessDiagramView`, `HierarchyTreeView`, `LabeledPartsView`, `TimelineView`, `ComparisonTableView`) through the one shared dispatcher, exactly as the recommended fix described — no per-view-component changes were needed or made.
- **Fallback behavior:** A malformed payload now renders `<p className="lr-note">Could not display this content.</p>` — reusing the existing `.lr-note` CSS class already used for this panel's "no visual for this answer" case, so no new CSS was added. The fallback receives no information about the actual error (the caller passes a static node), so there is no code path by which a raw Gemini error, stack trace, or JSON payload could reach it.
- **Isolation confirmed:** Since each Coach turn already gets its own independent `LearningRepresentationPanel` component instance (React's normal list-keying), a crash inside one turn's card is contained by that turn's own `ErrorBoundary` — a sibling turn's panel is a structurally separate React subtree and is never affected, verified directly by a two-cards-side-by-side test (see below).
- **Verification:**
  - 8 new regression tests across 2 new files:
    - `ErrorBoundary.test.tsx` (5 tests) — unit tests of the boundary's own generic contract: (1) with no `fallback` prop, the existing full-page `CrashFallback` still renders unchanged; (2) a custom `fallback` renders instead, with the raw error text never appearing; (3) `componentDidCatch` logs only `error.message` as a plain string; (4) a sibling boundary elsewhere on the page is unaffected by one that caught an error; (5) changing `resetKey` after a caught error clears it and lets new, valid children render — while confirming an *unchanged* `resetKey` on a still-throwing re-render does NOT incorrectly reset (i.e. it isn't reset on every re-render, only on an actual identity change).
    - `LearningRepresentationPanel.test.tsx` (3 tests) — integration tests against the real call site, using a realistic malformed payload (a `graph_chart` response missing `series` entirely — the exact shape `GraphChartView`'s unguarded `mergeSeries()` throws on, not a synthetic/simulated error): (1) the malformed card shows the safe fallback without crashing, and the rendered page contains no stack trace or leaked payload fields; (2) a malformed card and a valid sibling card (a different, recharts-free `labeled_diagram` view, to avoid an unrelated jsdom/recharts `ResizeObserver` testing limitation — see file comment) rendered side by side: the bad one shows the fallback, the good one renders its real content, and the page-level "Something went wrong" screen never appears; (3) the logged diagnostic is a short string with no stack-frame markers or payload field names.
  - `npx vitest run` on each new test file individually — all 8 passed before the full-suite run.
  - `npm test` (client, full suite) — **737/737 passed** (729 → 737: the 8 new tests, all green, zero regressions elsewhere).
  - `npm run lint` (client) — 0 errors (1 pre-existing, unrelated warning in `useClassroomQueue.ts`, untouched by this change).
  - `npm run build` (`tsc -b && vite build`) — succeeded with no type errors.
  - `git diff` reviewed line-by-line for both production files — confirmed the changes are exactly the two new optional props on `ErrorBoundary` and the one new wrapping `<ErrorBoundary>` call in `LearningRepresentationPanel.tsx`, nothing else touched.
  - No merge-conflict markers found in any new or changed file.
- **Left unchanged / out of scope:** the 6 individual view components (`GraphChartView.tsx` etc.) were not given internal defensive shape-checking — the fix operates at the dispatcher/card boundary as the finding's own recommended fix specified, not inside each renderer. `App.tsx`'s root `ErrorBoundary` usage is untouched. No backend/Gemini or mobile files were touched.
- **Not yet run:** `server/` and `mobile/` gates — out of scope, no backend/mobile files were touched.

---

### #8

- **Severity:** 🟡 Medium
- **Area:** Client
- **File(s):** `client/src/lib/attendanceOfflineQueue.ts:180-182`
- **Function/route:** `syncOne` / `attemptSync`
- **Problem:** When a queued offline attendance action fails to sync for a non-network reason (already checked in, outside geofence at sync time, validation error, etc.), the actual `ApiError.message` is discarded in favor of one hardcoded generic string.
- **Current behavior:** `permanentError` is always set to: "Could not sync this attendance action. It has not been lost — you can retry or discard it."
- **User impact:** No indication of *why* the sync failed permanently, so retrying is likely to fail again with no new information, and "discard" is offered with no context on what's being thrown away. Inconsistent with every other flow in the app (`CheckInTab`'s live-failure path, `CoachPage`, `GeneratorPage`, etc.), which surfaces the real `err.message`.
- **Recommended fix:** Store the actual `err.message` (when it's an `ApiError`) as the `permanentError` text instead of the hardcoded string, falling back to the generic text only for non-`ApiError` failures.
- **Status:** 🔴 OPEN

---

### #9

- **Severity:** 🟡 Medium
- **Area:** Backend
- **File(s):** `server/src/lib/systemSettings.js:115`
- **Function/route:** (warning log path on settings read/write failure)
- **Problem:** `console.warn(..., err)` logs the whole Prisma error object, including stack, instead of the `{message: err.message, code: err.code}` convention used consistently everywhere else in the codebase.
- **Current behavior:** Full error object written to server logs.
- **User impact:** Not client-facing (server log only), but inconsistent with the codebase's stated metadata-only logging discipline; on some log aggregators a full Prisma error can include failing SQL or file paths. Low actual risk today given SQLite + no external log shipping, but worth aligning for consistency and to avoid setting a bad precedent (see also the Gemini `err.details` watch item under Security Review).
- **Recommended fix:** Log only `{message: err.message, code: err.code}`, matching the rest of the codebase.
- **Status:** 🔴 OPEN

---

### #10

- **Severity:** 🟢 Low
- **Area:** Backend
- **File(s):** `server/src/lib/limiters.js`, `server/src/index.js`
- **Function/route:** Rate-limiter 429 response bodies
- **Problem:** Rate-limiter responses return `{error: string}` only, with no `code` field — inconsistent with every other error response in the codebase, which carries a `code` for machine-readable disambiguation (`SAFETY_BLOCKED`, `RATE_LIMITED`, `UPSTREAM_UNAVAILABLE`, etc.).
- **Current behavior:** Client cannot distinguish "rate limited by our own limiter" from a generic 429 the same way it can for Gemini-side rate limits (which do carry `code: RATE_LIMITED`).
- **User impact:** Minor — the client can still show a reasonable generic message, but loses the ability to give limiter-specific guidance (e.g. a retry countdown) the way it does for Gemini rate limits.
- **Recommended fix:** Add a `code` (e.g. `RATE_LIMITED`) to the limiter's 429 response body for consistency with the rest of the error contract.
- **Status:** 🔴 OPEN

---

## Recommended Fix Order

1. **#1–2** — Add `asyncHandler` to `resources.js` and `queries.js`. Highest risk-reduction per line changed; do first.
2. **#4** — Centralize Prisma error-code mapping (P2002/P2025), while already touching related route files.
3. **#3** — Consolidate the three Gemini error-mapping copies into one shared utility.
4. **#5–6** — Client `api.ts` status→message fallback map, plus retry buttons on load-failure screens. Same shared-infra shape, good to batch.
5. **#7** — Per-card error boundary for AI Learning-Representation renderers. Isolated, low-risk addition.
6. **#8–10** — Cleanup/consistency pass: offline-queue error message, `systemSettings.js` logging, rate-limiter `code` field. No urgency.

---

## Repeated Patterns to Centralize

- ~~**Gemini error mapping** — currently duplicated 3× (`index.js`, `resources.js`, `attachments.js`) and already drifting. Should become one shared `sendAiError` utility.~~ **Done (2026-09-05, #3)** — consolidated into `server/src/lib/sendAiError.js`, used by all three callers with per-caller message overrides.
- **Prisma error-code mapping** — implemented only once (`teacherAttendance.js`); should become a shared mapper other routes call as they're touched. (See #4.)
- **Client status-code → friendly-message fallback** — belongs once in `api.ts`, not re-implemented per page. (See #5.)
- **Shared inline error + retry UI** — the "icon + message + optional retry button" JSX is currently hand-rolled per page; a small shared `<InlineError message retry />` component would remove this duplication. (See #6.)

**Explicitly not a centralization priority:** the client-side pattern
`err instanceof ApiError ? err.message : fallback`, repeated 30+ times across
`CoachPage`, `GeneratorPage`, `ResourceWorkspace`, `LibraryPage`,
`ClassroomPage`, `ManagePage`, `SettingsPage`, `HelpSupport`, `StudentRoster`,
`ReportsPanel`, and several hooks. This is a deliberate, consistent one-line
idiom, not accidental duplication — extracting it into a helper would save
little and isn't clearly worth the churn unless a future change wants to add
the shared status-code mapping from #5, at which point centralizing becomes
more worthwhile.

---

## Already Well-Handled Areas

- **Authentication** — Login, register, Google sign-in, forgot/reset password, session restore, and silent token refresh all have carefully considered, non-leaking, teacher-readable handling for every edge case (pending account, rejected account, wrong password, existing email, Google-not-registered, expired reset link).
- **Gemini integration** (`server/src/gemini.js`) — the most sophisticated error handling in the codebase: distinguishes network failure vs. timeout vs. rate limit vs. auth vs. safety-block vs. malformed response, each with its own code, bounded retry/backoff/key-rotation logic, and clean metrics attached to the thrown error.
- **Coach chat / Generator / classroom artifact queue** — per-turn/per-card failure isolation, correct loading-state reset in every `finally`, rate-limit-specific UX via `code: RATE_LIMITED` + `retryAt` flowing cleanly from server → `useRetryCountdown`.
- **Attendance + offline queue** — the single most thorough flow in the client: distinguishes geolocation-permission-denied vs. timeout vs. generic, distinguishes network failure (queued) from real rejection (shown + re-synced), never silently drops evidence (aside from the message-discarding gap noted in #8).
- **Ownership scoping** — resources, queries, classroom, attendance, and notifications all correctly return 404 for both "missing" and "not yours," verified as actually implemented, not just documented.
- **Global backend error middleware** (`server/src/index.js:1119-1162`) — never echoes `err.message`/stack to clients; has a specific hardening fix already in place for a prior body-parser leak; logs only `{method, path, message, code}`.

---

## Security Review

The audit found **no confirmed instances** of:

- Stack trace leaks into HTTP responses or client-visible logs.
- Secrets/API key leaks (JWT secret and Gemini API key are read only from `process.env` and never interpolated into logs, errors, or responses).
- JWT/token leaks (Google ID-token verification failures log only `error.name`, with an explicit comment that a credential never belongs in a log).
- Raw Prisma error text exposed in any `res.json(...)` anywhere in `server/src`.
- Other sensitive error exposure (email addresses are redacted to domain-only before logging).

**Watch item (not yet a leak):** `server/src/gemini.js:262` attaches the raw
upstream Gemini error response body to `err.details`. Nothing currently reads
this field — the `sendAiError` mappers and `logAiEvent`/`console.error` calls
that log Gemini failures only reference `status`, `code`, `message`, and
`metrics`. It is dead data on the error object today, not an active leak, but
it is a landmine: a future "just log the whole error object for debugging"
change (the same class of mistake already made in #9) would start exporting
raw upstream response bodies — which can echo request content — straight into
logs. Worth keeping in mind when touching `gemini.js` or its callers.

---

## Progress Tracking

| ID | Severity | Area | Status | Notes |
|----|----------|------|--------|-------|
| #1 | 🔴 Critical | Backend | 🟢 FIXED | 2026-09-05 — asyncHandler added to all 9 routes in resources.js; verified via lint/full test suite/manual error-middleware check |
| #2 | 🔴 Critical | Backend | 🟢 FIXED | 2026-09-05 — asyncHandler added to all 7 routes in queries.js; verified via live-server local run, controlled fault-injection test, lint, and full test suite |
| #3 | 🟠 High | Backend | 🟢 FIXED | 2026-09-05 — Gemini error mapping consolidated into server/src/lib/sendAiError.js, used by index.js/resources.js/attachments.js; verified via existing test suite + temporary direct-mapper script (15 cases) |
| #4 | 🟠 High | Backend | 🟢 FIXED | 2026-09-05 — new lib/prismaErrors.js predicates used in auth.js (register + Google sign-up) and notifications.js (device-token upsert + delete); 4 new regression tests, 160/160 targeted tests pass |
| #5 | 🟡 Medium | Client | 🟢 FIXED | 2026-09-05 — new lib/apiErrorMessages.ts used by both fallback sites in api.ts; 5 new tests, full client suite 723/723 pass, lint/build clean |
| #6 | 🟡 Medium | Client | 🟢 FIXED ⚠️ | 2026-09-05 — "Try again" retry button added to LibraryPage, AdminPage, ClassroomPage/ClassList, StudentRoster, ReportsPanel; 6 new tests, full client suite 729/729 pass, lint/build clean. Manual verification (2026-09-05) found AdminPage's `mountedRef` stalls loading forever under `npm run dev` (React StrictMode double-invoke) — confirmed production-safe, dev-only, unfixed pending direction; see finding writeup |
| #7 | 🟡 Medium | Client | 🟢 FIXED | 2026-09-05 — ErrorBoundary extended with fallback/resetKey props; LearningRepresentationPanel wraps its view dispatch to isolate one bad card; 8 new tests, full client suite 737/737 pass |
| #8 | 🟡 Medium | Client | 🔴 OPEN | |
| #9 | 🟡 Medium | Backend | 🔴 OPEN | |
| #10 | 🟢 Low | Backend | 🔴 OPEN | |

---

## Change Log

| Date | Finding | Change | Verification |
|------|---------|--------|---------------|
| 2026-09-05 | — | Audit completed; no fixes implemented | Audit only |
| 2026-09-05 | #1 | Wrapped all 9 `server/src/routes/resources.js` route handlers in the existing `asyncHandler` utility so rejected promises reach the centralized error middleware instead of becoming unhandled rejections. No logic/status/message changes. | `npm run lint` clean; `npm test` 2375/2376 passed (1 pre-existing unrelated flake, reproduced on unmodified code); manual mocked-rejection check confirmed the global error middleware now catches and safely handles failures on these routes |
| 2026-09-05 | #2 | Wrapped all 7 `server/src/routes/queries.js` route handlers in the existing `asyncHandler` utility, identical pattern to #1. No logic/status/message changes. | Live throwaway server instance started via the normal entrypoint, all 7 endpoints exercised end-to-end with real success responses; controlled fault-injection test forced a Prisma rejection and confirmed a safe 500 response (no leaked internals), server-side-only logging, and the server serving a normal request immediately afterward; `npm run lint` clean; `npm test` 2375/2376 passed (same pre-existing unrelated flake as #1) |
| 2026-09-05 | #3 | Created `server/src/lib/sendAiError.js`, consolidating the 3 duplicated/drifting Gemini error mappers in `index.js`, `resources.js`, and `attachments.js` into one function. Preserved every existing per-caller message exactly (passed in via a `messages` argument); deliberately extended the `TimeoutError`/`AbortError`/message-includes-"timeout" fallback and the 401/403→502 UPSTREAM_AUTH branch (previously index.js-only) to all three callers, per explicit task instruction — the only two sanctioned behavior additions, both documented in Finding #3. | `test/coach.reliability.test.js` (9/9), `test/attachments.test.js`, `test/resources.test.js` all passed (same pre-existing unrelated flake as #1/#2); temporary throwaway script exercised the shared mapper directly across 15 cases (all safety/timeout/rate-limit/auth/generic branches for all 3 callers' message sets, plus 2 no-leak checks) — all passed, then deleted; `npm run lint` clean; no remaining duplicate `sendAiError` definitions or conflict markers found |
| 2026-09-05 | #4 | Created `server/src/lib/prismaErrors.js` (`isUniqueConstraintError`, `isRecordNotFoundError`). Applied in `auth.js` (`POST /register` and `POST /google` sign-up, both on `prisma.user.create`'s P2002 race — same 409 message as the existing non-race check, deduplicated into a shared constant) and `notifications.js` (`POST /notifications/device-tokens`'s P2002 race on `upsert`, resolved by a single retry; `DELETE /notifications/device-tokens/:token`'s P2025 race on `delete`, resolved with the same 404 as the existing check). `teacherAttendance.js`'s existing inline P2002 handling left untouched, out of scope. | 4 new regression tests (1 per race) added across `test/auth.test.js`, `test/google-auth.test.js`, `test/deviceTokens.test.js` (×2); targeted run of all 5 affected test files 160/160 passed; `npm run lint` clean; `npm test` full suite 2379/2380 passed (same pre-existing unrelated flake, 4 new tests all green); no raw Prisma error text/code reaches any response body (asserted directly in each new test); no conflict markers |
| 2026-09-05 | #5 | Created `client/src/lib/apiErrorMessages.ts` (`fallbackErrorMessage`). Both fallback sites in `client/src/api.ts` (`api<T>()` and `apiDownload()`) now call it instead of inlining `` `Request failed (${status}).` `` — 429/502/503/504/500 get teacher-friendly wording with no digits; every other status keeps the exact old text; any backend-provided `error` string is completely unaffected. | 5 new unit tests in `apiErrorMessages.test.ts`, all passing; full client suite 723/723 passed; `npm run lint` 0 errors (1 pre-existing unrelated warning); `npm run build` (tsc -b + vite build) succeeded; no conflict markers |
| 2026-09-05 | #6 | Added a "Try again" retry button (reusing the existing `.lr-error`/`.attendance-queued-banner` error-banner-with-inline-button idiom, `role="alert"` + `.btn-text`) to `LibraryPage.tsx`, `AdminPage.tsx`, `ClassList.tsx` (via a new `onRetry` prop from `ClassroomPage.tsx`), `StudentRoster.tsx`, and `ReportsPanel.tsx`. Each button calls the exact existing `load` function for that view — no new data-fetching path. `AdminPage.tsx` additionally had its inline-IIFE fetch extracted into a reusable `load` callback, preserving its existing `cancelled`-flag unmount-safety via a `mountedRef`. One scoped CSS rule added for button placement. | 6 new regression tests across 5 new test files, each asserting the retry re-invokes the load function exactly once more (no duplicate request) and the stale error is gone after a successful retry; full client suite 729/729 passed (6 new, zero regressions); `npm run lint` 0 errors (1 pre-existing unrelated warning); `npm run build` succeeded; no conflict markers |
| 2026-09-05 | #7 | Extended the existing `ErrorBoundary` with two optional, backward-compatible props (`fallback`, `resetKey`) rather than creating a new component. `LearningRepresentationPanel.tsx` now wraps its `<LearningRepresentationDisplay>` call (the dispatcher for all 6 Learning-Representation view components) in a local `ErrorBoundary` with a small `.lr-note` fallback, isolating a malformed AI payload to that one card instead of crashing the whole app via the root boundary. | 8 new regression tests across 2 new files (`ErrorBoundary.test.tsx`, `LearningRepresentationPanel.test.tsx`), using a realistic malformed payload (missing `series`) that throws inside the real, unmodified `GraphChartView`; confirmed a sibling valid card keeps rendering, the page never crashes, resetKey correctly clears an old error for new data, and only a safe plain-string diagnostic is logged; full client suite 737/737 passed (8 new, zero regressions); `npm run lint` 0 errors (1 pre-existing unrelated warning); `npm run build` succeeded; no conflict markers |
| 2026-09-05 | #1–#7 | Manual runtime verification pass (no code changes) — see "Manual Verification — Findings #1–#7" report delivered to the user. Exercised real endpoints/UI end-to-end via an isolated throwaway backend (copied DB, alternate port), an isolated throwaway client dev server and production build, and real browser interaction; the user's own running dev servers were never touched. All findings behaved as documented, with one discovered issue. | #1–#5 and the isolation/no-leak parts of #7 fully passed live; #6 passed live for Library/Admin(prod)/Classroom/ClassList/StudentRoster/Reports; #4's Google-signup and device-token-race cases used labeled SIMULATED mocks (no real Google network call / no real concurrency) since those can't be safely reproduced manually. **Regression found:** `AdminPage.tsx`'s `mountedRef` never resets to `true` on React StrictMode's dev-only synthetic remount, permanently stalling "Loading analytics…" in `npm run dev` (confirmed dev-only; a production build of the same code loads and retries correctly) — documented as a caveat under Finding #6 above, left unfixed pending user direction. All temporary fault-injection scripts, throwaway DB/server/client instances, and log files were deleted after use; final `git status`/diff contains only the completed #1–#7 work and this documentation. |

---

### Maintenance instructions for future updates

Whenever an issue from this audit is fixed:

1. Change its status from 🔴 OPEN → 🟡 IN PROGRESS before/while implementing, if appropriate.
2. After the fix is actually implemented **and verified** (matching gate from `CLAUDE.md` §1 — lint/test/build as applicable), mark it 🟢 FIXED. Use ⚪ DEFERRED if a fix is intentionally postponed, with a reason.
3. Add implementation details and the verification result directly to that finding's entry above.
4. Update the row in the Progress Tracking table.
5. Add a row to the Change Log with the date, finding ID, what changed, and how it was verified.
6. Never mark a finding 🟢 FIXED merely because code was changed — tests/verification must actually pass.
