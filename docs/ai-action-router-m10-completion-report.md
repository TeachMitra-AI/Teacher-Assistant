# M10 — Internal Rollout · Milestone Completion Report

**Date:** 2026-07-29 · **Branch:** `feature/ai-action-router` · **Milestone type:** operational rollout
**Status:** 🟡 **Rollout engineering COMPLETE and rehearsed. Staged exposure OUTSTANDING** — it needs
production access and ~12 calendar days of holds, and nothing in this environment can substitute for it.

> **Read the status line literally.** This report does not claim the rollout happened. It claims the
> rollout is *ready*, that every control it depends on has been exercised against a real server, and
> that the operator has a document to act from. The four staged holds against real teachers — and the
> one number that gates the launch — are recorded here as outstanding.

---

## 1. What this milestone was, and what it deliberately was not

M10 was authorised as a **rollout milestone, not a feature-development milestone**, with eleven owner
rulings (A–K) and five standing constraints. The scope was: expose the AI Action Router to real
teachers in reversible stages, prove the Definition of Done, and leave behind an operable feature.

**Nothing about routing behaviour was touched.** No prompt, no descriptor, no vocabulary, no
threshold, no Gemini integration, no evaluation corpus, no protected area, and no new product
feature. The evidence is the diff.

---

## 2. Files changed

**Documentation only. Zero application-code changes, zero new environment variables, zero new tests.**

| File | Change |
|---|---|
| `docs/ai-action-router-rollout-runbook.md` | **NEW** — the operational artifact |
| `docs/AI_ACTION_ROUTER_README.md` | §1 snapshot · progress basis · §8 roadmap · §9 progress log (appended) · §10 status · §11 M10 checklist · §12 risk row · §14 **Tier 0 added** · §17 index · §18 handoff |
| `docs/ai-action-router-phase1-spec.md` | §9 M10 row · §11 DoD **amended** (decisions C and E) · post-approval corrections table |
| `docs/ai-action-router-security-review.md` | §7 residual risk updated — F5 dispositioned, F6 closed, prune verified, breaker thresholds carried into the watchlist |
| `server/evals/README.md` | Per-stage live-run cadence and the quota-contention rule |
| `README.md` (root) | Operating a feature-flagged rollout: kill switch, staged exposure, metrics, retention, runbook pointer |

```
git status --short   →   5 modified .md files + 1 new .md file, and nothing else
```

`client/tsconfig.tsbuildinfo` was restored after the build, as at every previous milestone.

---

## 3. Verification

### 3.1 Pre-flight, on the M9 tree

| Check | Result |
|---|---|
| Server suite, **three consecutive runs** | **1133 tests / 46 files**, all passing, no flakiness |
| Client suite | **333 tests / 16 files**, passing |
| Server lint · client lint | Clean · clean |
| Client build | Clean. Bundle `index-CdDgI2Zg.js` **282.72 kB gzip** — M0 pre-feature baseline 276.32 kB ⇒ **+6.40 kB against a 15 kB budget** |
| Replay eval gate | Green. **5/5 safety gates PASS**; precision 96.9%, recall 89.6%, Hinglish 95.5% |
| Migrations added by the feature | **Zero** (`git diff main...HEAD -- server/prisma/` empty) |
| Protected client pages | **Exactly two** files (`CoachPage`, `GeneratorPage`) — protected area #14 |
| Existing server tests | **Additions only** — no existing test file modified |
| Protected server files | `gemini.js`, `prompts.js`, `inputGuard.js`, `outputGuard.js`, `routes/auth.js`, `middleware/auth.js`, `schema.prisma` — **none modified** |

### 3.2 Post-change (documentation-only)

Server **1133 / 1133** · client **333 / 333** · both lints clean. Unchanged, as expected from a
documentation diff — and checked rather than assumed.

---

## 4. The rollout controls, rehearsed against a real server

Every stage configuration was driven against a **real server on a spare port**, with flags passed as
**process environment** — `server/.env` was never edited. **16/16 gate checks passed**, and all but
one spent **zero model calls**.

| # | Rehearsed | Result |
|---|---|---|
| 1 | Stage 0 — catalog inert for an in-ring teacher | `catalogVersion 0`, no actions, HTTP 200 |
| 2 | Stage 0 — `/interpret` with the master flag off | `passthrough: true`, `reason: disabled`, **no model call** |
| 3 | Stage 1 — in-ring teacher exposed | `catalogVersion 1`, both actions |
| 4 | Stage 1 — out-of-ring teacher excluded | `catalogVersion 0`, no actions |
| 5 | Stage 1 — out-of-ring `/interpret` | `disabled` **before any model call** |
| 6 | Stage 1 — `super_admin` inside the ring school | **Excluded** — the role gate holds |
| 7 | Stage 1 — catalog projection | No `paramSchema` / `requiredRoles` / `featureFlag` / `autoExecute` (G6) |
| 8 | Per-action flag — `generate_assessment` off | Catalog carries `open_generator` **only**; routing continues |
| 9 | Stage 2 — two ring schools in, a third out | ✅ |
| 10 | Stage 3 — **the empty-list trap, demonstrated** | An empty `ASSISTANT_ALLOWED_SCHOOL_CODES` exposes **every** school |
| 11 | Stage 3 — role gate at full exposure | `super_admin` still excluded |
| 12 | **Tier 0** — retreat one ring | RAMPUR01 stays in, RAMPUR02 out. **365 ms** |
| 13 | **Tier 1** — kill switch | Inert. **515 ms** from flip to the first `disabled` response |
| 14 | **Live routing, Stage 1 configuration** | `decision: prefill`, effect `draft`, **6 params**, 1 693 ms, `calls: 1` |
| 15 | Live decision log | Ids, counts, enums, latency — **no utterance, no slot value** (G11) |
| 16 | Live response body | **No teacher text** outside `params` |

⚠️ **These timings are from a developer machine.** Production has a different process manager and a
different restart path. **Tier 0 and Tier 1 must be re-timed during Stage 0** and the runbook's
numbers replaced with what is observed.

---

## 5. Operational tooling

**Retention prune — verified against a copy of a real database, not a fixture.** The copy carried 19
institutional rows (`ai_safety_flag`, `user_approved`, `ai_rate_limit_exhausted`) and 3 assistant
rows, two of them past the 90-day cutoff.

| Step | Result |
|---|---|
| `--dry-run` | "Rows to delete **2**", nothing deleted |
| Real run | **Deleted 2** — exactly the two out-of-window `assistant_*` rows |
| After | The recent assistant row survived; **all 19 institutional rows survived** |
| Cleanup | The throwaway database was deleted. `prisma/dev.db` was never written to |

**Metrics — exercised, and its honest failure mode confirmed.** `npm run assistant:metrics` reports
`FIELD-EDIT RATE  n/a (no prefills delivered)`. That is correct behaviour, not a defect: a rate over
an empty denominator is undefined, and printing `0.0%` would look like a perfect score in exactly the
situation with no evidence at all. **The first production reading will look the same until real
teachers arrive** — reading it as success is the mistake the script is written to prevent.

---

## 6. Definition of Done — status against the amended criteria

Two criteria were amended by owner decision, both recorded in the spec's post-approval corrections
table rather than quietly re-scored.

| Group | Status |
|---|---|
| **Functional** | ✅ Delivered and verified at M3/M6, re-confirmed live here (prefill with 6 params, effect `draft`) |
| **Quality** | ✅ Suite unmodified and green ×3 · policy proven by exhaustive enumeration · every passthrough reason covered · client pure-logic tests · eval baseline recorded (**precision 96.9% ≥ 90%, recall 89.6% ≥ 75%**) · lint/build/CI green. ⏳ **Manual script by someone who did not write the code** — Stage 2. ⏳ **Production field-edit rate < 20% — the launch gate (decision C)** |
| **Safety** | ✅ All descriptors `autoExecute: false`, validated at startup · nothing above `draft` · fabricated ids → passthrough · catalog projection clean (re-verified here) · no utterance text in logs or `Event` rows · emergency short-circuit verified · limiters on `/interpret` **and** `/resources/generate` · per-user budget enforced · security review signed off |
| **Operations** | ✅ Tier 0 and Tier 1 rehearsed and timed · breaker verified at M9 · watchlist defined against signals that already exist · field-edit rate computable · **prune verified**. ⏳ Kill switch **re-timed in production during Stage 0** (decision E) · monitoring cadence *run* daily through the holds · prune **scheduled** on the platform (decision I) |
| **Documentation** | ✅ README, spec, security review, evals README, root README · `.env.example` complete both sides · runbook written |
| **"Nothing changed" proofs** | ✅ Flags off ⇒ catalog inert and `/interpret` passthrough, observed · **zero migrations** · no file outside the permitted list touched · deletability performed at M9 (M0 bundle hash and 413-test count reproduced exactly) |

**Amendment C (the launch criterion).** Grade-slot accuracy stands at ~20% against an original ≥85%
criterion. It cannot be raised by anything inside a rollout milestone — every lever is a prompt,
descriptor or model change, all forbidden here — so the criterion was **replaced, not dropped**: the
launch gate is the production field-edit rate, and grade-slot accuracy is carried as recorded quality
debt owned by the post-rollout tuning milestone. The debt is not waived: if `grade` is what teachers
actually correct, the < 20% gate holds the rollout and `correctionsByField` names the culprit.

**Amendment E (staging).** "Kill switch verified in staging" was unsatisfiable — there is no staging
environment. Stage 0 is a production environment with the feature switched off, which is a stronger
place to time it.

---

## 7. Outstanding work — what production access is for

| # | Outstanding | Why it cannot be done here |
|---|---|---|
| 1 | Merge to `main`; deploy the client (built with `VITE_ASSISTANT_ENABLED=true`) and the server (all assistant flags off) | Platform credentials, a deploy window |
| 2 | **Stage 0 · 2-day hold** — Coach baseline, PWA propagation measured, Tier 0/1 re-timed, "nothing changed" trace | Real users, real clients, real time |
| 3 | **Stage 1 · 3-day hold** — first real model spend; breaker thresholds meet real quota pressure | Real traffic |
| 4 | **Stage 2 · 7-day hold** — first teachers who did not build it; the manual script run by one of them | Real teachers |
| 5 | **Stage 3** — all schools, by *deleting* the school list. An approved action, never a cleanup | Owner approval at the time |
| 6 | **The production field-edit rate** | A teacher correcting a real prefill. No engineering can manufacture it |
| 7 | Prune scheduled on the platform scheduler | The platform |
| 8 | Daily watchlist review through every hold | Elapsed time |

**Sequence:** merge → deploy → Stage 0 → Stage 1 → Stage 2 → Stage 3, per the runbook. The §21 gate
runs per stage as ruled in approval K: code review once (at the merge PR — no code changes between
stages), production verification per stage, a stage report per stage, and a final report at
completion.

---

## 8. Residual risks

| # | Risk | Disposition |
|---|---|---|
| 1 | **The rollout's own evidence is still local.** Every control was exercised on a developer machine | Stage 0 exists to convert it. Re-time Tier 0/1, re-take the trace, measure PWA propagation |
| 2 | **Grade-slot accuracy ~20%** | Recorded quality debt (amendment C). The field-edit gate is what would catch it in the wild |
| 3 | **Breaker thresholds reasoned, not measured** | Stage 1 is the first real evidence; levers named in the runbook |
| 4 | **F5 — English-only emergency short-circuit** | Accepted for the rollout (decision B); assigned to a separate follow-up milestone. Safety holds; the zero-latency guarantee does not for Hindi/Hinglish |
| 5 | **Budget is process-local (F3)** | Accepted (D25). **Revisit before the deployment becomes multi-instance, not after** — now stated in the root README too |
| 6 | **IP-keyed limiters (F4) meet whole schools at Stage 3** | Watchlist items 7–8, with the two env levers |
| 7 | **Nothing schedules the prune yet** | Verified but unscheduled; a production step (decision I). Until then the table grows |
| 8 | **No APM, no alerting, static `/api/health`** (audit DO4/DO5) | Out of scope by decision J. Monitoring is a person reading a watchlist daily — **an unmonitored hold does not count as a hold** |

---

## 9. Deferred — must not start with M10

By owner decision, and listed so none of it is absorbed silently:

- **D4** routing temperature (needs the protected `gemini.js`)
- **D5** descriptor `examples` — the only untried lever for slot extraction, and now the
  evidence-backed one
- **GF-6** the `open_generator` / `generate_assessment` boundary — a product decision, best informed
  by production `correctionsByField`
- **Grade-slot accuracy** debt
- **F5** emergency-detection widening — its own milestone, its own corpus, its own false-positive
  analysis
- Postgres migration · multi-instance budget redesign · Sentry/APM · CD, staging, smoke tests ·
  deep health check · dependency scanning · IaC · response caching · eval variance band · client
  `disabled`-catalog short-circuit · Phase 2 actions · auto-generation graduation

---

## 10. Next milestone

**None until the rollout is executed.** The immediate next action is production execution of
Stages 0–3 from the [Rollout Runbook](./ai-action-router-rollout-runbook.md), with a stage report
after each hold and a final report at completion.

**Post-rollout tuning does not begin as part of M10.**
