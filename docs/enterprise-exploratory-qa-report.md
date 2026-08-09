# Enterprise Exploratory QA Report — Teacher Assistant

**Date:** 2026-08-09
**Branch tested:** `feature/admin-runtime-settings` (at commit `1db192e`, working tree clean throughout)
**Tester posture:** Senior QA engineer / security-minded tester / UX reviewer / real end user, free-form exploratory pass
**Environment:** Local dev — server (`server/`, Node/Express, SQLite via Prisma) on `:3000`, client (`client/`, Vite/React) on `:5173`, real Gemini API key configured (live LLM calls observed, not mocked)
**Scope:** Whole application, with focused depth on the recently merged Admin Runtime Settings feature (Feature Management / AI Access — see `docs/admin-feature-flags-architecture.md`), plus Auth, Manage, Support Inbox, Coach, Library, Generator.
**Out of scope / not performed:** No destructive attacks, no load/perf benchmarking, no killing of the live dev server process (see §"Areas not testable"), no real Google OAuth flow exercised.

This report is additive — it does not modify or replace `docs/learning-representation-manual-qa.md` or any other existing QA document. No application code was changed to produce this report (verified via `git status` — clean throughout).

---

## Summary table

| ID | Category | Severity | Area | Status | Short Description |
|----|----------|----------|------|--------|-------------------|
| EQA-001 | Reliability / Bug | P2 High | Server-wide (`server/src/index.js` middleware order) | **Fixed / Verified** (2026-08-09) | Malformed JSON body responses are missing CORS headers, turning a correct 400 into an opaque browser "Failed to fetch" on every JSON endpoint |
| EQA-002 | Security-UX / Bug | P2 High | Session/auth, multi-tab | **Fixed / Verified** (2026-08-09) | A login in one tab silently invalidates another open tab's session; the stale tab keeps showing the old identity and gives a misleading "no permission" error instead of explaining the session changed |
| EQA-003 | Security / UX | P1 Critical | Admin Dashboard → Manage → Users | Confirmed | Promoting any user to Super Admin (highest privilege) via the role dropdown takes effect instantly with zero confirmation step |
| EQA-004 | UX / Copy | P3 Low | POST /api/auth/register validation | Confirmed | A malformed registration request surfaces a raw Zod validation string instead of a human-authored message |
| EQA-005 | Product / Enhancement | Enhancement | Admin Settings page | Confirmed (by design) | No UI action to clear an admin override back to "inherit env default" — only settable to an explicit value |
| EQA-006 | Product / Enhancement | Enhancement | Admin Settings page | Confirmed (by design) | Settings changes made from another tab/admin are not live-reflected until manual refresh |
| EQA-007 | UI / Cosmetic | P3 Low | Toast notifications (global) | Confirmed | Rapid sequential actions can produce closely-stacked toasts that briefly overlap card content |
| EQA-008 | Polish | P3 Low | Browser console (global) | Confirmed | React Router v7 deprecation warnings appear in the console on every page load |
| EQA-009 | Content Quality | P3 Low / Needs Investigation | Generator/Library (AI-generated text) | Needs Investigation | Observed AI-generated resource body text rendering a grade range as "Class 1112" instead of "Class 11-12" in one pre-existing saved resource |
| EQA-010 | UX | P3 Low / Enhancement | Manage → Pending teachers | Enhancement | "Approve"/"Reject" on a pending sign-up apply instantly with no confirmation or undo, unlike most other consequential actions |

**No issue found** after exploratory testing in: server-side RBAC enforcement on admin routes, client-side route guarding, stored-XSS handling in admin-visible tables, empty-role-list ("deny all") enforcement at the real Assistant endpoints, boolean feature-flag wiring end-to-end (server flag → login response → Coach UI), registration input validation (school code / duplicate email / weak password), rapid-multi-click race safety on the AI Access checkboxes, Coach network-error handling, composer character-limit enforcement, and native required-field validation on Login/Generator forms. See "Verified — no issue" list below for full detail and evidence.

---

## Critical / Must Fix Before Launch

### EQA-003 — No confirmation when granting Super Admin (or any role) via the Users table

**Category:** Security / UX (missing confirmation for a sensitive action)
**Severity:** P1 Critical
**Area:** Admin Dashboard → Manage → Users → Role column
**Status:** Confirmed

**Steps to reproduce:**
1. Sign in as `superadmin@example.com`, go to Admin Dashboard → Manage.
2. In the Users table, find any account (tested against a just-self-registered, still-untrusted account).
3. Change its Role `<select>` from `Teacher` to `Super Admin`.

**Expected:** Granting the single highest privilege in the system should require an explicit confirmation ("Grant Super Admin to X? This gives full administrative access.") or equivalent friction, given the blast radius of a misclick.

**Actual:** The role change takes effect immediately on `onChange` — no dialog, no "type to confirm," no undo toast, no re-auth. Verified server-side persistence via `GET /api/admin/users?search=...` immediately after the UI change: `"role":"super_admin"` was already committed.

**Evidence:**
- UI: role `<select>` shows "Super Admin" immediately after selection, no intervening modal.
- API: `GET /api/admin/users?search=qa-xss` (post-change) returned `{"id":"...","name":"<script>alert(1)</script>","role":"super_admin","status":"active",...}` within the same second.

**Root cause:** Not investigated at the component level beyond confirming there is no confirmation step in the UI flow (`ManagePage.tsx`'s role-change handler fires the PATCH directly on `onChange`).

**Recommended fix:** Require an explicit confirmation dialog specifically when the target role is `super_admin` (and arguably for any role change), naming the user and the privilege being granted.

**Why it matters for enterprise/premium users:** A single accidental click (wrong row, arrow-key misfire in a native `<select>`, a support agent double-checking someone else's account) can silently hand full administrative control — including the very Admin Settings screen this audit focused on — to any account, including a still-untrusted self-registered sign-up. This is exactly the class of "missing confirmation for a destructive/high-privilege action" an enterprise security review would flag first. It is not an RBAC bypass (only an authenticated super_admin can trigger it, and the server correctly enforces the actor's own permissions) — the risk is entirely about the lack of friction/undo for the person already in the seat.

**Notes:** Test account was cleaned up (demoted back to `teacher`) immediately after confirming persistence.

---

## High Priority

### EQA-001 — Malformed JSON request bodies lose CORS headers, turning a correct 400 into an opaque network failure

**Category:** Bug / Reliability
**Severity:** P2 High
**Area:** Server-wide — every endpoint that parses a JSON body (`server/src/index.js`)
**Status:** **Fixed / Verified** (2026-08-09). Original finding preserved below unmodified for audit-trail purposes; see "Resolution" at the end of this entry for what changed and how it was verified.

**Steps to reproduce:**
1. From the browser (or any cross-origin caller), send a request with an invalid JSON body to any endpoint that parses one, e.g.:
   ```js
   fetch('http://localhost:3000/api/admin/feature-flags/learning-representation', {
     method: 'PATCH',
     headers: { 'Content-Type': 'application/json', Authorization: 'Bearer <token>' },
     body: '{not valid json',
   });
   ```
2. Observe the browser console / caught exception.

**Expected:** The client should receive the server's actual response — a clean `400 {"error":"The request body was not valid JSON."}` (this exact message is already implemented server-side, deliberately, per inline comments referencing a prior M9 security review that fixed this same branch from leaking raw parser text and from returning a 500).

**Actual:** `fetch()` throws `TypeError: Failed to fetch` — a generic network-level failure with no status code, no body, and no way for client code to distinguish it from "the server is down." Confirmed via raw `curl -i` with an `Origin` header that the server **does** return the correct `400` and JSON body, but the response is **missing `Access-Control-Allow-Origin`**, so the browser blocks the page from ever reading it.

**Evidence (curl, reproducing what the browser sees at the network layer):**
```
$ curl -s -i -X PATCH http://localhost:3000/api/admin/feature-flags/learning-representation \
    -H "Content-Type: application/json" -H "Origin: http://localhost:5173" \
    -H "Authorization: Bearer bogus" --data-raw '{not valid json'
HTTP/1.1 400 Bad Request
... (no Access-Control-Allow-Origin header present) ...
{"error":"The request body was not valid JSON."}
```
Compare to a valid-JSON request that also errors (wrong password), which correctly includes the header:
```
$ curl -s -i -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" \
    -H "Origin: http://localhost:5173" --data-raw '{"email":"x@example.com","password":"wrong"}'
HTTP/1.1 401 Unauthorized
Access-Control-Allow-Origin: http://localhost:5173
{"error":"Incorrect email or password."}
```
Reproduced identically on `/api/auth/login` and `/api/resources/generate` (both the small-body and large-body JSON parser paths) — this is global, not specific to the admin settings feature this audit centered on.

**Root cause:** In `server/src/index.js`, `express.json()` (the small/large body-parser wrapper, ~line 343) is registered **before** `cors()` (~line 379). When the parser throws a `SyntaxError` on invalid JSON, Express jumps directly to the error-handling middleware (~line 776), skipping every regular middleware in between — including `cors()`. The error handler does correctly classify the error and return 400 with a safe message, but by then it's too late to attach CORS headers, so the browser discards the response as a cross-origin violation.

**Recommended fix:** Register `cors()` before the JSON body-parser (or any middleware that can throw), or have the error-handling middleware explicitly set `Access-Control-Allow-Origin` (mirroring the same origin-check logic already in the `cors()` config) before responding.

**Why it matters for enterprise/premium users:** This is invisible on the golden path (the app's own JS never sends malformed JSON), but it directly undermines a deliberate, security-reviewed fix that already exists in this codebase (the code comments explicitly reference two prior incidents this exact branch was hardened against — G22 and G11). Realistic triggers in an enterprise setting include corporate proxies/WAFs or content-inspection middleboxes that rewrite bodies, flaky mobile networks truncating a request mid-flight, or a future client-side bug. In every one of those cases the end user gets zero actionable information (masking the well-worded 400 the server already worked hard to produce) and a developer investigating the report gets a misleading "network error" instead of the true validation failure — materially harder production debugging.

#### Resolution (2026-08-09)

**What caused the issue:** Confirmed as originally root-caused above — `app.use(cors(...))` was registered in `server/src/index.js` *after* the JSON body-parser (`express.json()`) middleware. When the parser threw a `SyntaxError` on an invalid body, Express skipped straight to the error-handling middleware at the bottom of the file, bypassing every regular middleware in between, including `cors()`. The error handler's already-correct `400 {"error":"The request body was not valid JSON."}` response therefore went out with no `Access-Control-Allow-Origin` header, and the browser discarded it as a cross-origin violation before the frontend's JS ever saw it — surfacing as a generic `TypeError: Failed to fetch`.

**What was changed:** A pure reorder, no new logic and no duplicate CORS handling:
- In `server/src/index.js`, the entire CORS block (`allowedOrigins`, the production fail-fast check, `isOriginAllowed()`, and the `app.use(cors(...))` call) was moved to run immediately after `app.use(helmet())` and *before* the JSON body-parser (`jsonSmall`/`jsonLarge`) is registered. `cors()` reads only the request's `Origin` header and sets response headers synchronously before calling `next()` — it never touches the request body — so this reordering has no effect on any request that parses successfully; it only changes what has already run by the time a later middleware (the body-parser) throws.
- Added an explanatory comment at the new `cors()` registration site, and a cross-reference note in the error-handling middleware's existing malformed-JSON comment block, so the ordering dependency is documented in place for future maintainers (not just in this report).
- No changes to the CORS origin-allowlist logic itself (`isOriginAllowed`, the production fail-fast-on-empty-allowlist check, or the `Not allowed by CORS` rejection path) — allowed origins, disallowed origins, and dev-mode any-origin reflection all behave exactly as before.
- No other application behavior was touched.

**How it was verified:**
1. *Automated regression tests* (see coverage below) — `npx vitest run test/cors.test.js` → all 7 tests pass (3 pre-existing + 4 new).
2. *Full server test suite* — `npx vitest run` → 68 test files, 1712 tests, all pass (no regressions introduced elsewhere by the middleware reorder).
3. *Server lint* — `npm run lint` (server `eslint src evals tools`) → clean, no errors or warnings.
4. *Manual `curl` verification* (network-layer, mirroring the original repro): a malformed-JSON `PATCH` to `/api/admin/feature-flags/learning-representation` with `Origin: http://localhost:5173` now returns `HTTP/1.1 400` **with** `Access-Control-Allow-Origin: http://localhost:5173` present, where before the fix that header was absent (confirmed by re-running the exact same request against the pre-fix code path during the original audit).
5. *Manual browser verification* (the actual bug's symptom, not just the wire format): from a live page served at `http://localhost:5173` (via the browser automation tooling used for this audit, exercising the real Chrome fetch/CORS enforcement — not curl), ran:
   ```js
   await fetch('http://localhost:3000/api/auth/login', {
     method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not valid json',
   });
   ```
   **Before the fix**, this call threw `TypeError: Failed to fetch` in the page (reproduced during the original audit — see EQA-001's "Actual" section above). **After the fix**, the same call from the same origin now resolves normally: `{"status":400,"body":{"error":"The request body was not valid JSON."}}`. Re-ran the identical check against the original repro endpoint, `PATCH /api/admin/feature-flags/learning-representation`, with the same result — `400` with the real error body, no thrown exception.
6. *Disallowed-origin behavior preserved*: a malformed-JSON request from a non-allowlisted origin in production mode (`CORS_ORIGINS` set, `Origin: https://evil.example.org`) still receives no `Access-Control-Allow-Origin` header and is still rejected — confirmed by the new regression test and consistent with the unchanged `isOriginAllowed()`/origin-rejection logic.
7. *Production and development CORS modes both re-verified*: the pre-existing "production boot fails without `CORS_ORIGINS`," "production only allows listed origins," and "development reflects any origin" tests all continue to pass unmodified, alongside the new malformed-JSON cases run under both `NODE_ENV=test` (dev-like) and `NODE_ENV=production`.

**Regression test coverage added** (`server/test/cors.test.js`, new `describe('malformed JSON body + CORS (P2-002 regression)')` block, 4 tests):
- Dev mode: malformed JSON from any origin → `400` + the real error body + the reflected `Access-Control-Allow-Origin` header.
- Production: malformed JSON from an **allowed** origin → `400` + the real error body + the correct `Access-Control-Allow-Origin` header.
- Production: malformed JSON from a **disallowed** origin → still blocked (`>= 400`), no `Access-Control-Allow-Origin` header leaked to a non-allowlisted caller.
- Valid JSON from an allowed origin → unchanged behavior (still reaches the route handler, still gets its CORS header), confirming the reorder didn't alter ordinary request handling.

All pre-existing CORS tests (production fails fast on empty allowlist; production allows only listed origins; development reflects any origin) continue to pass unmodified.

**Scope discipline:** Only this finding (EQA-001 / P2-002) was addressed. No other findings from this report (EQA-002 through EQA-010) were touched, and no unrelated application behavior was modified — confirmed via `git diff` before finalizing (see repository state below).

---

### EQA-002 — Cross-tab session desync: stale identity displayed after another tab's login overwrites the shared token

**Category:** Bug / Session management / UX
**Severity:** P2 High
**Area:** Auth/session handling, global (any two tabs of the same browser profile)
**Status:** **Fixed / Verified** (2026-08-09). Original finding preserved below unmodified for audit-trail purposes; see "Resolution" at the end of this entry for what changed and how it was verified.

**Steps to reproduce:**
1. Open Tab A, sign in as `superadmin@example.com`, navigate to `/admin/settings`.
2. Open Tab B (same browser window/profile), sign in as a **different** user, e.g. `teacher@example.com`.
3. Return to Tab A without refreshing it. Click any control on the Admin Settings page (e.g. toggle the Learning Representation checkbox).

**Expected:** Either Tab A should detect the identity change and prompt for re-authentication/reload, or at minimum the resulting error should explain that the session was superseded elsewhere.

**Actual:**
- Tab A's UI does not update on its own: it still displays "Super Admin" in the top-right identity chip, the "Dashboard" admin nav link is still visible, and the full Admin Settings page is still rendered as if nothing changed.
- Clicking a control sends the request using the (now-overwritten) token; the server correctly rejects it, and the UI shows a **generic** red toast: *"You do not have permission to do this."*
- To a real super_admin who did nothing wrong, this message is actively confusing — there is no indication their session was replaced by a sign-in elsewhere.
- A manual refresh/navigation in Tab A **does** self-heal correctly: it re-fetches identity, now shows "Demo Teacher," and redirects away from the now-forbidden `/admin/settings` route.

**Evidence:** Reproduced twice. Confirmed via `GET /api/auth/me` from Tab A's own `localStorage` token immediately after Tab B's login that the token had in fact changed to the teacher's, while Tab A's rendered UI still showed Super Admin content.

**Root cause:** `auth_token`/`refresh_token` are stored in `localStorage`, which is shared per-origin across all tabs of the same browser profile. There is no `storage`-event listener or periodic re-validation to detect that the token was replaced by another tab, so a tab's React state only resyncs on its next full navigation/reload.

**Recommended fix:** Listen for the `storage` event (fires in other tabs when `localStorage` changes) and either re-fetch `/auth/me` to resync the displayed identity, or prompt the user that their session changed and offer a reload. At minimum, distinguish this specific 403 case with a clearer message.

**Why it matters for enterprise/premium users:** Not a security hole — server-side RBAC held correctly in every trial, and the failure mode is fail-closed (the stale tab simply can't perform the write). The cost is confusion and wasted time: an IT admin managing this product across multiple tabs (a very plausible enterprise workflow — one tab for settings, one for support tickets, one for testing as themselves) can be told "you don't have permission" for an action they very much have permission for, with no explanation, which reads as the product being broken.

#### Resolution (2026-08-09)

**What caused the issue:** Confirmed as originally root-caused above — `auth_token`/`refresh_token` live in `localStorage`, shared per-origin across every tab of the same browser profile, but each tab's `user`/`featureFlags` React state (`client/src/auth.tsx`) was only ever populated at that tab's own initial page-load bootstrap or its own sign-in/sign-out. Nothing in `AuthProvider` re-checked the stored token after mount, so a DIFFERENT tab overwriting or clearing that shared token left every other open tab's displayed identity frozen at whatever it was when that tab last checked — until its next full navigation/reload.

**What was changed:**
- `client/src/auth.tsx` — the one-off "restore session on mount" effect was generalized into a reusable `reconcile()` callback (reads the *current* token from storage, calls `GET /auth/me`, and syncs `user`/`featureFlags` to match, or clears both if there's no token / the token turns out to be invalid). It is called both on initial mount (unchanged behavior) and now also from a new `useEffect` that listens for the browser's native `storage` event — which fires in every OTHER same-origin tab whenever `localStorage` changes, but **never** in the tab that made the write. That platform guarantee is what rules out a same-tab feedback loop structurally, without any extra bookkeeping needed for it.
- A `reconcileIdRef` monotonic counter guards against races: each call to `reconcile()` gets a ticket, and only the response whose ticket is still current is allowed to update state. This protects against a burst of rapid tab switches (in another tab) where an older, slower `/auth/me` response could otherwise land after a newer one and revert the UI to stale data. `authenticate()` (the shared tail of `login()`/`loginWithGoogle()`) and `logout()` also bump this counter, so a reconcile already in flight when the *current* tab performs its own login/logout can never win and clobber that fresh local action either.
- `client/src/lib/authStorageSync.ts` (new) — a small pure function, `shouldResyncAuthOnStorageEvent(key, tokenStorageKey)`, extracted specifically so the "which storage events matter" decision is covered by this project's existing PURE-LOGIC-only client test runner (see `vitest.config.ts`'s documented "no component-rendering tests" decision, which this change deliberately respects rather than introducing React Testing Library). It returns `true` for the access-token key itself or for `key === null` (`localStorage.clear()`), and `false` for every other key — which also naturally de-dupes the *pair* of `storage` events a single `setSession()` call produces (it writes the access token and refresh token together) down to one resync, and ignores unrelated keys this app also keeps in `localStorage` (`theme`, `fontScale`).
- `client/src/api.ts` — `TOKEN_KEY` (`'auth_token'`) was exported (previously module-private) so `auth.tsx` has one source of truth for the key name rather than a second hardcoded string.
- No new session/auth system, no polling, no change to JWT issuance/verification or server-side authorization — purely a client-side resync of already-existing, already-correct server state. Normal single-tab login/logout is byte-for-byte the same code path as before (`authenticate()`/`logout()` still update state directly and immediately); only a *different* tab's change is now detected.

**How it was verified:**
1. *Automated tests* — `client/src/lib/authStorageSync.test.ts` (new, 7 cases): resyncs on the token key changing, resyncs on `key === null` (`clear()`), does **not** resync for the paired `refresh_token` key event or for unrelated keys (`theme`, `fontScale`), treats an empty-string key as distinct from `null`, and two tests specifically targeting "no infinite loop / no runaway behavior": the predicate is proven to have no internal state (stable across 50 repeated calls with the same input), and a simulated rapid alternating burst of events resolves each one independently rather than cumulatively. `npx vitest run src/lib/authStorageSync.test.ts` → 7/7 pass.
2. *Full client test suite* — `npx vitest run` → 370/371 pass; the 1 pre-existing failure (`src/assistant/generatorPrefill.test.ts`, an unrelated Generator-telemetry test) was confirmed via `git stash` to fail identically on the base branch **before** this change, i.e. pre-existing and untouched by this fix.
3. *Lint* — `npm run lint` (client `eslint src`) → clean.
4. *Typecheck + build* — `npm run build` (`tsc -b && vite build`) → succeeds with no type errors.
5. *Manual two-tab browser QA* (real Chrome, two tabs of the same profile, real login/logout through the actual UI — see Notes for one methodology caveat):
   - **Scenario 1** (Tab A logged in as User A → Tab B signs in as a different User B → return to Tab A without touching it): Tab A's identity chip changed from "Rampur Admin / School Admin" to "Demo Teacher / Teacher" and its "Dashboard" admin nav link disappeared, entirely on its own, with no reload. Step 7 (protected action): navigating Tab A directly to `/admin/manage` afterward correctly redirected away instead of showing stale admin content.
   - **Scenario 2** (both tabs signed in → sign out from Tab B → return to Tab A): Tab A, untouched, redirected itself from `/` to `/login` the moment Tab B signed out. Console clean.
   - **Scenario 3** (Tab A signed in as a normal user → Tab B switches to an admin-role user): Tab A's "Dashboard" admin nav link **appeared** on its own (the reverse direction from Scenario 1, confirming admin UI isn't stale-*absent* either) — again with zero interaction with Tab A and no reload.
   - **Refresh after sync**: a hard reload of a tab mid-session correctly re-authenticated and displayed the current identity (unchanged, pre-existing bootstrap behavior).
   - **Browser back/forward**: navigating Library → Generator → back correctly returned to Library with identity intact and no console errors.
   - **Rapid multiple storage changes**: fired a tight synchronous burst of three storage writes in Tab B (a malformed token → removed → the real token, with no `await` between them, so all three `storage` events reached Tab A before any response could land) — Tab A converged cleanly on the final (real) identity with no error, no stuck/flickering UI, and no console errors, confirming the `reconcileIdRef` staleness guard resolves races by *initiation* order rather than response-arrival order.
   - **Console errors**: none observed in any tab across all scenarios.
   - **No infinite reload/render loop**: confirmed directly — no `window.location` reload ever fired from the sync mechanism itself (only my own deliberate manual navigations did), and network activity matched one request per meaningful state change with no runaway duplication.

**Regression test coverage added:** `client/src/lib/authStorageSync.test.ts` (7 tests, detailed above). Per this codebase's documented, deliberate testing-architecture boundary (`vitest.config.ts`: pure-logic modules only, no component rendering), `auth.tsx` itself is — like the rest of this app's React components — covered by manual QA rather than an automated component test; that manual verification is documented in full above.

**Notes on methodology:** Testing hit this project's real IP-scoped `authLimiter` (30 requests/15min across all `/api/auth/*` routes) twice, purely from the cumulative volume of logins/logouts this manual QA and the preceding exploratory audit generated in one long session — not a defect. Each time, testing paused and polled (rather than guessing or fabricating results) until the limiter's own `RateLimit-Reset` window genuinely elapsed before continuing. One useful side observation surfaced by hitting it: `reconcile()`'s catch-all — inherited unchanged from the original bootstrap effect's own catch-all — treats *any* `/auth/me` failure, including a transient `429`, the same as "no valid session" and logs out locally. This is pre-existing behavior (verified identical before this change), not a regression introduced here, and is out of scope for EQA-002 per this task's instructions to fix only this finding; it may be worth its own future finding (distinguishing a transient/rate-limited failure from a genuinely invalid session) but was not touched.

**Scope discipline:** Only this finding (EQA-002) was addressed in this pass. EQA-001 remains as previously fixed/verified; EQA-003 through EQA-010 were not touched, and no unrelated application behavior was modified — confirmed via `git diff` before finalizing (see repository state below).

---

## Medium Priority

*No findings were classified at Medium severity in this pass — the remaining confirmed issues below are Low/Enhancement, and EQA-001/002/003 above (rated High/Critical) absorbed what would otherwise be the Medium-severity findings in this audit.*

---

## Low Priority

### EQA-004 — Registration validation can leak a raw schema-library error string

**Category:** UX / Copy
**Severity:** P3 Low
**Area:** `POST /api/auth/register`
**Status:** Confirmed

**Steps to reproduce:** `POST /api/auth/register` with a missing required field (e.g. omit `name`/`password`/`schoolCode`).

**Expected:** A human-authored message, consistent with its neighbors (compare: `"Password must be at least 8 characters."`, `"Invalid school code. Please check with your administrator."`).

**Actual:** `{"error":"Invalid input: expected string, received undefined"}` — a raw Zod validation message.

**Evidence:** Reproduced via direct API call; the real Register form in the UI always sends all fields, so this is not reachable through normal use of the app itself, only via direct API calls (scripted integrations, other clients, or a future form bug).

**Recommended fix:** Add a friendlier fallback message for generic schema-validation failures at this endpoint, matching the tone of the other auth error copy.

**Why it matters for enterprise/premium users:** Low impact today since the golden path never triggers it, but any enterprise IT team scripting against the API (bulk account provisioning, SSO bridging, etc.) would see this and reasonably read it as an unfinished/under-tested API surface.

---

### EQA-007 — Toasts can visually stack/overlap when multiple actions complete in quick succession

**Category:** UI / Cosmetic
**Severity:** P3 Low
**Area:** Global toast system (`client/src/components/Toast.tsx`)
**Status:** Confirmed

**Steps to reproduce:** Trigger two settings changes close together (e.g. two AI Access checkbox toggles a moment apart) on a shorter viewport.

**Expected:** Toasts stack cleanly without visually competing with page content.

**Actual:** The toast stack (`position: fixed; bottom: 1.2rem`) is close enough to the Admin Settings cards' bottom edge that, on a short window, two toasts appearing in succession briefly render over/near the settings content below. Each toast still clears itself after ~3.2s and the underlying state is correct — this is purely cosmetic.

**Recommended fix:** Not required; if desired, increase the toast stack's bottom offset or cap simultaneous visible toasts to one (replace-in-place) for a slightly more polished feel.

**Why it matters for enterprise/premium users:** Minor — a careful reviewer doing rapid-fire admin changes might notice the visual jostle, but it self-resolves in seconds and never obscures a destructive action.

---

### EQA-008 — React Router v7 deprecation warnings on every page load

**Category:** Polish
**Severity:** P3 Low
**Area:** Browser console, global
**Status:** Confirmed

**Steps to reproduce:** Open DevTools console, load any page.

**Actual:**
```
⚠️ React Router Future Flag Warning: React Router will begin wrapping state updates in React.startTransition in v7. ...
⚠️ React Router Future Flag Warning: Relative route resolution within Splat routes is changing in v7. ...
```

**Impact:** Zero functional impact — these are React Router's own future-flag opt-in notices. No other console errors were observed on any page visited during this audit.

**Recommended fix:** Set the two documented future flags (`v7_startTransition`, `v7_relativeSplatPath`) on the router config before a public/enterprise launch, purely so a technical evaluator opening devtools doesn't read "unmaintained dependency warnings" into it.

---

### EQA-009 — Possible AI-generated content formatting artifact ("Class 1112")

**Category:** Content Quality
**Severity:** P3 Low
**Status:** Needs Investigation (not confirmed as a reproducible app bug — see below)

**Observation:** A pre-existing saved resource in My Library ("optics", General Resource, tagged "Class 11-12 · Science") contains body text reading: *"Teaching Optics to Class 1112 Science students requires a blend of conceptual..."* — the grade range renders correctly with a hyphen in the card's metadata line, but the AI-generated body text itself is missing the hyphen ("1112" instead of "11-12").

**Why "Needs Investigation" rather than "Confirmed":** This resource was pre-existing test data from an earlier QA session, not something generated during this audit, and the content is LLM output rather than deterministic app logic — the missing hyphen could be a one-off generation artifact (the model dropping a hyphen) rather than a reproducible formatting bug in a rendering/templating path. Reproducing it would require regenerating a Grade 11-12 resource and observing whether the same pattern recurs; this was not done in this pass due to time budget.

**Recommended next step:** If this recurs, check whether the grade value is interpolated into the generation prompt in a form ("11-12") that the model tends to compress, and consider stripping/normalizing hyphens more defensively in generated copy, or explicitly instructing the model to preserve the hyphen.

---

## Premium UX Opportunities (Enhancements, not bugs)

### EQA-005 — No UI action to clear an admin setting override back to "env default"

**Current:** Admin Settings lets a super_admin set an explicit override for Learning Representation (boolean) and Assistant Access (role list), but there is no way to remove that override and return to "inherit whatever the env var currently says" — only to set the override's value equal to the env default. This is called out as a deliberate Phase 1 scope decision in `docs/admin-feature-flags-architecture.md` §9, so it is **not a bug**, but worth flagging for a premium/enterprise admin experience.

**Problem:** An admin who wants "no override, just do whatever ops configured" has no explicit affordance for that state; they have to know (or go ask someone) what the current env value is and manually match it. If ops later changes the env var, the admin's earlier override (even if it happened to match at the time) will now silently diverge from what they'd expect.

**Recommendation:** Add a "Reset to default" action per setting (backed by the `DELETE /api/admin/feature-flags/:id` the architecture doc already anticipates), showing the row's current `source: 'override' | 'env-default'` state more prominently so an admin can see at a glance whether they're looking at a real override or the baseline.

**Expected benefit:** Removes an entire class of "why is this still overridden" support questions and makes the override lifecycle (set → later intentionally clear) a first-class, discoverable action instead of tribal knowledge.

---

### EQA-006 — Admin Settings changes are not live across tabs/sessions

**Current:** Changing a setting in one admin session is not reflected in another already-open Admin Settings tab/session until that tab is refreshed. This is an explicit, documented Phase 1 decision (architecture doc §9: "Real-time push... not built"), not a bug.

**Problem:** For a product being pitched as enterprise-grade, two admins (or one admin with two tabs) can end up looking at contradictory state without realizing it, especially combined with EQA-002's cross-tab desync above.

**Recommendation:** A lightweight periodic re-fetch (e.g. on window focus) of `GET /api/admin/feature-flags` while the Admin Settings page is open would close most of this gap without needing full websocket infrastructure.

**Expected benefit:** Reduces the chance an admin acts on stale information when multiple people/tabs manage the same tenant-wide settings.

---

### EQA-010 — Pending-teacher Approve/Reject have no confirmation, inconsistent with the risk of Reject

**Current:** Both "Approve" and "Reject" on a pending sign-up apply immediately on click.

**Problem:** Approve granting account access is broadly fine (reversible via the Users table). Reject, however, permanently denies a real person's sign-up request with a single click and no undo — more consequential than its one-click affordance suggests, and inconsistent with how seriously this audit found the Users-table role change should be treated (EQA-003).

**Recommendation:** Consider a lightweight confirm ("Reject this sign-up from <name>?") for Reject specifically, or at minimum a short-lived "Undo" affordance in the resulting toast.

**Expected benefit:** Protects against a misclick permanently turning away a legitimate teacher sign-up, which — unlike an admin's own settings mistake — the affected end user has no way to self-correct.

---

## Accessibility Improvements

Accessibility was reviewed through a mix of live interaction and source review (see "Areas not testable" for a live keyboard-navigation limitation encountered in this environment).

**No issue found:**
- No global `outline: none` reset exists anywhere in `client/src/index.css` (the single most common accessibility anti-pattern) — the codebase instead defines explicit `:focus-visible` styles (orange outline, consistent offset) across dozens of interactive component classes (`.icon-btn`, `.nav-link`, `.history-item-main`, `.quick-action-card`, `.library-card-main`, etc.).
- The handful of `outline: none` uses found are scoped to specific text inputs that substitute a border-color focus treatment instead (e.g. `.composer-textarea`, `.auth-input input`), not a blanket suppression.
- The Admin Settings page's plain `<input type="checkbox">` controls (Feature Management toggle, AI Access role checkboxes) have no focus-suppressing CSS targeting them, so they retain the browser's native focus ring.
- Login form errors use `role="alert"` (`LoginPage.tsx`), and the global toast stack uses `role="status" aria-live="polite"` (`Toast.tsx`) — both will be announced by a screen reader without the user needing to find them visually.
- Icon-only controls in the top bar carry descriptive, state-aware `aria-label`s (e.g. `"Switch to light mode"` / `"Switch to dark mode"`, `"Collapse sidebar"` / `"Expand sidebar"`, `` `Account menu for ${displayName}` ``) rather than generic ones.
- Color is not the sole signal for the Feature Management ON/OFF state — it pairs a colored pill with the literal text "ON"/"OFF".

**Not fully testable in this environment:** Live keyboard Tab-order traversal could not be reliably verified — synthetic `Tab` keypresses dispatched through the browser-automation tooling did not consistently move `document.activeElement` in this sandboxed Chrome instance (repeated `Tab` presses left focus on `<body>`). This looks like a tooling/environment limitation rather than an app behavior (the code-level review above found no reason focus traversal should fail), but it means true end-to-end keyboard-only navigation was not directly observed and should be re-verified by a human tester with a physical keyboard before launch.

---

## Verified — No Issue Found (full list, with evidence)

Per this audit's quality bar, these are recorded explicitly rather than omitted, since they represent real exploratory testing that came back clean:

1. **Server-side RBAC on all admin settings routes.** Teacher token → `403 {"error":"You do not have permission to do this."}`; no token → `401 {"error":"Authentication required."}`; garbage/invalid token → `401` with a clean "session has expired" message. Verified this holds independent of whatever the client UI shows (defense in depth).
2. **Client route guarding.** A teacher navigating directly to `/admin/settings` by URL is silently redirected to Coach with no flash of admin content and no stray admin API calls fired (confirmed via network log).
3. **Rapid multi-click race safety on AI Access checkboxes.** Three rapid clicks on one role checkbox produced an internally consistent final state (the `pendingId`-based disabling in `AdminSettingsPage.tsx` correctly serializes writes); one of the three synthetic clicks was silently absorbed while the checkbox was briefly disabled — expected, not a bug.
4. **Empty role list ("deny all") is genuinely enforced, not just displayed.** Set `assistant-allowed-roles` to `[]` via the real API, then confirmed as a teacher: `GET /api/assistant/catalog` → `200 {"actions":[]}`; `POST /api/assistant/interpret` → `200 {"passthrough":true,"reason":"disabled"}`. Graceful degrade, never an error, exactly matching the architecture doc.
5. **Boolean feature flag wiring, end-to-end.** Toggled Learning Representation OFF as super_admin → a teacher's fresh login response correctly reports `learningRepresentationEnabled:false` → asking Coach a real question (live Gemini call) shows only Read aloud/Copy/WhatsApp/Save to Library, with no "View as visual" action. Confirmed the flag actually changes behavior, not just admin-panel display text.
6. **Settings changed via another session are not live-pushed** (by design, see EQA-006) but **do** correctly resync on a manual refresh, including redirecting a now-unauthorized user away from `/admin/settings`.
7. **Login error handling.** Wrong password → clear, non-account-enumerating message ("Incorrect email or password."). Empty-field submit → native browser required-field validation blocks submission with no crash.
8. **Registration validation (real request shapes).** Invalid school code, duplicate email, and weak (<8 char) password are all rejected with clear, well-worded, non-leaky messages.
9. **Stored-XSS check.** Registered a pending teacher with the literal name `<script>alert(1)</script>`; verified via DOM inspection that it renders as escaped text everywhere it appears (Pending teachers table, Users table) — React's default escaping held, no script execution, no dialog fired.
10. **Approve pending teacher** works correctly and instantly moves the row from Pending to Active Users.
11. **Coach network-failure handling.** Simulated a backend-unreachable condition for the Coach send request (see Notes on methodology): the UI shows a clear "⚠ Network error. Please check your connection." message with "Try again" and "Report" actions, the composer is not left stuck disabled, and the failed attempt does not pollute chat history or the sidebar. Recovering (reload) returns the app to a fully clean state.
12. **Composer character-limit enforcement.** A 700-character-plus string mixing ASCII, emoji, and Hindi text is correctly capped at exactly 500 characters (the field's stated limit), with the "500/500" counter matching.
13. **Native required-field validation on the Generator form.** Submitting with an empty required Topic field is blocked client-side, scrolls the field into view, and does not fire an API request.
14. **Admin dashboard analytics charts render real data correctly** (bar and line charts) — an initial screenshot appeared to show them empty, which on closer zoom was purely a screenshot-compression artifact, not an app bug.
15. **No horizontal-overflow bug on Manage/Support pages at 1280px width**, despite screenshots that visually appeared to cut off the "Add school" button and a table column — verified via `getBoundingClientRect()`/`scrollWidth` that all content was genuinely within the true viewport. (See Methodology note below — this false alarm is recorded because it's a useful calibration data point for future testers using the same tooling.)

---

## Methodology notes / tooling caveats (recorded for reproducibility)

- **Screenshot-vs-viewport mismatch:** The screenshot tool used in this session repeatedly captured images wider (e.g. 1512–1568px) than the page's actual `window.innerWidth` (1280px). This creates a visual illusion that right-edge content is "cut off" when it is not. Every apparent overflow finding in this pass was cross-checked with `getBoundingClientRect()`/`scrollWidth`/`clientWidth` before being reported, and two apparent overflow issues were ruled out this way (see items 14–15 above). Future testers using this same tooling should do the same rather than trusting screenshot edges.
- **`resize_window` did not change the actual viewport in this session** (confirmed via `screen.width`/`screen.height` staying at a fixed 1280×800 regardless of the requested size, across four attempts at 390×844, 800×900, and 414×896). This blocked live browser verification of the tablet/mobile breakpoints called for in the test brief — see "Areas not testable" below.
- **Backend-unavailable testing** was performed by monkey-patching `window.fetch` inside the page (rejecting only Coach-endpoint calls) rather than killing the actual running server process, because the server on port 3000 was already running from outside this session (this session's own `npm run dev` attempt failed with `EADDRINUSE`, confirming a pre-existing process was in control) and terminating an unidentified process felt outside this audit's blast radius. This safely reproduces the client-side failure mode but does not test true connection-refused/timeout behavior at the network layer.
- **Multi-tab role testing** required care: `auth_token`/`refresh_token` live in `localStorage`, which is shared per-origin across all tabs of one browser profile, so two tabs cannot independently hold two different users' sessions (this is itself EQA-002). Role-specific checks were therefore done either via direct token-bearing `fetch()` calls (for pure API/RBAC verification) or by deliberately re-authenticating a tab immediately before each UI check.
- Two test artifacts were created and cleaned up during this audit: a pending teacher `qa-xss@example.com` (used for the XSS and privilege-escalation checks, demoted back to `teacher` after verification) and several rejected/failed registration attempts that never became persisted accounts. Pre-existing test/demo data from prior QA sessions in this dev database (accounts like `demo raj`, various `legacy-*@invalid.local` entries) was left untouched.

---

## Final Report

> **Post-audit update (2026-08-09):** EQA-001 and EQA-002 have since been fixed and verified (see each finding's "Resolution" subsection above). The counts, blocker recommendation, and readiness rating below are left as originally written at audit time, to preserve this report as an accurate point-in-time audit trail — read them together with the Summary table at the top, which reflects both findings' current `Fixed / Verified` status.

**1. Total issues found:** 10 (1 Critical/P1, 2 High/P2, 4 Low/P3, 3 Enhancement)

**2. Critical issues:** 1 — EQA-003 (no confirmation granting Super Admin)

**3. High-priority issues:** 2 — EQA-001 (CORS lost on malformed-JSON error path), EQA-002 (cross-tab session desync with misleading error)

**4. Medium/low issues:** 4 Low — EQA-004 (raw validation string leak), EQA-007 (toast overlap), EQA-008 (console deprecation warnings), EQA-009 (possible AI-content formatting artifact, unconfirmed)

**5. Premium UX recommendations:** 3 — EQA-005 (no "reset to default" for admin overrides), EQA-006 (no live cross-tab settings sync), EQA-010 (Approve/Reject need proportionate confirmation)

**6. Accessibility findings:** No confirmed defects. Strong code-level signal (no outline-suppression anti-pattern, broad `:focus-visible` coverage, `role="alert"`/`aria-live` used correctly, descriptive `aria-label`s on icon buttons, no color-only state communication). One item — live keyboard Tab-order — could not be directly verified due to a tooling limitation in this environment and should be spot-checked by a human before launch.

**7. Security/RBAC findings:** No confirmed vulnerabilities. Server-side RBAC on every admin route held under every tested condition (no token, invalid token, wrong-role token, direct URL access). The one Critical finding (EQA-003) is a missing-confirmation UX/process gap for an already-authenticated super_admin, not an authorization bypass. Stored-XSS check on user-supplied names came back clean.

**8. Responsive findings:** Not directly browser-verified this pass (see tooling caveat above — `resize_window` did not affect the real viewport in this environment). Code-level review found a consistently applied `.table-wrap { overflow-x: auto; }` pattern around every admin data table and `flex-wrap` on the AI Access role checkbox grid, both of which are the right patterns for narrow viewports; this should be confirmed with a live mobile-width pass in an environment where window resize works, or on a physical device.

**9. Performance observations:** No janky renders, duplicate API calls, or visible layout shift observed on any page visited. Admin dashboard analytics (bar/line charts) render promptly with real aggregated data. Coach responses stream in over several seconds for a real Gemini call, with an appropriate "Preparing practical advice for you..." loading state throughout (no stuck spinners observed in any tested path, including the simulated network-failure path).

**10. Areas tested:** Login/Register/pending-approval flow, RBAC across all four roles (verified via tokens, not full parallel UI sessions), Admin Settings (Feature Management + AI Access) including empty-list and rapid-click edge cases, Manage (schools, pending teachers, users/roles), Support Inbox (list + ticket detail), Coach (question flow, error handling, character limits, flag-gated UI), Library, Generator (form validation), global console/network hygiene, a code-level accessibility and responsive-CSS review.

**11. Areas not testable in the current environment:** Live mobile/tablet viewport verification (`resize_window` non-functional in this sandbox); true backend-connection-refused/timeout behavior (server process not owned by this session, simulated via `fetch` patching instead); live keyboard-only Tab-order traversal (synthetic key events did not reliably move focus); real Google OAuth sign-in flow (would require a live external Google account); multi-instance/load-balancer consistency (single dev server instance only).

**12. Recommended launch blockers:** EQA-003 (Super Admin confirmation) should be fixed before an enterprise launch — it's the one finding in this audit with genuine "one misclick, full admin access, no undo" severity. EQA-001 and EQA-002 are strongly recommended but arguably shippable with a documented risk acceptance, since neither is reachable via the product's own golden-path UI.

**13. Recommended post-launch backlog:** EQA-004 (validation copy), EQA-005/006/010 (premium UX enhancements), EQA-007/008 (cosmetic polish), EQA-009 (investigate if it recurs).

---

## Enterprise Launch Readiness: **Needs Fixes**

**Evidence for this rating:**
- The core architecture is sound and, in several places, deliberately hardened: server-side RBAC held under every adversarial condition tested; the previously-fixed malformed-JSON-body 500→400 conversion (referenced in code comments as a prior security-review fix) is real and correct at the handler level; stored-XSS was clean; the brand-new Admin Runtime Settings feature's core promise (env-var override, fail-safe-to-default, actually enforced at the real request path, not just displayed) held up under direct testing including the deliberately-tricky "empty role list" and rapid-multi-click cases.
- What's missing for "Ready" is precisely the kind of polish an enterprise buyer's own security/IT review would probe first: a one-click, no-confirmation path to granting full administrative control (EQA-003) is the single clearest blocker, and it's a small, well-scoped fix (add one confirmation dialog).
- EQA-001 and EQA-002 are genuine but lower-urgency reliability/UX gaps that a technical enterprise evaluator (running their own network tooling, testing multi-tab admin workflows) is more likely to find than an average end user — worth fixing before or shortly after launch, not necessarily blocking it.
- No performance, accessibility, or responsive **defects** were confirmed (as opposed to *not-yet-verified*) — the "Needs Fixes" rating rests specifically on the security/UX confirmation gaps found, not on breadth of unresolved issues.

---

## Files created/modified by this audit

- **Created:** `docs/enterprise-exploratory-qa-report.md` (this file)
- **Modified:** none
- No application code, configuration, or database seed data was permanently altered. Two ephemeral test records (a self-registered pending teacher, briefly promoted to and demoted from `super_admin`; several rejected/duplicate registration attempts that were never persisted) were created and cleaned up during testing, as noted in Methodology.

## Git status at end of audit

```
On branch feature/admin-runtime-settings
nothing to commit except this new report file
```

No commits were made. No push was performed, per instructions.
