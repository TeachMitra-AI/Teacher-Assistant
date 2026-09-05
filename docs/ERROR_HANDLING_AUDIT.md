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
- **Status:** 🔴 OPEN

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
- **Status:** 🔴 OPEN

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
- **Status:** 🔴 OPEN

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
- **Status:** 🔴 OPEN

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
| #4 | 🟠 High | Backend | 🔴 OPEN | |
| #5 | 🟡 Medium | Client | 🔴 OPEN | |
| #6 | 🟡 Medium | Client | 🔴 OPEN | |
| #7 | 🟡 Medium | Client | 🔴 OPEN | |
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

---

### Maintenance instructions for future updates

Whenever an issue from this audit is fixed:

1. Change its status from 🔴 OPEN → 🟡 IN PROGRESS before/while implementing, if appropriate.
2. After the fix is actually implemented **and verified** (matching gate from `CLAUDE.md` §1 — lint/test/build as applicable), mark it 🟢 FIXED. Use ⚪ DEFERRED if a fix is intentionally postponed, with a reason.
3. Add implementation details and the verification result directly to that finding's entry above.
4. Update the row in the Progress Tracking table.
5. Add a row to the Change Log with the date, finding ID, what changed, and how it was verified.
6. Never mark a finding 🟢 FIXED merely because code was changed — tests/verification must actually pass.
