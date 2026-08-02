# Release Notes — AI Action Router, Phase 1

**Release:** AI Action Router (Phase 1 — Generator only)
**Branch:** `feature/ai-action-router` → `main` · **Prepared:** 2026-07-29
**Milestones covered:** M0 – M10 · **Status:** verified, awaiting merge and staged rollout

> **What ships here is switched off.** Every gate defaults to off, so a deployment that
> configures nothing runs a completely inert assistant. Exposure is a separate, staged
> operation — see [the rollout runbook](docs/ai-action-router-rollout-runbook.md).

---

## What this release adds

A teacher types *"Generate a Class 5 fractions worksheet"* into the AI Coach composer. The
application understands the intent, opens the Quiz & Worksheet Generator, and pre-fills the form.
**The teacher reviews and clicks Generate themselves.**

The router never generates, saves, or deletes anything. Every failure — timeout, model error,
budget, breaker, safety block, or a bug — degrades to a normal coaching answer rather than an error.
The guiding rule of the whole design: **the model proposes, the application disposes.**

The durable asset is not the AI. It is the **Capability Registry** — a machine-readable description
of what the application can do, with what parameters, under what permissions — which is useful with
zero AI and is why it was built first.

---

## Milestones

### M0 — Contract freeze & scaffolding
Wire contracts frozen on both sides and made executable (`server/src/assistant/contracts.js`,
`client/src/assistant/types.ts`, shared test fixtures), folder scaffolding, `.env.example` on both
sides, and the three planning documents persisted into `docs/`. **All feature flags defined and
defaulting to off.** 44 new tests; client bundle growth **0 bytes**.

### M1 — Schema extraction (pure refactor)
`generateAssessmentSchema` moved to `server/src/actions/schemas/`, shared field bounds to
`server/src/lib/resourceFields.js`. Exactly **one definition repo-wide** — the route now imports what
the capability descriptor references, so the two can never drift. Acceptance criterion was the
regression itself: `resources.test.js` passed **70/70 unmodified**.

### M2 — Registry + catalog endpoint
The Capability Registry, two action descriptors (`generate_assessment`, `open_generator`), and
`GET /api/assistant/catalog` — role-filtered and versioned. Startup validation checks
descriptor↔schema agreement in **both** directions and refuses to boot on a violation. Drift guards
went live and were proven to detect injected drift. `index.js` **+29 / −0**.

### M3 — Draft store + Generator prefill (no AI)
Client draft store (TTL, eviction, fail-soft on disabled storage), the Generator prefill seam,
provenance banner and per-field markers, and Undo ("Clear AI fields"). Prefill travels by **opaque
handle, never in a URL**. A client test runner (Vitest + jsdom) was introduced alongside its first
real tests. Bundle **+1.79 kB gzip**.

### M4 — Vocabulary + resolver + policy (pure modules)
Grade / subject / language mappers, the slot resolver (`utterance > memory > profile > default`,
with provenance), and the decision policy. **The policy is proven by exhaustive enumeration of its
complete 288-combination input space**, not by sampled coverage. 257 new tests. Zero production
callers at this point, verified by module-graph inspection.

### M5 — Classifier + `/interpret` (dark)
A second Gemini instance (`geminiFast`) tuned for a 5-second routing budget — **`gemini.js` itself
untouched** — with the classifier prompt and response schema **derived from the registry**, the full
12-stage pipeline, and `POST /api/assistant/interpret`. Verified against live Gemini. Two real
defects were exposed by injected-defect proofs and fixed: an unreachable guard, and a **500 in the
rollout gate** that has been fail-closed ever since.

### M6 — Client wiring
The precision-first intent gate, repeat cache, typed session memory, client circuit breaker, catalog
cache, `RouterProvider`, a **registry-driven** `ActionExecutor`, the handler map, and Coach
integration with inline clarification chips. 242 new client tests (312 total); **server untouched**;
bundle **+5.2 kB gzip**; 12/12 injected-defect proofs detected; a 20-step manual script executed
against live Gemini.

### M7a — Evaluation corpus, harness, baseline (measurement only)
**196 labelled turns** across 8 strata and three languages (English, Hinglish, Devanagari Hindi), a
record/replay harness at the existing `fetchImpl` seam (**zero production files modified**), and a
deterministic offline replay gate in CI. Baseline frozen with model version and prompt/descriptor/
registry hashes. Seven recurring failure classes recorded. **Nothing was tuned.**

### M7b — Tuning + re-measure
Four candidates measured, **one accepted**: free-text slots bounded in the response schema, derived
from the registry. Routing precision **95.8% → 96.9%**, recall **85.8% → 89.6%**, hallucination
**0** on every slot, all five safety gates pass. Three candidates were **rejected on evidence** and
recorded with their numbers. Grade-slot extraction did not improve — carried forward as recorded
quality debt.

### M8 — Telemetry
Two deliberately separate channels: **structured stdout** for every routing decision (high volume,
zero database cost) and **`Event` rows only** for prefill-delivered and its outcome — **at most two
rows per routed session**, proven at both the client and the endpoint. Added
`POST /api/assistant/events`. The `generated` outcome is observed from outside, adding **zero lines**
to the protected generation path. 90-day retention with a correctly-scoped prune script, plus a
metrics script that computes the launch metric. The suite found and closed a real privacy hole and a
real transport bug during the milestone.

### M9 — Hardening
Per-user daily budget (spends **no model call** when exhausted), the **router-yields-to-Coach circuit
breaker** so routing can never starve coaching, a rate limiter on the previously unprotected
`POST /api/resources/generate`, and a per-user bound on telemetry writes.
**Security review against the threat model, executed as an attack**: nine findings, all
dispositioned, two real defects fixed — a request-body fragment reaching the log (with a 5xx from
`/interpret`) and an unbounded telemetry write path. Log audit run with positive controls.
**Deletability performed**: the deleted build reproduced the pre-feature bundle hash and its
413-test count exactly. Kill switch timed at 4 seconds.

### M10 — Rollout preparation
An operational milestone with **zero application-code changes**. Every stage configuration — dark,
team ring, pilot ring, all schools, per-action withdrawal, ring retreat, kill switch — was rehearsed
against a real server (**16/16 gate checks**, all but one spending zero model calls), the retention
prune was verified against a copy of a real database, and the
[rollout runbook](docs/ai-action-router-rollout-runbook.md) was written for whoever is on call.
A new **Tier 0** rollback (retreat one rollout ring) joined the rollback tiers.

---

## Security

- **Destructive actions are structurally unreachable from text.** Effect class is declared by the
  registry, never by the model; raising a descriptor above `draft` **prevents the server from
  booting**.
- **The model never emits a route, an identifier, or a decision.** Action ids are re-verified against
  the role-filtered catalog *after* parsing; the untrusted proposal boundary is `.strict()`, so a
  model that adds a field has the whole proposal rejected.
- **No new authorization surface.** Existing `requireRole` / owner-scoping / 404-for-not-yours are
  consumed, never re-implemented. A teacher's classifier prompt never contains admin actions.
- **`/api/assistant/interpret` returns no 5xx** — auth, malformed envelope and rate limiting only;
  everything else is a 200 with `passthrough`.
- **Nine security findings** reviewed and dispositioned; two fixed, four accepted with reasons, two
  deferred with justification, one recorded as a strength. Two of the fixes protect **every**
  endpoint, not just the assistant's.
- **Emergency detection is never bypassed** — the classifier is not called on an emergency-flagged
  utterance. *(Known limitation: the short-circuit matches English only; safety holds in every
  language, the zero-latency guarantee does not. Assigned to a follow-up milestone.)*

## Privacy

- **No teacher-authored text is ever logged, stored, or placed in a URL.** Decision logs carry ids,
  counts, closed enums and latencies; telemetry rows carry registry action ids, UUIDs, integer
  counts and field **names**.
- Enforced structurally rather than by convention: telemetry metadata is built from an explicit key
  list, field names are validated against the registry, and every wire field is a closed enum or a
  bounded identifier. A length bound is deliberately **not** treated as a privacy control.
- Verified by attack, with positive controls, and re-verified against a live browser session:
  **zero teacher-text fragments** in logs or stored rows.
- Session memory is a **typed slot store on the teacher's own device**, never a chat transcript, and
  is cleared by "New chat". Drafts live in `sessionStorage` and die with the tab.

## Telemetry

- Field-edit rate — the share of pre-filled fields a teacher corrects — is computable end to end via
  `npm run assistant:metrics`, with corrections broken down by field and by provenance.
- At most **two** `Event` rows per routed session, bounded at both the client and the server.
- 90-day retention via `npm run assistant:prune-events`, scoped so it **cannot** reach safety-flag or
  user-approval records.

## Reliability & cost

Per-user daily budget · per-IP limiters on the assistant endpoints and on the generation endpoint ·
a global circuit breaker that pauses routing under upstream rate-limiting while the Coach continues ·
client-side breaker, repeat cache and a stale-response guard.

## Rollout

Six independent flag layers, all defaulting off. Staged exposure — **dark → team → pilot school →
all teachers** — controlled entirely server-side, with the client built once. Kill switch
(`ASSISTANT_ENABLED=false` + restart) is the single incident control and takes effect in seconds.
Rollback tiers 0–4 are documented and rehearsed.

---

## Compatibility and rollback

| Property | Value |
|---|---|
| **Database migrations** | **Zero.** Rollback is a flag flip, not a schema change |
| **New runtime dependencies** | **None** |
| **Breaking changes** | **None.** Every existing capability remains reachable without AI |
| **Client bundle** | 282.72 kB gzip — **+6.40 kB** against a 15 kB budget |
| **Tests** | **1133 server** (46 files) · **333 client** (16 files) |
| **Deletability** | Verified: the deleted build reproduces the pre-feature bundle hash and test count exactly |

## Known limitations at release

1. **Grade-slot extraction (~19%)** is below the original corpus target; the launch gate is now the
   production field-edit rate (< 20%), with grade accuracy carried as quality debt for the
   post-rollout tuning milestone.
2. **Emergency short-circuit matches English only** — safety holds, the zero-latency guarantee does
   not for Hindi/Hinglish.
3. **The daily budget counter is process-local** — it resets on restart and must be redesigned before
   the deployment becomes multi-instance.
4. **Rate limiters are IP-keyed**, so a school behind one NAT shares a bucket; the operator lever is
   documented.
5. **Retention pruning is not yet scheduled** — a production step during rollout.

## Documentation

[Living project document](docs/AI_ACTION_ROUTER_README.md) ·
[Architecture](docs/ai-action-router-architecture.md) ·
[Phase 1 specification](docs/ai-action-router-phase1-spec.md) ·
[Guardrails](docs/ai-action-router-guardrails.md) ·
[Security review](docs/ai-action-router-security-review.md) ·
[Rollout runbook](docs/ai-action-router-rollout-runbook.md) ·
[M10 completion report](docs/ai-action-router-m10-completion-report.md)

Operator-facing configuration is documented in `server/.env.example` and `client/.env.example`.
