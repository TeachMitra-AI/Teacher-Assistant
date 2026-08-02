# AI Action Router — Rollout Runbook (Milestone M10)

**Status:** Live · **Created:** 2026-07-29 · **Applies to:** Phase 1 (Generator only)
**Audience:** whoever is on call for the Teacher Assistant production deployment — *not* necessarily
whoever built the feature.

> **This is the operational document.** The [living README](./AI_ACTION_ROUTER_README.md) explains
> why the system is built the way it is; this file tells you what to type. If the two ever disagree
> about a flag name or a default, the README and `server/.env.example` win and this file is wrong —
> fix it.

---

## 0. If something is wrong right now

**Turn the feature off. It costs nothing and it is designed to be used.**

```bash
# On the API host / platform dashboard:
ASSISTANT_ENABLED=false
# then restart the process
```

Every teacher immediately gets normal AI Coach answers instead of routing. Nothing is lost: the
router creates no data anything else reads, drafts live in `sessionStorage`, and telemetry rows are
write-only. **Measured locally at 0.5 s from restart to inert; the target is < 60 s.**

Do **not**, as an incident response: rebuild the client, revert commits, or edit code. See §6.

---

## 1. What this feature is, in five lines

A teacher types "Generate a Class 5 fractions worksheet" into the AI Coach composer. The server
classifies the message, resolves the slots against the app's own vocabulary, and returns a
*proposal*. The client navigates to the Generator and pre-fills the form. **The teacher reviews and
clicks Generate themselves — the router never generates, saves, or deletes anything.** Every failure
(timeout, model error, budget, breaker, safety block, bug) degrades to a normal coaching answer.

---

## 2. The control surface

Three endpoints, all under `/api/assistant/`: `catalog` (what the app can do), `interpret` (a
message in, a decision out), `events` (telemetry in). All three sit behind the same rollout gate.

| Layer | Variable | Effective in | Use it for |
|---|---|---|---|
| 0 | `ASSISTANT_ALLOWED_SCHOOL_CODES` | restart | **Advancing or retreating a rollout ring** |
| 1 | `ASSISTANT_ENABLED` | restart | **The kill switch. The only incident control** |
| 2 | `ASSISTANT_ACTION_GENERATE_ASSESSMENT`, `ASSISTANT_ACTION_OPEN_GENERATOR` | restart | Withdrawing one capability without stopping routing |
| 3 | `ASSISTANT_ALLOWED_ROLES` | restart | Leave at `teacher`. See §3.3 |
| 4 | `ASSISTANT_DAILY_BUDGET_PER_USER`, `ASSISTANT_RATE_LIMIT_MAX_REQUESTS`, `RESOURCE_GENERATE_RATE_LIMIT_MAX`, `ASSISTANT_BREAKER_*` | restart | Cost and availability tuning, under evidence |
| 5 | `VITE_ASSISTANT_ENABLED` (client build) | **client rebuild + PWA propagation — not deterministic** | Deployed **once** at Stage 0 and never touched again during the rollout |

> **Why layer 5 is not a lever.** The client is a PWA with `registerType: 'autoUpdate'`. A rebuilt
> client reaches an already-loaded browser on some later page load, not on a schedule you control.
> Anything that must take effect *now* is a server-side change.

Flags are read **per request**, so a restart is the whole procedure — there is no cache to clear and
no deploy to wait for.

---

## 3. The stages

### 3.1 Flag matrix

| Variable | Stage 0 · Dark | Stage 1 · Team | Stage 2 · Pilot | Stage 3 · All |
|---|---|---|---|---|
| `ASSISTANT_ENABLED` | `false` | `true` | `true` | `true` |
| `ASSISTANT_ACTION_GENERATE_ASSESSMENT` | `false` | `true` | `true` | `true` |
| `ASSISTANT_ACTION_OPEN_GENERATOR` | `false` | `true` | `true` | `true` |
| `ASSISTANT_ALLOWED_ROLES` | `teacher` | `teacher` | `teacher` | `teacher` |
| `ASSISTANT_ALLOWED_SCHOOL_CODES` | *(empty)* | `<TEAM>` | `<TEAM>,<PILOT>` | *(empty)* |
| Client `VITE_ASSISTANT_ENABLED` | `true` | `true` | `true` | `true` |
| Hold before advancing | 2 days | 3 days | 7 days | — |

School codes are the values in `School.code` (e.g. `RAMPUR01`), **not** school names or IDs.

### 3.2 ⚠️ The empty-list trap

**`ASSISTANT_ALLOWED_SCHOOL_CODES` empty means EVERY school.** It is a filter, not a gate;
`ASSISTANT_ENABLED` is the gate.

Consequences to hold in your head:

- At **Stage 0** the list is empty and that is safe — only because `ASSISTANT_ENABLED=false`.
- Setting `ASSISTANT_ENABLED=true` while the list is still empty **jumps straight to Stage 3.**
- Advancing from Stage 2 to Stage 3 is *deleting a value* — exactly the edit that happens by
  accident. **Stage 3 is an approved action, never a cleanup.**

**Before any restart that sets `ASSISTANT_ENABLED=true`, read the school list out loud.**

### 3.3 Roles stay at `teacher`

Do not onboard the team by adding `school_admin` or `super_admin` to `ASSISTANT_ALLOWED_ROLES`. That
changes catalog role-filtering for a population the evaluation corpus never covered. Use
teacher-role accounts in the ring school instead. Verified: a `super_admin` inside the ring school
is correctly excluded at every stage, including Stage 3.

### 3.4 Advancing a stage

1. Confirm the previous stage's exit criteria (§8) against **written** evidence, not impressions.
2. Get the owner's approval to advance, and record it.
3. Write the retreat command for the *new* stage before applying it.
4. Have a second person read the env diff (§3.2).
5. Apply, restart, and immediately run the smoke check (§4).
6. Record the time of the restart — it resets the daily budget counters and the breaker (§7.3).

---

## 4. Smoke check after any flag change

Two commands. A teacher account inside the ring, and one outside it.

```bash
# 1. Inside the ring — expect catalogVersion > 0 and both action ids.
curl -s -H "Authorization: Bearer $IN_RING_TOKEN"  https://<api>/api/assistant/catalog

# 2. Outside the ring — expect catalogVersion 0 and an empty actions array.
curl -s -H "Authorization: Bearer $OUT_RING_TOKEN" https://<api>/api/assistant/catalog
```

`catalog` uses the **same rollout predicate** as `interpret`, so it answers "who is exposed right
now?" without spending a single model call. That is the cheapest true signal available; prefer it
to reasoning about the env file.

A fuller per-stage production verification list lives in the M10 plan and in README §11.

---

## 5. Monitoring

Observability here is structured stdout plus two read-only scripts. There is no APM and no alerting
system (see the [engineering audit](./enterprise-engineering-audit.md), DO4/DO5) — **the watchlist
below is reviewed by a person, daily, during every hold.** An unmonitored hold does not count as a
hold.

### 5.1 What the logs contain

One line per routing decision, metadata only — **never** the teacher's words:

```
[assistant] interpret_completed { requestId, decision, actionId, confidence, margin, calls,
                                  missingCount, lowConfidenceCount, contradictionCount,
                                  droppedSlots, latencyMs }
[assistant] interpret_completed { requestId, decision: 'passthrough', reason,
                                  breakerOpen?, internalError?, latencyMs? }
[assistant] interpret_misconfigured  { requestId }      ← wiring bug; routing is running unguarded
[assistant] telemetry_budget_exhausted { requestId }    ← a looping or hostile client
[assistant] telemetry_batch_received { requestId, received, written, failed }
```

The nine `reason` values: `not_an_action`, `low_confidence`, `disabled`, `classifier_timeout`,
`classifier_error`, `safety_blocked`, `invalid_proposal`, `budget_exhausted`, `emergency_detected`.
**None of them is an error the teacher sees** — every one produces a normal coaching answer.

### 5.2 The daily watchlist

| # | Signal | Where | Threshold → action |
|---|---|---|---|
| 1 | **5xx from `/interpret`** | access log | **Any.** Contract violation (G22) *and* it opens client breakers. Investigate today; kill switch if unresolved within the hold |
| 2 | **Coach error rate / p95 latency** | access log | Degraded vs the Stage 0 baseline → **kill switch immediately**. The router must never cost the Coach anything |
| 3 | **Field-edit rate** | `npm run assistant:metrics` | **≥ 20% → do not widen** |
| 4 | Passthrough mix by `reason` | decision log | `classifier_error` > 5% or `classifier_timeout` > 10% of routed turns → investigate |
| 5 | `breakerOpen: true` | decision log | Any occurrence → record it. A pattern means the thresholds are wrong; retune via env (§7.2) |
| 6 | `latencyMs` p50/p95 | decision log | p95 near 5 000 ms → teachers are waiting; consider narrowing the ring |
| 7 | 429s on `/api/assistant/*` | access log | Rising → raise `ASSISTANT_RATE_LIMIT_MAX_REQUESTS` (§7.1) |
| 8 | 429s on `/api/resources/generate` | access log | Rising → raise `RESOURCE_GENERATE_RATE_LIMIT_MAX` |
| 9 | `budget_exhausted` | decision log | A legitimate teacher hitting 100/day → investigate before raising |
| 10 | `Event` row count / DB size | §5.4 query | Growth beyond ≈2 rows per routed session → the client ceiling is broken |
| 11 | `telemetry_budget_exhausted` | decision log | Should be ~zero |
| 12 | **Privacy spot-audit** | logs | Grep for a phrase you typed in the smoke test. Any hit → **security incident + kill switch** |

### 5.3 The launch-gate number

```bash
cd server
npm run assistant:metrics                      # last 90 days, all schools
npm run assistant:metrics -- --days 1          # yesterday
npm run assistant:metrics -- --days 7 --school RAMPUR01   # one ring
```

`FIELD-EDIT RATE` is the share of pre-filled fields a teacher changed before generating. **Launch
gate: < 20%.** (Sustained < 15% is the separate, much later gate for auto-generation — not this
rollout's business.)

`correctionsByField` / `correctionsBySource` are the diagnostic half: corrections concentrated in
`utterance` mean the classifier is misreading teachers; corrections concentrated in `profile` or
`default` mean the defaults are stale. Those need opposite fixes and the headline rate cannot tell
them apart. **Record both — they are the input to the future tuning milestone, not something to act
on during the rollout.**

### 5.4 Event volume

```bash
cd server
node -e "const {prisma}=require('./src/lib/db');prisma.event.groupBy({by:['type'],_count:{_all:true}}).then(r=>{console.table(r);return prisma.\$disconnect()})"
```

Expect at most **two** `assistant_*` rows per routed session (one delivery, one outcome).

### 5.5 Two ways to misread the numbers

- **`n/a` is not 0%.** The metrics script prints `n/a` when nothing was delivered, on purpose — a
  rate over an empty denominator is undefined, and "0.0%" would look like a perfect score in exactly
  the situation where there is no evidence at all.
- **Every restart resets the daily budget counters and the breaker** — they live in process memory
  (decision D25, no migration). Numbers spanning a deploy are not comparable. Note restart times
  next to the metrics you record.

---

## 6. Rollback

| Tier | Action | Time | Removes | When |
|---|---|---|---|---|
| **0** | Remove a school code from `ASSISTANT_ALLOWED_SCHOOL_CODES` + restart | < 60 s *(0.4 s measured locally)* | One ring's exposure | A stage misbehaves; the feature is fine elsewhere |
| **1** | `ASSISTANT_ENABLED=false` + restart | < 60 s *(0.5 s measured locally, 4 s at M9)* | All routing behaviour | **Any incident** |
| 2 | Tier 1 + rebuild the client with `VITE_ASSISTANT_ENABLED=false` + redeploy | ⚠️ not deterministic (PWA) | Client code paths | Planned withdrawal only — **never an incident response** |
| 3 | Revert the assistant commits | ~1 hr | The code | Abandoning the feature |
| 4 | Delete `assistant/` + `actions/`, revert modified files | ~2 hr | Everything except the M1 schema extraction | Abandoning the feature |

**Tier 0 first, Tier 1 second, and stop there.** Tiers 2–4 exist to prove the feature is cheap to
abandon; they are not incident tools.

### 6.1 Four things a revert must NOT take with it

If Tier 3 or Tier 4 is ever executed, keep these — each is a standalone improvement or a landmine:

1. **`ASSISTANT_GEMINI_ENDPOINT` in `server/.env.example`** — the pinned predecessor
   (`gemini-2.5-flash-lite`) returns 404 "no longer available to new users". Reverting restores a
   dead value that would make every routing call fail and look like a router bug.
2. **The fail-closed rollout gate in `server/src/routes/assistant.js`** — a database error must
   never read as "permission granted". Reverting re-introduces a 500 from `/api/assistant/catalog`.
3. **The limiter on `POST /api/resources/generate` in `server/src/index.js`** — the most expensive
   path in the product, which had no limiter at all before M9. It is deliberately **not**
   flag-gated: it protects generation with the assistant switched off.
4. **The malformed-JSON branch in the global error handler** — stops a fragment of any request body
   reaching the log on **every** endpoint, and returns the 400 the body parser already intended.

### 6.2 Incident procedure

1. Confirm the symptom in the access log or the decision log. Do not act on a report alone.
2. **Is the Coach affected?** → Tier 1 now, diagnose after.
3. **Is it confined to one ring?** → Tier 0.
4. Otherwise → Tier 1, diagnose after.
5. Record: time observed · time acted · time to effect · symptom · action · evidence.
6. **Do not fix by editing code during an incident.** If a fix requires touching a protected area or
   a database migration, stop the rollout and escalate — that is a design defect, not an ops event.

---

## 7. Accepted risks and their levers

These were reviewed and accepted with reasons (see the [security review](./ai-action-router-security-review.md)).
They are listed here so an operator meets them with a lever in hand rather than as a surprise.

### 7.1 Shared rate-limit buckets (F4, and the assistant limiter)

Both limiters are keyed by **IP**, so a school behind one NAT shares a bucket:
`ASSISTANT_RATE_LIMIT_MAX_REQUESTS` (default 120 / 15 min) and `RESOURCE_GENERATE_RATE_LIMIT_MAX`
(default 30 / 15 min). A busy staff room can trip either.

**A 429 from `/interpret` also trips the client's circuit breaker for 60 seconds**, so the symptom is
"routing quietly stopped for that school for a minute" — teachers still get coaching answers.
**Lever:** raise the relevant maximum. Watch this before Stage 3, when whole schools arrive at once.

### 7.2 Breaker thresholds are reasoned, not measured (M9 residual)

`ASSISTANT_BREAKER_429_THRESHOLD=5` in `ASSISTANT_BREAKER_WINDOW_MS=60000`, cooldown
`ASSISTANT_BREAKER_COOLDOWN_MS=300000`. While open, routing spends no model calls and `/api/coach`
is untouched — that is the point: the router yields to the Coach under quota pressure.

The breaker is **global, not per tenant** (F7, by design): the quota it protects is global too.
**Stage 1 is the first real evidence.** If it opens under normal traffic, the thresholds are wrong —
retune via env, and record the numbers.

### 7.3 The daily budget is per process and resets on restart (F3)

`ASSISTANT_DAILY_BUDGET_PER_USER=100`. The counter lives in memory, exactly like the rate limiters
that have backed `/api/coach` since before this project. **Revisit trigger — before, not after:** if
this deployment ever becomes multi-instance, the effective ceiling becomes (limit × instances) and
the control must be redesigned first.

### 7.4 Emergency detection is English-only (F5)

`detectEmergency` matches English phrasings. An emergency written in Hindi or Hinglish still reaches
the Coach and is still never routed into a worksheet form — **the safety outcome holds** — but it
does not get the zero-latency short-circuit, so the teacher waits for the classifier first.

This predates the router (the same gap exists on `/api/coach` today), the fix touches a protected
safety file, and it is **accepted for the duration of M10 and assigned to a separate follow-up
milestone**. No operator action.

### 7.5 Budget map eviction (F8)

Above 10 000 tracked users, the least-recently-used entries are evicted and those users get a fresh
budget. Deliberate: a teacher wrongly *denied* routing is worse than one wrongly allowed thirty more
classifications, and an unbounded map is a memory-growth vector.

---

## 8. Stage entry and exit criteria

### Entry (every stage)

- [ ] Previous stage's exit criteria met, in writing
- [ ] Owner approval to advance, recorded
- [ ] Env diff read by a second person (§3.2)
- [ ] Retreat command written down before the change is applied
- [ ] Smoke check (§4) green immediately after the restart

### Exit (every stage)

- [ ] No 5xx from `/interpret` for the whole hold
- [ ] Coach error rate and p95 latency not degraded vs the Stage 0 baseline
- [ ] Field-edit rate **< 20%** (from Stage 1 onward, where prefills exist)
- [ ] No teacher text in any log, `Event` row, or URL (spot-audited)
- [ ] `Event` rows ≤ 2 per routed session
- [ ] No unplanned rollback during the hold
- [ ] Watchlist reviewed **daily**, with the numbers written down
- [ ] Stage report written

### Do-not-widen triggers

Field-edit rate ≥ 20% · `classifier_error` > 5% · `classifier_timeout` > 10% · repeated breaker
openings under normal traffic · legitimate teachers exhausting the daily budget · rising 429s from
NAT'd schools · **any day of the hold where the watchlist was not actually reviewed**.

### Not a failure

A high passthrough rate. Passthrough is the designed degradation: the teacher gets a coaching
answer. It is a quality signal to record, never a reason to roll back on its own.

---

## 9. Scheduled work

### 9.1 Telemetry retention — **must be scheduled once the feature is enabled**

```bash
cd server
npm run assistant:prune-events -- --dry-run    # always look first
npm run assistant:prune-events                 # deletes assistant_* rows older than 90 days
npm run assistant:prune-events -- --days 30    # override for one run
```

Schedule it **weekly** on the platform's scheduler (preferred) or an external cron. There is
deliberately no in-process sweeper: pruning inside a request would put DELETEs on the single-writer
SQLite path this design works hard to keep quiet.

**Verified 2026-07-29** against a throwaway copy of a real database: with 19 non-assistant rows
(`ai_safety_flag`, `user_approved`, `ai_rate_limit_exhausted`) and 3 assistant rows present, the
script deleted **exactly the 2 assistant rows older than the cutoff** and touched nothing else. The
`--dry-run` count matched the real run exactly. The script **cannot** reach safety-flag or
user-approval rows: its type scope is a hardcoded two-element list.

### 9.2 Evaluation runs — and why they must not run during a hold

The router and the Coach share one Gemini quota (free tier: 500 requests/day for the routing model).
A full live corpus pass costs ~200 calls and, unpaced, will trip the CHANGE-8 breaker — pausing
routing **for every tenant**.

**Never run a live eval during a stage's teaching hours.**

| Gate | Run |
|---|---|
| Before any deploy | `npm run eval:replay` — offline, free, deterministic. Must be green |
| Before Stage 1 | `npm run eval -- --half dev` — live, ~100 calls, outside teaching hours |
| Before Stage 2 | replay only, unless something changed |
| Before Stage 3 | one full live pass, recorded, compared to the frozen reference via `evals/compare.js` |

A green replay run proves the **code** still turns the same model output into the same decisions. It
is not evidence that the router is good. Only a live run measures the model.

---

## 10. Rehearsal evidence (2026-07-29, local)

Every stage configuration in §3.1 was driven against a real server on a spare port, with flags
passed as process environment — `server/.env` was never edited. **16/16 gate checks passed**, and
all but one spent **zero** model calls.

| Rehearsed | Result |
|---|---|
| Stage 0 — catalog inert, `/interpret` → `disabled` | ✅ `catalogVersion 0`, no actions, HTTP 200 |
| Stage 1 — in-ring teacher exposed | ✅ `catalogVersion 1`, both actions |
| Stage 1 — out-of-ring teacher excluded | ✅ `catalogVersion 0`, and `/interpret` spent no model call |
| Stage 1 — `super_admin` inside the ring school excluded | ✅ role gate holds |
| Stage 1 — catalog leaks no internals | ✅ no `paramSchema` / `requiredRoles` / `featureFlag` / `autoExecute` |
| Stage 1 — **live routing end to end** | ✅ `prefill`, effect `draft`, 6 params, 1 693 ms, 1 upstream call |
| Per-action flag — `generate_assessment` off | ✅ catalog carries `open_generator` only |
| Stage 2 — two ring schools in, a third out | ✅ |
| Stage 3 — empty list exposes every school | ✅ **the trap, demonstrated** — and the role gate still holds |
| Tier 0 — retreat one ring | ✅ RAMPUR01 stays in, RAMPUR02 out; 365 ms |
| Tier 1 — kill switch | ✅ inert; **515 ms** from flip to the first `disabled` response |

⚠️ **These are local timings on a developer machine.** Production has a different process manager,
a different restart path, and network latency in front of it. **Re-measure Tier 0 and Tier 1 in
production during Stage 0** and replace the numbers in §6 with what you observe.

---

## 11. Related documents

| Document | Use it for |
|---|---|
| [`AI_ACTION_ROUTER_README.md`](./AI_ACTION_ROUTER_README.md) | Project state, decisions, milestones, protected areas — the source of truth |
| [`ai-action-router-architecture.md`](./ai-action-router-architecture.md) | Why the design is shaped this way; §10 is the threat model |
| [`ai-action-router-phase1-spec.md`](./ai-action-router-phase1-spec.md) | API contracts, §11 Definition of Done |
| [`ai-action-router-guardrails.md`](./ai-action-router-guardrails.md) | G1–G28, the invariants |
| [`ai-action-router-security-review.md`](./ai-action-router-security-review.md) | Findings F1–F9 and their dispositions |
| `server/.env.example` | The authoritative description of every variable named here |
| `server/evals/README.md` | Eval modes, quota, pacing |
