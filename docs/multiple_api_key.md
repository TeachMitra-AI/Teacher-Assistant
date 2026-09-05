# Multiple Gemini API Keys — Automatic Failover

> Branch: `multiple_api`. Records what was built, why, and the exact Q&A that shaped the
> design decisions — so a future session (human or AI) can pick this up with full context.

## 1. The problem

The server used to read exactly one `GEMINI_API_KEY` from `.env` and share it across all
three Gemini-backed features (coaching, the AI Action Router, attachment analysis). Once
that one key hit its rate limit or daily quota, every one of those features started failing
with a "service is busy" error until the key recovered — even though the product may have
several Gemini keys available.

**Goal:** accept multiple API keys, and when one gets rate-limited/exhausted, switch to the
next one automatically and fast enough that the teacher never sees an error — for as long as
at least one key still has headroom.

## 2. Requirements, as given across the conversation

1. `.env` keeps the single `GEMINI_API_KEY` variable, but it may now hold a **comma-separated
   list** of keys.
2. When the current key hits its limit, the app should search for a key that is **not** over
   limit and switch to it **automatically and fast**, so the teacher never sees an
   over-limit error (as long as any key still works).
3. All three Gemini-backed features (coach, router, attachments/resources AI actions) share
   **one pool** — they draw on the same underlying Google quota.
4. An exhausted key should **not** be abandoned forever — it should automatically rejoin
   rotation later ("cooldown then retry"), not require a server restart.
5. *(Follow-up change)* A key should not reset on a rolling "24 hours after it failed"
   basis. Instead, **every** key resets at a **fixed clock time — 12:30 PM IST** — matching
   how Gemini's real daily quota actually works (one fixed reset instant, not one per key).
6. When **every** key is exhausted at once, the teacher should see a message stating how
   long until the **soonest** key recovers, and once that time passes, be able to send again
   **automatically** (no manual unlock, no page refresh) — but **not** an automatic resend of
   what they typed; just the send action becoming available again.
7. That "all keys exhausted" experience should cover every Gemini-backed surface: Coach
   chat + attachments, the Generator page, and the Resource Workspace's AI Assist panel. The
   AI Action Router was deliberately left out — see [§6.6](#66-the-ai-action-router-was-left-untouched-on-purpose).

## 3. How it works

### 3.1 The key pool

New module: `server/src/lib/geminiKeyPool.js`, class `GeminiKeyPool`.

- Holds the list of keys and, per key, a single `cooldownUntil` timestamp (`0` = usable now).
- `getKey()` — hands out the next usable key, **round-robin from wherever it left off**
  (so the key right after a failed one is tried next), skipping anything still cooling down.
  If every key is cooling down, it returns whichever recovers soonest.
- `reportFailure(key, error, { retryAfterMs })` — classifies the error
  (`server/src/lib/geminiPolicy.js`'s `classifyGeminiError`) and sets `cooldownUntil`:
  - **Rate-limited (429):** Gemini's own `Retry-After` header wins if present (it's a more
    specific, authoritative instruction for *that* response — e.g. a short per-minute
    limit). Otherwise, cooldown is set to **the next occurrence of 12:30 PM IST**
    (`nextDailyResetAt`, see §3.3) — not a fixed duration from the failure.
  - **Auth (401/403 — bad/revoked key):** a *different* failure mode from quota exhaustion,
    so it stays duration-based: 1 hour by default (`GEMINI_KEY_AUTH_COOLDOWN_MS`), since a
    broken key won't self-heal on any schedule.
  - Network/timeout/5xx errors don't cool a key down at all — they're not key-specific
    problems.
- `reportSuccess(key)` — clears the cooldown.
- `nextAvailableAt()` — the timestamp the **soonest** key recovers (`now()` if one is already
  free). This is what powers the "back in X" message.
- `describe()` — a redacted snapshot (`…last4chars` fingerprints only) for logs/debugging;
  never exposes a raw key.

### 3.2 Wiring it into the request path

`server/src/gemini.js`'s `GeminiService.makeRequest()` (the low-level function that performs
every actual fetch to Gemini — the initial call, every retry, every continuation call) now:

1. Asks the pool for a key before each attempt.
2. On a 429/401/403, tells the pool (`reportFailure`) and — **if another key is free right
   now** — immediately loops back and retries with that key. **No backoff wait, no retry
   budget consumed.** This is what makes the switch invisible to the teacher (see the
   [mid-request Q&A](#71-does-the-teacher-see-anything-while-keys-are-switching-mid-request)
   below for the full walkthrough).
3. Only once **every** key is currently cooling down does it fall back to the pre-existing
   backoff/retry logic, and only after that budget is exhausted does it finally throw —
   which is when a teacher would ever see an error.
4. On that final throw, the error is stamped with `err.retryAt = keyPool.nextAvailableAt()`
   — the soonest any key recovers, at the moment of failure.

`server/src/index.js` builds **one shared `GeminiKeyPool`** at boot from the comma-separated
`GEMINI_API_KEY` list, and passes it into all three `GeminiService` instances (`gemini` /
coach, `geminiFast` / router, `attachmentGemini` / attachments) instead of a raw key string.

### 3.3 The 12:30 PM IST daily reset

New pure helper: `nextDailyResetAt(nowMs, { hour = 12, minute = 30 })` in
`server/src/lib/geminiPolicy.js`. Given the current time, it returns the epoch-ms timestamp
of the next occurrence of that IST clock time — today's, if it hasn't happened yet;
tomorrow's, if it has. IST is a fixed UTC+5:30 offset with no DST, so this is plain
arithmetic, no timezone library needed.

**Consequence of a fixed reset time (vs. the original 24h-per-key idea):** any keys that fail
*before* today's 12:30 PM IST boundary all share the exact same recovery instant — see the
[worked example](#72-least-time-until-any-key-resets-a-worked-example) below. A key retried
right after 12:30 PM that still fails (because Google's real quota hasn't actually reset yet)
simply gets pushed to *tomorrow's* 12:30 PM — the system re-estimates and never gets
permanently stuck.

### 3.4 The "all keys exhausted" response

The three route handlers that map a Gemini failure to an HTTP response —
`server/src/index.js` (`/api/coach`), `server/src/routes/resources.js` and
`server/src/routes/attachments.js` (`sendAiError`) — now add a `retryAt` field (ISO string)
to the existing `429 { error, code: 'RATE_LIMITED', requestId }` body, when the error carries
one. (`attachments.js`'s separate per-user `BUDGET_EXHAUSTED` 429 is untouched — unrelated to
key exhaustion.)

### 3.5 Client UX

- `client/src/api.ts` — `ApiError` now also carries `code` and `retryAt` (parsed from the
  response body), so callers can detect this specific condition.
- `client/src/hooks/useRetryCountdown.ts` — a small hook (mirrors the existing
  `RunStatus.tsx` "re-read `Date.now()` every second, don't accumulate" pattern) that turns a
  `retryAt` timestamp into a live `remainingMs`/`ready` pair.
- `client/src/lib/retryCountdown.ts` — `formatRetryWait()` ("2h 14m" / "45m" / "38s") and
  `retryMessage()` (the one shared sentence used everywhere: *"AI usage limit reached. You
  can try again in …"*).
- **Coach chat + attachments** (`CoachPage.tsx`, `Composer.tsx`, `MessageBubble.tsx`): the
  failed turn shows the live countdown in place of the generic error and hides "Try again"
  until ready; the composer is blocked with an explanatory banner and **auto-unblocks** once
  the countdown ends (the teacher still has to press send themselves — no auto-resend, per
  the [confirmed answer](#4-key-decisions-and-the-answers-that-produced-them)).
- **Generator page** (`GeneratorPage.tsx`): the Generate button disables and shows the
  countdown in place of the generic error banner.
- **Resource Workspace AI Assist** (`ResourceWorkspace.tsx`): bypasses the normal 3.2s
  auto-dismissing toast (far too short for a wait that can be hours) for a persistent inline
  message under "AI Assist", disabling the action buttons until ready.

## 4. Key decisions and the answers that produced them

| Decision | Answer given |
|---|---|
| `.env` format | Single `GEMINI_API_KEY` var, comma-separated (`key1,key2,key3`) — not numbered vars. |
| Rotation scope | One shared pool across coach/router/attachments, not independent per feature. |
| Recovery | Cooldown then automatic retry — never permanently abandon a key. |
| Switching speed | Search for a key that isn't over limit and switch **automatically and fast**, so the teacher never sees an over-limit error. |
| Auto-resume after full exhaustion | **Just re-enable sending** once the countdown ends — no automatic resend of what the teacher typed. |
| Where the "limit reached" message shows | **Reactively**, at the point a request actually fails because every key is on cooldown — not a proactive banner shown before anyone tries anything. |
| Scope of the countdown/auto-resume UX | **All** Gemini-backed features (coach, attachments, Generator, Resource Workspace AI Assist) — not just Coach chat. |
| Reset schedule | Changed from "24 hours after the key's own failure" to a **fixed 12:30 PM IST reset shared by every key** — matching how Gemini's real daily quota resets. |

## 5. Configuration

`server/.env` / `server/.env.example`:

```bash
# One or more keys, comma-separated. A single key works exactly as before.
GEMINI_API_KEY=key_one,key_two,key_three

# Clock time (IST) a rate-limited/quota-exhausted key resets at. Only used
# when Gemini sends no Retry-After header. Default 12:30 PM IST.
GEMINI_KEY_RESET_HOUR_IST=12
GEMINI_KEY_RESET_MINUTE_IST=30

# How long a key sits out after an AUTH failure (401/403 — bad/revoked key).
# A different failure mode from quota exhaustion, so it stays duration-based.
GEMINI_KEY_AUTH_COOLDOWN_MS=3600000
```

## 6. Files changed

**Server**
- `server/src/lib/geminiKeyPool.js` *(new)* — the `GeminiKeyPool` class.
- `server/src/lib/geminiPolicy.js` — added `nextDailyResetAt`.
- `server/src/gemini.js` — `GeminiService` takes a shared `keyPool`; `makeRequest()` rotates
  keys inline and stamps `retryAt` on the final error.
- `server/src/index.js` — parses the comma-separated key list, builds the shared pool,
  wires it into all three `GeminiService` instances, adds `retryAt` to the coach 429 body.
- `server/src/routes/resources.js`, `server/src/routes/attachments.js` — `retryAt` added to
  their `RATE_LIMITED` 429 body.
- `server/.env.example` — documents the new format and env vars.
- Tests: `server/test/lib/geminiKeyPool.test.js` *(new)*, `server/test/gemini.keyRotation.test.js`
  *(new)*, `server/test/lib/geminiPolicy.test.js` (added `nextDailyResetAt` cases),
  `server/test/gemini.reliability.test.js` (one assertion updated for the new `keyRotations`
  metric field).

**Client**
- `client/src/api.ts` — `ApiError` gained `code`/`retryAt`.
- `client/src/hooks/useRetryCountdown.ts` *(new)*.
- `client/src/lib/retryCountdown.ts` *(new)*, plus `client/src/lib/retryCountdown.test.ts`.
- `client/src/types.ts` — `Turn` gained `retryAt?: number`.
- `client/src/pages/CoachPage.tsx`, `client/src/components/Composer.tsx`,
  `client/src/components/MessageBubble.tsx` — coach chat + attachments UX.
- `client/src/pages/GeneratorPage.tsx` — Generator UX.
- `client/src/pages/ResourceWorkspace.tsx` — AI Assist UX.

### 6.6 The AI Action Router was left untouched, on purpose

`assistant/interpret.js` converts *every* failure (including full key-pool exhaustion) into
a 200 `{ passthrough: true }` response by existing design — the router must never show the
teacher an error (an existing, documented guardrail). Since the router shares the same key
pool as Coach, when every key is exhausted the router silently passes through **and** the
teacher's message still reaches Coach's own `/api/coach` call, which fails with the new
`retryAt`-carrying 429 — so the teacher sees the explanation through Coach's existing error
path regardless. No separate handling was needed.

## 7. Q&A (verbatim topics, from this session)

### 7.1 Does the teacher see anything while keys are switching mid-request?

**Q:** *"When we switch between 1st api key to 2nd, does that happen automatically, and
during switching does the teacher see any error? Suppose I wrote a message and in between
only it hit the limit for the 1st api key — then what will happen?"*

**A:** Completely automatic, and the teacher sees nothing as long as at least one other key
still works:

1. The browser sends **one** request to `POST /api/coach` and shows the normal "preparing
   your answer" waiting state — same as any other message.
2. On the server, that one request tries key #1 first; Gemini returns a rate-limit error.
3. The server immediately (no delay, no retry-wait) marks key #1 as cooling down and tries
   the **exact same request again with key #2** — still within that same original request
   the browser is waiting on. Nothing has been sent back to the browser yet.
4. If key #2 succeeds, the server returns a normal 200 with the answer, exactly as if key #1
   had never failed. The browser never made a second request and never saw an error — it
   just waited slightly longer (one extra network round trip, typically well under a second).

The only case where the teacher sees *anything* is if the request fails on **every** key
before one succeeds — that's when the "AI usage limit reached, try again in X" message
appears. A long answer that needs a "continuation" call to finish goes through the exact same
rotation logic for that continuation call too, so a key failing mid-continuation is covered
the same invisible way.

### 7.2 "Least time until any key resets" — a worked example

**Q:** *"Confirm that if all keys get exhausted, the time shown is the least time required by
any of the API keys to reset, and that all keys reset at 12:30 PM IST — explain with an
example."*

**A:** Confirmed. Mechanism: each key's "available again at" timestamp is the next upcoming
12:30 PM IST from the moment *it* failed (today's, if that hasn't happened yet; tomorrow's,
if it has). The message shown is the **minimum** of these timestamps across all keys.
Because every key uses the identical fixed-clock-time rule, keys that fail on the same side
of the boundary end up sharing the *exact same* reset instant — unlike a rolling per-key
cooldown, which would stagger them.

Worked example, 20 keys, starting at **10:00 AM IST**:

| Time (IST) | Event |
|---|---|
| 10:00 AM | Key #1 exhausted → reset time set to **today 12:30 PM** (2h 30m away) |
| 10:30 AM – 12:15 PM | Keys #2–#20 get exhausted one by one as requests keep rotating through them |
| 12:15 PM | Key #20 (the last one) exhausted → its reset time is **also today 12:30 PM**, since 12:15 PM is still before the boundary |
| 12:20 PM | Teacher tries to send a message. All 20 keys share the same reset timestamp. Message shown: **"AI usage limit reached. You can try again in 10m."** |
| 12:30 PM | All 20 keys become available at once — the composer auto-unlocks, no refresh needed |

So the countdown in this run is "10 minutes," not "14 hours" (which is what a rolling
24h-per-key model would have produced from the original hypothetical) — because every key
that failed before the boundary shares it.

**Caveat stated alongside this answer:** 12:30 PM IST is *this app's* assumption about when
Google's quota resets, not something Gemini confirms. If a key is retried right after 12:30
PM and the real quota hasn't actually reset yet, that retry just fails again and the key's
reset time gets pushed to the *next* day's 12:30 PM — self-correcting, never stuck.

## 8. Verification performed

- `cd server && npx vitest run` — full suite passing (2262 of 2262 relevant tests; the same
  9 pre-existing, unrelated failures — missing `exceljs` dependency, seed-data ordering,
  notification-count flakiness — were confirmed present on the unmodified tree too, via
  `git stash`).
- `cd client && npx tsc --noEmit`, `npm run lint`, `npm run test` — clean typecheck, only a
  pre-existing unrelated lint warning, 710+ tests passing.
- **Live manual test** (not just unit tests): started the real server + client, pointed
  `GEMINI_API_KEY` at two fake keys and `GEMINI_ENDPOINT`/`ASSISTANT_GEMINI_ENDPOINT` at a
  small local mock server that always returns 429, and hit the real, running `/api/coach`
  endpoint as the seeded `teacher@example.com` account. Confirmed: the response carried a
  correct `retryAt`; after the cooldown elapsed, the key automatically rejoined rotation and
  produced a fresh `retryAt` on the next failure (proving the cooldown-then-retry mechanism
  end-to-end, not just in tests). All temporary `.env` overrides were backed up before the
  test and restored byte-for-byte afterward (verified with `diff`); all temporary processes
  were stopped and ports confirmed free.
