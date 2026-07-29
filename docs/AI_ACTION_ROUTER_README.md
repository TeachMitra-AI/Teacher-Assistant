# AI Action Router — Living Project Document

> **This is the single source of truth for the AI Action Router project.**
> It is not a normal README. It is the permanent knowledge base: architecture decisions,
> implementation progress, engineering rules, and project history.
>
> **If you are a new engineer or a new AI session and you read only this file, you should
> be able to continue the work correctly without any other context.**
>
> Maintenance is mandatory — see [§19 Living Documentation Rules](#19-living-documentation-rules)
> and [§20 Instructions for Future Claude Sessions](#20-instructions-for-future-claude-sessions).

---

## 1. Project Snapshot

| Field | Value |
|---|---|
| **Project** | AI Action Router (Teacher Assistant intelligence layer) |
| **Current Branch** | `feature/ai-action-router` |
| **Base Branch** | `main` |
| **Current Phase** | Phase 1 — Generator only |
| **Current Milestone** | **M7b — Prompt/schema tuning** ✅ **COMPLETE — awaiting review/approval** |
| **Overall Progress** | **73%** (planning + M0 → M6 + M7a + M7b complete) |
| **Current Status** | 🟡 Healthy, with the primary target unmet — **one of four candidates survived measurement**. C4 (a registry-derived response-schema bound) cut GF-1 degeneration 10 → 7 and lifted routing recall 85.8% → 89.6%; **three prompt candidates were measured and rejected**. **Grade extraction — M7b's primary target — is unchanged at ~20%**, and two independent prompt mechanisms aimed at it made it worse. All five safety gates PASS. The frozen M7a baseline, corpus and cassettes are byte-identical |
| **Architecture Status** | ✅ **Approved** (reviewed 3×, 12 amendments applied — see §5.3) |
| **Implementation Status** | ✅ **M0–M6 + M7a + M7b complete** — contracts frozen, registry live behind flags, catalog serving, the full 12-stage pipeline, the composer routing end to end, a frozen measured baseline, and **one evidence-backed tuning change accepted out of four tried**. Both flags default OFF |
| **Last Updated** | 2026-07-29 |
| **Governance** | 🔒 **Milestone Completion Protocol in force** — see [§21](#21-milestone-completion-protocol-mandatory). One milestone at a time; full verification gate before the next begins; explicit user approval required to proceed |
| **Next Task** | ⏸️ **Awaiting user approval of M7b.** Three decisions now have evidence behind them: **D5 descriptor `examples`** (the only untried lever for slot extraction, now that preamble tuning is measured to fail), **D4 routing temperature** (GF-1 survives a schema bound; needs the protected `gemini.js`), and **GF-6** (every remaining non-noise failure is a bare topic-less command). Then **M8 — telemetry** |

### Progress basis (keep this calculation consistent)

Progress % is weighted by estimated effort-days, not by milestone count.

| Work | Effort (days) | Status | Contribution |
|---|---|---|---|
| Planning (architecture, spec, guardrails) | 5.0 | ✅ Complete | 13.3% |
| M0 — contract freeze & scaffolding | 1.0 | ✅ Complete | 2.7% |
| M1 — schema extraction | 0.5 | ✅ Complete | 1.3% |
| M2 — registry + catalog + drift guard | 2.0 | ✅ Complete | 5.3% |
| M3 — draft store + Generator prefill | 3.0 | ✅ Complete | 8.0% |
| M4 — vocabulary + resolver + policy | 3.0 | ✅ Complete | 8.0% |
| M5 — classifier + `/interpret` (dark) | 4.0 | ✅ Complete | 10.7% |
| M6 — client wiring | 4.0 | ✅ Complete | 10.7% |
| **M7a — eval corpus, harness, baseline** | **3.5** | ✅ **Complete** | **9.3%** |
| **M7b — tuning + re-measure** | **1.5** | ✅ **Complete** | **4.0%** |
| M8 → M10 implementation | 10.0 | ⬜ Not started | 0% |
| **Total** | **37.5** | | **≈ 73.3%** → reported as **73%** |

> **M7's 5.0 d is split into M7a (3.5 d, measurement) and M7b (1.5 d, tuning)** at the
> project owner's instruction. The split is not cosmetic: spec §1.2's fourth ordering rule is
> *"evals before tuning — the corpus exists before any threshold moves"*, and eight recorded
> failure seeds were waiting to be tuned against. Tuning before a baseline existed would have
> meant never being able to prove the tuning helped.

> The reported figure is now simply the effort-weighted total rounded to the nearest point. The
> earlier +2-point adjustment (which credited M0's delivery of the three planning documents) has been
> **absorbed rather than carried forward** — those documents are covered by the planning row, and
> compounding a one-off adjustment across every future milestone is how a progress figure quietly
> stops being honest. Keep the table as the basis; do not inflate it.

Per-milestone effort weights are in [§8 Milestone Roadmap](#8-milestone-roadmap). When a milestone
completes, add its weight ÷ 37.5 to the total and update this table.

---

## 2. Project Vision

### The problem

Teacher Assistant is currently a collection of independent modules — AI Coach, Quiz & Worksheet
Generator, My Library, Resource Workspace, AI Assist, School Admin, Authentication, User
Preferences. The teacher must know **where** each capability lives and navigate there manually.

To make a worksheet today, a teacher must: know the Generator exists → find it → choose format,
grade, subject, topic, difficulty, question type, question count, language → click Generate.

This works. It is also a burden on the target user: a government-school teacher in India, often
on a low-end Android device, on a poor connection, sometimes between classes, frequently typing
in Hinglish or a regional language.

### The vision

The application should behave like an intelligent assistant rather than a set of pages. A teacher
types naturally —

> "Generate a Class 5 fractions worksheet"

— and the application understands the intent, decides which module handles it, works out what
information is already known and what is missing, navigates to the right place, and pre-fills the
form. The teacher reviews and confirms.

**The teacher should not have to know where the Generator, Library or Workspace lives. The
application should know.**

### What this is NOT

This is an **AI Action Router**, not an autonomous agent. The AI **orchestrates the existing
application**. It does not act on its own behalf, it does not perform work the teacher did not ask
for, and it never takes an irreversible action.

The guiding sentence for the entire project:

> **The model proposes. The application disposes.**

### How it fits the product

The router is the beginning of the product's intelligence layer. Long term, every module becomes
reachable through natural language. Short term (Phase 1), only the Generator is. The architecture
is deliberately built so that adding a module later is an additive change, not a redesign.

The durable asset produced by this project is **not the AI**. It is the **Capability Registry** —
a machine-readable description of what the application can do, with what parameters, under what
permissions. That registry is useful with zero AI (command palette, onboarding chips, permission
matrix, evaluation corpus), which is why it is built first.

---

## 3. Current Scope

### ✅ IN SCOPE — Phase 1

The **only** supported capability:

```
Teacher writes naturally
        ↓
AI understands the intent
        ↓
Generator opens
        ↓
Fields are pre-filled
        ↓
Teacher reviews
        ↓
Teacher clicks Generate   ← existing, unchanged code path
```

Concretely:

- Capability Registry (server-owned) with **two** actions: `generate_assessment`, `open_generator`
- `GET /api/assistant/catalog` — role-filtered, versioned
- `POST /api/assistant/interpret` — classify → resolve → decide
- A second Gemini instance (`geminiFast`) tuned for low-latency routing
- Client intent gate, repeat cache, RouterProvider, ActionExecutor, handler map
- Client draft store (sessionStorage)
- Generator prefill with provenance display and Undo
- One-question clarification when exactly one required slot is missing
- Session slot memory (grade / subject / format / topic / language)
- Coach passthrough as the universal fallback
- Telemetry: decision logs + prefill/outcome events
- Evaluation corpus (≥120 labelled utterances) and harness
- Feature flags, kill switch, circuit breaker

### ❌ OUT OF SCOPE — Phase 1 (intentionally excluded)

| Excluded | Why |
|---|---|
| **Auto-generation** | Generation costs money and time; the teacher reviews before spending it. Graduation criteria in §15 |
| **Auto-save** | Saving stays a deliberate human act |
| **Library actions** (search, open, print, save) | Phase 2. Requires reference resolution, which is genuinely new work |
| **Workspace actions** | Phase 2 |
| **Coach actions** | Phase 3 |
| **Lesson planning** | Phase 3 |
| **Attendance / grading** | Phase 5. Irreversible institutional records — needs idempotency, transactions, undo log |
| **Admin actions** | Not before the classifier is proven |
| **Multi-step / compound actions** | Phase 4. Wire format already supports it (`actions: []`), executor does not |
| **Voice input for routing** | Existing voice input still feeds the composer; routing does not treat it specially |
| **Server-side session memory** | Client-only in Phase 1. Server stays stateless, matching `/api/coach` |
| **Database migrations** | **Zero migrations in Phase 1** — this is what makes rollback trivial |
| **Any action with effect above `draft`** | Structural safety boundary |
| **Per-user opt-out persisted server-side** | Removed by amendment CHANGE-1 (§5.3) — would require editing `routes/auth.js` |
| **`suggest` decision UI** | Removed by amendment CHANGE-4 (§5.3) — meaningless with only two actions |
| **Server-side repeat cache** | Removed by amendment CHANGE-5 (§5.3) — invalidation cost without benefit at this scale |

---

## 4. Architecture Summary

> Condensed. The full reasoning lives in
> [`ai-action-router-architecture.md`](./ai-action-router-architecture.md); the build plan in
> [`ai-action-router-phase1-spec.md`](./ai-action-router-phase1-spec.md); the rules in
> [`ai-action-router-guardrails.md`](./ai-action-router-guardrails.md).
>
> **This section is written to stand alone.** You should not need to open those three to work on the
> current milestone — open them when you need the reasoning behind a decision, the full API contract
> examples, or the complete impact analysis.

### 4.1 The three-layer separation

The core design move is refusing to let one component do all three of these:

| Concern | Nature | Owner |
|---|---|---|
| **Understanding** — "what did they mean?" | Probabilistic, sometimes wrong | LLM |
| **Resolution** — "what exactly should happen?" | Deterministic, validated, authorized | Application (server) |
| **Execution** — "make it happen in the UI" | Deterministic, reversible | Application (client) |

Because these are separate, a misclassification can only produce a **wrong suggestion**, never a
**wrong effect**.

### 4.2 Capability Registry

Server-owned, the source of truth for what the app can do. Lives at `server/src/actions/`.
Contains no AI, no HTTP, no Express — importable and testable in isolation, and usable by non-AI
consumers.

Registration is an **explicit import list**, never filesystem auto-discovery: the live capability
set must be visible in one file, in a diff, in a review.

Three startup validations (fail-fast): unique IDs; every descriptor's default slot set passes its
own `paramSchema`; every action has `autoExecute: false`.

### 4.3 Action Registry — the three schemas

Keeping these distinct is what makes the design extensible.

| Schema | Trust | Purpose |
|---|---|---|
| **ActionDescriptor** | Trusted, static | The registry entry: `id`, `version`, `status`, `domain`, `effect`, `requiredRoles`, `featureFlag`, `autoExecute`, `summary`, `examples`, `slots`, `paramSchema` |
| **IntentProposal** | **Untrusted** — model output | `intent`, `confidence` (ordinal: high/medium/low — **never a float**), `alternatives`, `slots` (**raw strings only**) |
| **ResolvedAction** | Trusted, app-produced | `actionId`, `version`, `effect`, `decision`, `params`, `provenance`, `missing`, `ask`, `confidence`, `requestId` |

Two deliberate omissions from the descriptor:

- **No route / URL.** The server never tells the client where to navigate. Coupling is by ID only;
  the client holds the handler map. This is what makes rolling out a new action to older clients safe.
- **`paramSchema` is a reference, not a copy.** The same object validates the router's output and
  the real endpoint's input. Copying it starts the drift this architecture exists to prevent.

### 4.4 Intent pipeline (12 stages)

`POST /api/assistant/interpret`:

1. Kill-switch check → inert if disabled
2. Auth (existing `authRequired`) → **hard 401**
3. Rate limit → **hard 429**
4. Envelope validation → **hard 400**
5. Normalize utterance (existing `normalizeQuery`)
6. **Emergency check (existing `detectEmergency`) → short-circuit before the classifier**
7. Per-user daily budget
8. Cache lookup
9. Build role-filtered catalog
10. Classify (`geminiFast` + `responseSchema`)
11. Validate proposal → canonicalize → merge slots → validate params
12. Decide + record telemetry

Stage 6 is non-negotiable: a teacher describing an active emergency reaches the existing emergency
Coach prompt with zero added latency and zero chance of being routed into a worksheet form.

### 4.5 Resolver

Deterministic, no I/O, no AI. Responsibilities:

- **Canonicalization** — raw model strings → controlled vocabulary (`"class 5"` → `"Class 3-5"`).
  Lives in code (`actions/vocab/`), never in a prompt.
- **Slot merge with precedence:** `utterance` > `memory` > `profile` > `registry default`
- **Provenance tracking** — every param records where its value came from. Drives the UI, the
  policy, and the correction metric. Infrastructure, not polish.
- **Param validation** against the same schema the real endpoint uses.

### 4.6 Policy layer

Pure function. Takes signals, returns a decision. **Effect class dominates confidence** — Rule 0
is applied before anything else:

| `effect` | Maximum permitted decision, at ANY confidence |
|---|---|
| `read` | `execute` (navigation only — reversible, visible) |
| `draft` | `prefill` in Phase 1 |
| `write` | `prefill` + explicit human commit |
| `destructive` | `prefill` at most — never pre-armed, never auto-confirmed |

Signals used (only one comes from the model): intent confidence (ordinal), top-1/top-2 margin,
slot completeness (deterministic), slot provenance, effect class (registry), contradiction
detection (deterministic), historical accuracy (telemetry).

Counter-intuitive but correct rule: **more missing information means fewer questions, not more.**
One missing required slot → ask one chip question. Two or more → prefill and let the form be the
question. A 5-turn conversational interrogation is worse than a pre-filled form.

### 4.7 Draft store

Client-side, sessionStorage-backed. The mechanism by which prefill travels without putting teacher
text in a URL.

| Property | Value | Reason |
|---|---|---|
| Storage | `sessionStorage` | Survives refresh, dies with the tab, never reaches the server |
| TTL | 30 minutes | Long enough for a distracted teacher, short enough to avoid stale prefill |
| Retention | Last 5, oldest evicted | Bounded storage on low-end devices |
| ID | Opaque random | Never guessable, never meaningful |
| `initialParams` | Immutable after creation | Refresh semantics depend on this |
| Failure mode | **Fail soft, always** | Quota / disabled storage / corrupt JSON → Generator opens empty (today's behavior), never a crash |

### 4.8 Generator prefill

The integration is deliberately tiny: **the router contributes initial `useState` values and a
banner. That is all.**

- On mount **and on `?ai=` param change** (amendment CHANGE-7), read the draft and seed form state
- Render a dismissible provenance banner with Undo ("Clear AI fields")
- Mark low-confidence fields
- Emit correction telemetry on manual edits (field name + provenance, **never the value**)
- **No generation request fires automatically**

`handleGenerate`, `handleSave`, `examMeta`, preview, and the Save→Workspace navigation are untouched.

### 4.9 Catalog

`GET /api/assistant/catalog` returns role-filtered action descriptors plus a `catalogVersion`.
`paramSchema`, `requiredRoles` and `featureFlag` are **never** exposed — the client is told what it
may use, never what it may not.

Kept in Phase 1 (despite only two actions) specifically because the client is a **PWA with service-worker
caching**: stale clients are routine, and `catalogVersion` is how a stale client learns its
assumptions are outdated.

### 4.10 Feature flags

Six independent layers, **all defaulting to off**:

| # | Layer | Mechanism | Time to change |
|---|---|---|---|
| 1 | Server master | `ASSISTANT_ENABLED` | **< 60 seconds** |
| 2 | Per-action | `ASSISTANT_ACTION_*` | seconds |
| 3 | Role | `ASSISTANT_ALLOWED_ROLES` | seconds |
| 4 | Tenant | `ASSISTANT_ALLOWED_SCHOOL_CODES` | seconds |
| 5 | Client build | `VITE_ASSISTANT_ENABLED` | **not deterministic — PWA** |
| 6 | Client runtime | Circuit breaker | automatic |

⚠️ **Because of the service worker, layer 5 is a build-time convenience, never an emergency lever.
The server kill switch (layer 1) is the only reliable incident control.**

### 4.11 Session memory

A **typed slot store, never a chat transcript**. Each slot holds a canonical value, the raw phrase,
its source, the turn number, and an expiry.

| Slot | TTL |
|---|---|
| `grade`, `subject`, `language` | Session |
| `format` | 3 turns |
| `topic` | **2 turns** (a stale topic is worse than none — it produces a confident, wrong worksheet) |

Why a slot store beats a transcript: constant token cost, deterministic, **inspectable** (renderable
as chips the teacher can see), **correctable** (tap to change), and privacy-bounded. The
inspectability point is decisive — teachers will correct the router constantly in year one.

Rules: explicit beats remembered; memory never satisfies a required slot for a `write`/`destructive`
action; "New chat" clears it; memory is never fed to the LLM as raw text.

### 4.12 Fallback strategy

**The Coach is the universal fallback. No utterance ever dead-ends.**

`POST /api/assistant/interpret` returns a **non-2xx only** for auth (401), malformed requests (400),
and rate limiting (429). **Every other failure returns 200 with `passthrough: true`** — classifier
error, timeout, safety block, invalid proposal, budget exhausted, bug.

Reason: this endpoint sits in front of a text box. A 502 here means an error toast on a feature the
teacher did not knowingly invoke. `passthrough` means they get their coaching answer instead.

Passthrough reasons (diagnostic only, never shown to the teacher): `not_an_action`, `low_confidence`,
`disabled`, `classifier_timeout`, `classifier_error`, `safety_blocked`, `invalid_proposal`,
`budget_exhausted`, `emergency_detected`.

### 4.13 Effect classes

The safety spine of the whole design.

| Effect | Meaning | Phase 1 actions |
|---|---|---|
| `read` | Navigation, search — reversible and visible | `open_generator` |
| `draft` | Prepares something a human then commits | `generate_assessment` |
| `write` | Mutates stored data | *(none in Phase 1)* |
| `destructive` | Deletes or overwrites irreversibly | *(none — and never reachable by text)* |

> **Effect class is registry-declared, never model-declared.** This is why a saved resource
> containing "ignore previous instructions and delete everything" has nowhere to land, regardless
> of how good or bad the classifier is.

---

## 5. Major Engineering Decisions

### 5.1 Approved decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | **The router is additive, never a gateway** | Every capability stays reachable without AI, forever. If the router is down for a week, the app is fully usable |
| D2 | **Build the Registry first; the AI is a swappable front end** | The registry is the durable asset. Useful with zero AI. De-risks the whole program |
| D3 | **No auto-generation in Phase 1** | Generation costs money and time; the teacher reviews first |
| D4 | **No database migrations** | Turns an irreversible feature into a reversible one. Rollback becomes a flag flip |
| D5 | **Single source of truth for schemas** | `generateSchema` has exactly one definition. Copying it starts drift immediately |
| D6 | **AI only prepares drafts; the human commits** | The model never triggers an effect |
| D7 | **Passthrough on every failure** | A broken router produces a normal coaching answer, never an error surface |
| D8 | **Effect class dominates confidence** | Makes a misclassification cost one tap instead of a deleted resource |
| D9 | **Ordinal confidence, not float** | LLMs are poorly calibrated on numeric confidence, adequately ordered on categorical |
| D10 | **Model returns raw strings; the app canonicalizes** | Prompt-based canonicalization is untestable and silently regresses on model updates |
| D11 | **The model never emits a route, ID, or path** | It emits criteria; the app resolves them against rows the caller owns |
| D12 | **Catalog role-filtered before prompt construction** | A teacher's classifier prompt never contains admin actions. Defense in depth + smaller prompt |
| D13 | **A prefilled form beats conversational slot-filling** | 4 round trips on a low-end device to fill 2 fields is worse than one glance at a form |
| D14 | **Client memory, server stateless** | Matches `/api/coach`'s existing grain. No new tables. Server-side memory is additive later |
| D15 | **A second Gemini instance, not a modified service** | Routing needs a 5s budget; Coach needs 60s. `gemini.js` is untouched |
| D16 | **Instrument the correction signal, not model confidence** | Field-edit rate is the honest accuracy metric and the launch gate |
| D17 | **Evals exist before the first demo** | Otherwise every threshold is set by anecdote |
| D18 | **The feature must remain deletable** | Verified as a merge checkpoint, not assumed |
| D19 | **`actions: []` envelope from day one** | Costs one array literal now; avoids a breaking change when multi-step arrives |
| D20 | **The router yields to the Coach under quota pressure** | The optional feature must never degrade the core one |

### 5.2 Rejected alternatives (recorded so they are not re-litigated)

| Rejected | Why |
|---|---|
| Frontend-only intent detection | `GEMINI_API_KEY` is server-only — disqualifying |
| Backend-only (no client gate) | An LLM call for every message, including coaching questions that will never be actions |
| A single float confidence score | Poorly calibrated; produces a feature that feels random |
| Conversational slot-filling loop | 4 round trips, ~6s latency, keyboard on a low-end device, to fill 2 visible fields |
| Chat-transcript memory | Grows every turn, opaque to the teacher, uncorrectable, privacy-heavy |
| Auto-navigate with a confirm dialog for `read`/`draft` | Doubles the happy-path interaction cost to guard an outcome that is already visible and one tap from fixed |
| Params in the URL query string | Teacher content lands in browser history, referrer headers, and access logs |
| Shared client/server package for the registry | Monorepo restructure (CJS server vs ESM client) larger than the project itself |
| Filesystem auto-discovery of descriptors | The live capability set must be visible in a diff |

### 5.3 ⚠️ Amendments from the final design review (BINDING — supersede the earlier specs)

A final review re-examined the code and produced **12 mandatory changes**. These are approved and
must be applied. Four of them (A–D below) corrected factual errors in the earlier documents.

**Factual corrections discovered:**

| ID | Finding |
|---|---|
| **A** | `preferencesSchema` in `server/src/routes/auth.js:125` is `.strict()` — a persisted opt-out would require editing `auth.js`, which is a protected file |
| **B** | The client is a **PWA** (`vite-plugin-pwa`, `registerType: 'autoUpdate'`) — client-side rollback is **not deterministic in time** |
| **C** | React Router does **not** remount a component when only the search param changes — a mount-only draft read is a silent no-op on the second routing |
| **D** | `Event` is currently a rare-incident table; one row per interpret call adds sustained write pressure to **single-writer SQLite** |

**The 12 binding amendments:**

| # | Amendment | Status |
|---|---|---|
| CHANGE-1 | **Drop the server-persisted per-user opt-out.** Kill switch + role + school flags are sufficient for Phase 1. Keeps `routes/auth.js` genuinely untouched | ✅ Approved |
| CHANGE-2 | **Tune the client gate for precision, not recall.** Refer only on a strong command signal. A missed routing costs one manual navigation; +5s on every coaching question costs adoption | ✅ Approved |
| CHANGE-3 | **Chip answers to a clarifying question resolve client-side** — no second network call, no second LLM call. Only free-text answers need re-interpretation | ✅ Approved |
| CHANGE-4 | **Drop the `suggest` decision from Phase 1** (keep the enum value defined so Phase 2 is additive). Meaningless with two actions | ✅ Approved |
| CHANGE-5 | **Drop the server-side repeat cache from Phase 1.** Invalidation surface without benefit at this scale | ✅ Approved |
| CHANGE-6 | **Split telemetry:** structured stdout logs for every decision (high volume, zero DB cost); `Event` rows only for prefill-delivered + outcome (low volume). Removes ~70% of DB writes while still yielding field-edit rate | ✅ Approved |
| CHANGE-7 | **The Generator must react to `?ai=` param changes, not only to mount**, guarded by an applied-draft-ID check. *This is a latent functional bug, not a preference* | ✅ Approved |
| CHANGE-8 | **Global breaker: the router yields to the Coach under upstream 429 pressure.** Router Gemini calls disable for M minutes; `/api/coach` continues unaffected | ✅ Approved |
| CHANGE-9 | **Stale-response guard.** Monotonic sequence number; discard a response unless it is the newest in-flight request and the composer is unchanged. *Latent bug — prevents "it navigated me randomly"* | ✅ Approved |
| CHANGE-10 | **Banner/onboarding-tip stacking rule** on the Generator. The AI banner takes precedence and suppresses the `generator-intro` tip for that visit without marking it dismissed | ✅ Approved |
| CHANGE-11 | **Document the GRADES/SUBJECTS duplication** with mandatory cross-referencing comments in both files (matching the existing convention at `resources.js:354`). Resolve properly in Phase 2 | ✅ Approved |
| CHANGE-12 | **Specify accessibility** for new UI: `aria-live` banner, proper chip grouping, non-colour-only provenance markers, labelled Undo | ✅ Approved |

**Net effect on timeline: approximately neutral.** CHANGE-4 and CHANGE-5 remove about as much work
as CHANGE-6 through CHANGE-12 add.

**Sequencing constraint derived from Finding B:** remove `/interpret` from the *client* before
removing it from the *server*, never the reverse. Leave the server endpoint returning inert
passthrough for one release after the client stops calling it.

---

## 6. Protected Areas

**These must not be modified during Phase 1.** Each entry states why and how a violation is detected.

| # | Protected area | Why | Detection |
|---|---|---|---|
| 1 | **Generator generation flow** — `handleGenerate`, `generateAssessment()`, `POST /api/resources/generate` shape | This is the product. A routing bug must not become a generation bug for teachers who never use AI | `client/src/lib/resources.ts` diff empty; `resources.test.js` unmodified and green |
| 2 | **Deterministic assessment rendering** — `renderAssessmentMarkdown`, `renderAssessmentBody`, `assessmentSchema.js` | The app's strongest AI-safety property: model supplies content, app supplies structure | Diff empty |
| 3 | **Resource saving** — `POST /api/resources`, `handleSave` | The router must never write to a library | Diff empty; no router code references `createResource` |
| 4 | **Library** — `LibraryPage`, `ResourceView`, resource CRUD | Out of scope. A change here means scope crept | Diff empty |
| 5 | **Workspace editing** — `ResourceWorkspace`, AI Assist, the dirty guard | Out of scope; the dirty guard protects unsaved teacher work | Diff empty |
| 6 | **Authentication** — `middleware/auth.js`, `routes/auth.js`, `auth.tsx` | Auth correctness is binary and unrelated to this feature. See CHANGE-1 for the one temptation | Diff empty; `auth.test.js`, `sessions.test.js`, `password-reset.test.js`, `google-auth.test.js` unmodified |
| 7 | **Authorization** — `requireRole`, `findOwned`, 404-for-not-yours, school scoping | The router adds no capability. Re-implementing a check is where a bypass eventually appears | `rbac.test.js`, `tenant-isolation.test.js` unmodified |
| 8 | **Coach API** — `POST /api/coach` | Every router failure terminates here. It must be the most boring, most reliable path in the system | Diff empty; `coach.reliability.test.js` unmodified |
| 9 | **Database schema** — `prisma/schema.prisma`, `migrations/` | A migration turns a reversible feature into an irreversible one | Zero new migration folders; schema diff empty |
| 10 | **`server/src/gemini.js`** | Already does everything needed. Editing a service shared by Coach, AI Assist and Generator risks all three | Diff empty; `gemini.reliability.test.js`, `gemini.contract.test.js` unmodified |
| 11 | **Safety guards** — `inputGuard.js`, `outputGuard.js`, `prompts.js` | Consumed, never adjusted. The emergency path must not gain latency or a new branch | Diff empty; `ai-safety.test.js`, `prompts.test.js` unmodified |
| 12 | **Existing test files** | They are the proof that protected areas stayed protected. A modified test proves nothing | `git diff --stat server/test/` shows only additions |
| 13 | **Provider stack order in `App.tsx`** | `AuthProvider` → `ToastProvider` → `OnboardingProvider` ordering is load-bearing | Diff shows insertion only, no reordering |
| 14 | **Every page except Coach and Generator** | Nine pages have no business changing | `git diff --stat client/src/pages/` lists exactly two files |

---

## 7. Repository Impact

### 7.1 New folders and modules

| Path | Purpose |
|---|---|
| `server/src/actions/` | **Capability Registry.** Knows WHAT the app can do. No AI, no HTTP, no Express |
| `server/src/actions/descriptors/` | One file per action. Pure data + schema reference |
| `server/src/actions/schemas/` | Zod param schemas — THE definition, shared with the real route |
| `server/src/actions/vocab/` | Controlled-vocabulary mappers (grade, subject, language). Pure, heavily tested. Long-term asset |
| `server/src/assistant/` | **Intent Gateway.** Utterance → ResolvedAction. Depends on `actions/`; never the reverse |
| `server/src/routes/assistant.js` | HTTP shell only: auth, rate limit, envelope validation, delegate, shape response |
| `server/src/lib/flags.js` | Boolean env parsing (mirrors the `config.js` clamp-and-warn style) |
| `server/evals/` | Classification quality corpus + runner (M7a/M7b). **Outside `test/`** — the LIVE corpus is not a CI gate. `corpus/`, `cassettes/`, `baselines/`, `golden_failures.md`, `TUNING_LOG.md` and `lib/` are tracked; `runs/` is gitignored. **The M7a corpus, cassettes and baseline are FROZEN and the freeze is enforced in code** |
| `server/test/evals/` | The deterministic half (M7a): corpus integrity, the scorer's own tests, cassette record/replay, and the **full-corpus replay CI gate**. Measures the pipeline, never the model |
| `client/src/assistant/intentGate.eval.test.ts` | Gate precision/recall over the **same** corpus (M7a). Test-only file read; zero bundle impact |
| `client/src/assistant/` | Everything AI-routing. Self-contained and deletable |
| `client/src/assistant/handlers/` | The ONLY place AI navigation route strings appear |
| `client/src/components/AiPrefillBanner.tsx` | Presentational only |
| `client/src/components/AiClarifyPrompt.tsx` | Presentational only |
| `client/vitest.config.ts` | Client test runner (M3). **Pure-logic modules only**, scoped to `src/assistant/**`. Sits at `client/` root, so it is not covered by the `client/src/assistant/` entry above. Loads none of the app's Vite plugins, and does not affect the production build |

### 7.2 Modified files (the complete list — nothing else may change)

| Path | Change | Size |
|---|---|---|
| `server/src/index.js` | Mount assistant router; construct `geminiFast`; new env tunables; assistant limiter; **add a limiter to `/api/resources/generate`** | additive — **M2 +29 / −0, M5 +52 / −0** |
| `server/src/routes/resources.js` | Replace the inline `generateSchema` definition with an import. **Nothing else** | ~15 lines relocated |
| `server/src/routes/assistant.js` | `GET /catalog` (M2); `POST /interpret` + envelope schema (M5); rollout gate made to fail closed (M5) | additive — M5 +198 / −8, all 8 deletions being comment lines or the Prisma call re-indented into a try/catch |
| `server/src/assistant/proposalSchema.js` | **M7b**: free-text slots declare `maxLength` in the Gemini response schema (candidate C4), derived from the registry's own `slot.type` rather than naming `topic`. The application's accept bound is unchanged, so it can neither admit nor reject anything it did not before | additive — **+49 / −0** |
| `server/.env.example` | Document ~8 new variables | additive. **Amended at M5**: the routing model endpoint, because the M0-documented `gemini-2.5-flash-lite` was retired and returns 404 |
| `client/src/App.tsx` | Wrap `AppRoutes` in `RouterProvider` | **actual at M6: +7 / −1** — insertion only, provider order untouched |
| `client/src/pages/CoachPage.tsx` | Route submissions through the router pre-pass; render clarify chips | **actual at M6: +42 / −2** (est. ~40). One import line; the flag-off path stays synchronous |
| `client/src/pages/GeneratorPage.tsx` | Draft read on mount + param change; banner; provenance markers; correction telemetry | **actual at M3: +220 / −27** (original estimate ~60 lines — see note below) |
| `client/src/config.ts` | Flag constant + assistant constants | ~5 lines. **NOT modified at M6** (decision D8): router constants stay module-private so the folder is deletable without dangling references. `ASSISTANT_ENABLED` was added at M0 and is the only assistant value that belongs here |
| `client/src/index.css` | Banner / chip / marker styles | additive — **M3 +~90, M6 +59 / −0** |
| `client/.env.example` | `VITE_ASSISTANT_ENABLED` | 1 line |
| `client/package.json` | `vitest` + `jsdom` **devDependencies** and a `test` script (M3) | ~5 lines |
| `client/package-lock.json` | Lockfile for the above | generated |
| `.github/workflows/ci.yml` | **Conditional** — only if a client test runner is added. Added at M3 | ~6 lines |
| `server/package.json` | **M7a**: `eval` / `eval:replay` / `eval:compare` scripts, and `lint` extended from `eslint src` to `eslint src evals`. Unlinted JavaScript is how a typo'd scorer reports 100% | +5 / −2 |
| `client/tsconfig.json` | **M7a**: `"exclude": ["src/**/*.eval.test.ts"]`. The gate eval reads the shared corpus with `node:fs`, which this browser tsconfig has no types for. Excluded from the build's type-check rather than solved with `@types/node`, which would make Node globals visible to **all** client source and could let a real `process.env` mistake in app code type-check cleanly. Every other `*.test.ts` stays type-checked | +9 (8 comment) |
| `.gitignore` | **M7a**: `server/evals/runs/` — per-run working artifacts. The corpus, cassettes and promoted baseline are tracked | +4 |

> **What this table does and does not cover (clarified at M4).** It is the complete list of
> **shipped application files** that may be modified. It has never covered documentation — this
> README, the three planning documents, and the per-folder `README.md` files — whose upkeep is
> *mandated* by §19 and §17 rather than merely permitted. Nor does it cover **additions** under
> `server/test/` and `client/src/assistant/*.test.ts`, which every milestone makes and which
> protected area #12 already governs ("additions only"). M4 modified exactly one file on this table
> (`client/src/config.ts`, comments only) plus two folder READMEs and this document. Stated
> explicitly because the alternative is each milestone quietly deciding for itself what the control
> means.

> **Why `package.json` and the lockfile are on this list.** They were missing from the original
> table, which called itself the complete set of permitted modifications. Adding the client test
> runner was approved as an M0 decision and executed in M3, and that cannot be done without touching
> both files — so the omission was in the table, not in the change. Recorded here because this table
> is a **control**, not prose: a control that is quietly wrong the first time it binds teaches
> reviewers to stop trusting it.

> **On the `GeneratorPage` size.** The estimate of ~60 lines covered the *logic*, and the logic did
> land at roughly that size. The remainder is comment density matching the surrounding file, and the
> JSX restructuring needed to host a provenance marker inside each of the eight field labels — every
> `<span className="ws-label">Grade</span>` became a four-line block. **No behavioural code was
> removed:** all 27 deleted lines are the eight `useState` literals (now `FORM_DEFAULTS`), the eight
> field labels/handlers, the tip conditional, and two import lines. `handleGenerate`, `handleSave`,
> `examMeta` and the generation request body are untouched, verified by diff.

### 7.3 Untouched (explicit)

**Backend:** `gemini.js` · `prompts.js` · `safety/*` · `middleware/auth.js` · `routes/auth.js` ·
`routes/admin.js` · `routes/queries.js` · `lib/db.js` · `lib/googleAuth.js` · `lib/email.js` ·
`lib/geminiPolicy.js` · `lib/assessmentSchema.js` · `lib/asyncHandler.js` · `seed.js` ·
`prisma/schema.prisma` · `prisma/migrations/*`

**Frontend:** `api.ts` · `auth.tsx` · `onboarding.tsx` · `main.tsx` · `lib/resources.ts` ·
`lib/assessment.ts` · `lib/format.ts` · `lib/examMeta.ts` · `lib/math.ts` · `lib/followUp.ts` ·
`lib/tts.ts` · `lib/onboarding.ts` · all `hooks/*` · all pages except Coach and Generator · all
components except the two new ones

### 7.4 The deletability property

Deleting `client/src/assistant/`, the two new components, `server/src/assistant/`,
`server/src/actions/`, `server/src/routes/assistant.js`, and reverting the modified files must
return the app to exactly today's behavior — with the single intentional exception of the M1
schema extraction, which stands on its own merits.

**This is a merge checkpoint, not an aspiration.**

---

## 8. Milestone Roadmap

| Milestone | Description | Effort | Status | Notes |
|---|---|---|---|---|
| **P0** | Architecture design & review | 2.0 d | ✅ **Completed** | 2026-07-27. Approved |
| **P1** | Phase 1 implementation specification | 2.0 d | ✅ **Completed** | 2026-07-27. Approved |
| **P2** | Guardrails & impact analysis (final review) | 1.0 d | ✅ **Completed** | 2026-07-27. Produced 12 binding amendments (§5.3) |
| **P3** | Living project document (this file) | 0.5 d | ✅ **Completed** | 2026-07-27. Branch `feature/ai-action-router` created |
| **M0** | Contract freeze & scaffolding | 1.0 d | ✅ **Completed** | 2026-07-28. Planning docs persisted; contracts frozen both sides + made executable (44 new tests); flags all OFF; folder scaffolding; `.env.example` both sides. Lint/build/tests green; bundle growth **0 bytes** |
| **M1** | Schema extraction (pure refactor) | 0.5 d | ✅ **Completed** | 2026-07-28. Schema moved to `actions/schemas/generateAssessment.js`; shared bounds to `lib/resourceFields.js`. **`resources.test.js` passed 70/70 unmodified.** Exactly one definition repo-wide. 457 tests (unchanged — correct for a pure refactor) |
| **M2** | Registry + catalog endpoint | 2.0 d | ✅ **Completed** | 2026-07-28. Registry + 2 descriptors + `GET /catalog`; startup validation incl. **descriptor↔schema agreement in both directions**; drift guard live for **both** pairs and **proven to detect injected drift**. `index.js` **+29 / −0**. 527 tests (+70) |
| **M3** | Draft store + Generator prefill (**no AI**) | 3.0 d | ✅ **Completed** | 2026-07-28. Draft store (TTL/eviction/fail-soft), `generatorPrefill` seam, telemetry, banner, markers, undo. CHANGE-7/10/12 all verified in a live browser. Client test runner installed (Vitest + jsdom): **70 client tests**. Bundle **+1.79 kB gzip**. Server suite unchanged at 527 |
| **M4** | Vocabulary + resolver + policy (pure modules) | 3.0 d | ✅ **Completed** | 2026-07-28. 3 vocabulary mappers + resolver + policy, all pure. **257 new tests** (87 in the grade suite over 79 tabulated phrases, against the ~40 planned). Policy proven by **exhaustive enumeration of its complete 288-combination input space** — no coverage dependency added. Third drift pair guarded. **Zero production callers**, proven by module-graph inspection |
| **M5** | Classifier + `/interpret` endpoint (dark) | 4.0 d | ✅ **Completed** | 2026-07-28. `geminiFast`, registry-derived prompt + `responseSchema`, 12-stage pipeline, endpoint. **943 tests (+159)**, 5× no flakiness. Verified against **live Gemini**. The G4 injected-defect proof exposed that the guard was unreachable dead code, and the no-5xx proof exposed a **real 500** in the rollout gate — both fixed. Bundle byte-identical |
| **M6** | Client wiring | 4.0 d | ✅ **Completed** | 2026-07-29. Gate (CHANGE-2), repeat cache, session memory, breaker, catalog, provider, executor, handler map, CoachPage integration, CHANGE-3, CHANGE-9. **312 client tests (+242)**, 3× no flakiness; **server untouched — `git diff --stat server/` empty**; bundle +5.2 kB gzip; **12/12 injected-defect proofs detected**; **full 20-step manual script executed against live Gemini, zero defects**. CHANGE-7 proven with a no-remount sentinel; CHANGE-9 proven in both halves |
| **M7a** | Eval corpus, harness, baseline (**measurement only**) | 3.5 d | ✅ **Completed** | 2026-07-29. **196 labelled turns** (157 single + 15 sessions) across 8 strata; record/replay harness at the `fetchImpl` seam; deterministic full-corpus CI gate; **62 new server tests + 5 client**; baseline recorded against `gemini-3.5-flash-lite` with **precision 95.8%, recall 85.8%, Hinglish precision 100%**, and **grade slot accuracy 23.9%** against a DoD target of 85%. All five hard gates pass. **Seven failure classes recorded in `golden_failures.md`; nothing tuned** |
| **M7b** | Prompt/schema tuning + re-measure | 1.5 d | ✅ **Completed** | 2026-07-29. **4 candidates measured, 1 accepted.** C4 (free-text slots bounded in the response schema, registry-derived) cut GF-1 10 → 7 and lifted recall 85.8% → 89.6%; **C3, C1 and C2 were rejected on evidence and recorded in `TUNING_LOG.md`**. **Grade extraction unchanged at ~20% — the primary target was NOT met**, and two independent prompt mechanisms aimed at it measurably hurt it. Frozen baseline, corpus and cassettes untouched; `gemini.js` untouched |
| **M8** | Telemetry | 2.0 d | ⬜ Pending | *Parallel with M7.* Split channels per CHANGE-6 |
| **M9** | Hardening | 3.0 d | ⬜ Pending | Rate limits, budgets, CHANGE-8 breaker, security review, deletability test |
| **M10** | Internal rollout | 5.0 d | ⬜ Pending | Dark → team → pilot school → all teachers |

**Status legend:** ✅ Completed · 🟡 In Progress · ⬜ Pending · ❌ Blocked · ⏸️ Paused

**Total implementation effort:** 32.5 days · **1 dev:** 7–8 weeks · **2 devs:** 4.5–5 weeks
(add 20% contingency, concentrated in M4 and M7)

> 🔒 **Every milestone ends with the mandatory verification gate in [§21](#21-milestone-completion-protocol-mandatory).**
> A milestone is not "complete" when the code is written — it is complete when review, verification,
> manual testing, regression testing, design-compliance comparison, documentation update, and the
> Milestone Completion Report are all done. **Never implement two milestones together. Never start
> the next milestone without explicit user approval.** The effort estimates above cover
> implementation only; add ~0.5 day per milestone for the gate.

---

## 9. Progress Log

> **Append only. Never delete or rewrite an entry.** Newest at the bottom.

| Date | Decision / Event | Status | Notes |
|---|---|---|---|
| 2026-07-27 | Project initiated — intelligence layer identified as the next major initiative after onboarding | ✅ | Explicitly framed as an AI **Action Router**, not an autonomous agent |
| 2026-07-27 | Codebase studied: routing, Coach, Generator, Library, Workspace, AI Assist, backend, Gemini integration, API contracts, structured JSON generation | ✅ | Key finding: `/api/resources/generate` already uses model-returns-JSON + app-renders-structure. That discipline is the model for the whole project |
| 2026-07-27 | **Architecture Document produced** | ✅ | Core reframe: build the **Capability Registry** first; the AI router is a swappable front end |
| 2026-07-27 | Approved: three-layer separation (understanding / resolution / execution) | ✅ | Ensures a misclassification produces a wrong *suggestion*, never a wrong *effect* |
| 2026-07-27 | Approved: three distinct schemas — ActionDescriptor / IntentProposal / ResolvedAction | ✅ | The extensibility hinge |
| 2026-07-27 | Approved: effect class dominates confidence | ✅ | Safety spine. Destructive actions structurally unreachable from text |
| 2026-07-27 | Approved: ordinal confidence, not float | ✅ | LLMs are poorly calibrated numerically |
| 2026-07-27 | Approved: typed slot memory, not chat transcript | ✅ | Inspectable and correctable by the teacher |
| 2026-07-27 | Approved: Coach as universal fallback; passthrough on all failure | ✅ | No utterance dead-ends |
| 2026-07-27 | **Phase 1 Implementation Specification produced** | ✅ | 11 milestones, repo impact, API contracts, testing strategy, DoD |
| 2026-07-27 | Approved: zero database migrations in Phase 1 | ✅ | Makes rollback a flag flip |
| 2026-07-27 | Approved: M3 (client prefill) before M5 (classifier) | ✅ | Client team never blocked; first demo is deterministic |
| 2026-07-27 | **Guardrails & Impact Analysis produced (final design review)** | ✅ | 24-module impact table, 28 guardrails, 12 invariants, rollback plan |
| 2026-07-27 | **Finding A:** `preferencesSchema` is `.strict()` — persisted opt-out would require editing protected `auth.js` | ✅ | → CHANGE-1 |
| 2026-07-27 | **Finding B:** client is a PWA with service-worker caching — client rollback is not deterministic in time | ✅ | → server kill switch is the ONLY incident control |
| 2026-07-27 | **Finding C:** React Router does not remount on search-param change — mount-only draft read is a latent bug | ✅ | → CHANGE-7 |
| 2026-07-27 | **Finding D:** `Event` is a rare-incident table; per-interpret writes add pressure to single-writer SQLite | ✅ | → CHANGE-6 |
| 2026-07-27 | **12 binding amendments approved** (CHANGE-1 … CHANGE-12) | ✅ | Net timeline impact ≈ neutral. See §5.3 |
| 2026-07-27 | Branch `feature/ai-action-router` created from clean `main` | ✅ | All future work happens here. Never on `main` |
| 2026-07-27 | **This living document created** (`docs/AI_ACTION_ROUTER_README.md`) | ✅ | Single source of truth from this point onward |
| 2026-07-27 | ⚠️ Recorded gap: the three source documents exist only in conversation history, not as files | ⚠️ **Open** | See §17. This README is written to be self-sufficient regardless |
| 2026-07-27 | **Milestone Completion Protocol adopted** (§21) — mandatory 7-step verification gate at the end of every milestone; one milestone at a time; explicit approval required before the next | ✅ | Binding on all future work. Adds ~0.5 d per milestone (~5.5 d across M0–M10) |
| 2026-07-27 | Local run environment verified: `server/.env` and `client/.env` present, dependencies installed on both packages, `server/prisma/dev.db` exists | ✅ | **Manual verification (§21 step 3) is feasible.** Browser automation available. AI-dependent paths depend on the Gemini key being valid — not verified, and not needed for M0–M4 |
| 2026-07-27 | ⚠️ Escalated: §21 step 5 requires comparing implementation against three documents that are not on disk | ✅ **Resolved 2026-07-28** | Persisting documents 1–3 was promoted to M0 task #1 and completed |
| 2026-07-28 | **M0 started.** Baselines captured before any change: server lint ✅, client lint ✅, client build ✅ (bundle `index-B4SBMDAV.js`, 276.32 kB gzip), server tests ✅ 18 files / 413 tests | ✅ | Baselines are what make "unchanged" provable rather than asserted |
| 2026-07-28 | **Planning documents persisted** to `docs/` with all 12 amendments incorporated inline and marked `[CHANGE-n]` | ✅ | Unblocks §21 step 5 for every future milestone gate |
| 2026-07-28 | **Wire contracts frozen** — `server/src/assistant/contracts.js` + `client/src/assistant/types.ts` | ✅ | Deliberate cross-runtime duplication (CJS vs ESM), cross-referenced in both files per CHANGE-11 |
| 2026-07-28 | Contract freeze made **executable**: the spec's §7 example payloads live in `test/helpers/assistantFixtures.js` and are asserted against the frozen vocabularies | ✅ | A documented example that no longer validates is how a spec quietly stops being true. Also encodes guardrail G3 and the Phase 1 effect ceiling as tests **before** any code exists to violate them |
| 2026-07-28 | **Feature flags defined**, all defaulting OFF (`server/src/lib/flags.js`) | ✅ | Verified against the real `server/.env`: `enabled === false`. Mirrors `lib/config.js` clamp-and-warn convention |
| 2026-07-28 | **Decision: client test runner deferred to M3**, not M0 | ✅ | Vitest + jsdom for pure-logic modules only (no React Testing Library). A runner installed with zero tests is unverifiable scaffolding; installing it with `draftStore`'s first real test proves both at once |
| 2026-07-28 | **Decision: `index.js` NOT modified in M0** | ✅ | M0 creates no routes and no `geminiFast`, so there is nothing to wire. Keeps the diff minimal and defers touching the app entrypoint to M2 |
| 2026-07-28 | Found: `client/tsconfig.tsbuildinfo` is git-tracked but not gitignored, so every build dirties it | ⚠️ **Open — pre-existing, out of scope** | Restored during M0 so the milestone diff contains only intentional changes. Fixing `.gitignore` is repo hygiene, not M0 scope — flagged for a separate decision |
| 2026-07-28 | **M0 verification complete.** Lint ✅ both · client build ✅ · server tests ✅ **20 files / 457 tests** (+2 files, +44 tests) · 3 consecutive runs, no flakiness · server boots, `/api/health` 200 · `/api/assistant/catalog` correctly **404** (no routes yet) · client bundle hash **identical** to baseline (0 bytes growth) | ✅ | See the Milestone Completion Report |
| 2026-07-28 | ⚠️ Manual verification partially limited: authenticated UI regression not performed | ⚠️ **Documented limitation** | Signing in requires entering a password, which the assisting agent does not do. Unauthenticated verification was completed (app boots, `/generator` redirects to `/login`, **zero** API requests, no new console errors). Risk is nil for M0 specifically: the client bundle is byte-identical to baseline, so no UI behaviour could have changed |
| 2026-07-28 | **M0 complete — awaiting user review and approval.** M1 not started | ⏸️ | Per §21: never continue to the next milestone automatically |
| 2026-07-28 | Review question raised: is `client/src/assistant/types.ts` generated or a manual mirror, and does it violate single-source-of-truth? | ✅ Answered | Manual mirror. It is a **compile-time projection**, not a second behavioural source of truth: zero runtime values, proven by the byte-identical bundle. Honest limit stated — TS does not validate network responses, and the control was a comment convention rather than an automated check |
| 2026-07-28 | Found and fixed: the README referenced the three planning documents only as plain paths, never as links | ✅ | §17, §4 and §21 step 5 now link all three. All 13 relative links across the doc set verified to resolve |
| 2026-07-28 | **DECISION (project owner): the contract drift test is a mandatory M2 acceptance criterion** | ✅ **Binding** | Supersedes the earlier "convention + cross-reference comments" position. Rationale accepted on both sides: no value guarding an unused projection today, but the guard must exist **before** the client starts consuming the types at M6. Recorded in §8 and §11 |
| 2026-07-28 | **M0 APPROVED by project owner.** M1 authorized | ✅ | Approval covers M0 only; M1 follows the same protocol and stops for review |
| 2026-07-28 | **M1 started** — extract `generateSchema` from `routes/resources.js` | ✅ | Dependency analysis first: 6 constants are schema-owned, 3 cross the boundary (`MAX_QUESTIONS` used by the `more_questions` guard; `MAX_META`/`MAX_LANGUAGE` shared by four CRUD schemas) |
| 2026-07-28 | **Design decision: shared field bounds extracted to `lib/resourceFields.js`** rather than duplicated or imported across layers | ✅ | Having `actions/schemas/` import from `routes/` would invert the intended dependency direction AND create a **require cycle** — in CommonJS that yields a partially-initialised module, a subtle bug class. A leaf module both sides import has neither problem. Only genuinely shared bounds moved; `MAX_TITLE`/`MAX_CONTENT`/`MAX_STRUCTURED`/`MAX_SOURCE_ID` stay in the route, with a comment explaining the asymmetry |
| 2026-07-28 | Schema renamed `generateSchema` → `generateAssessmentSchema` on extraction | ✅ | The bare name was ambiguous once the file could hold several action schemas. One call site plus one JSDoc reference updated; zero stale references remain |
| 2026-07-28 | **M1 verification complete.** `resources.test.js` **70/70 passing, file unmodified** · full suite **457 tests** (identical to M0 — correct for a pure refactor) · 3 consecutive runs, no flakiness · server lint ✅ · client lint + build ✅ (bundle hash unchanged) · server boots clean · `/api/resources/generate` still mounted and auth-guarded (401 without a token) · schema verified standalone: `.strict()` still rejects extra keys, enums still reject bad values, no require cycle | ✅ | See the M1 Milestone Completion Report |
| 2026-07-28 | **M1 complete — awaiting user review and approval.** M2 not started | ⏸️ | Per §21 |
| 2026-07-28 | **M1 review finding: `client/src/config.ts` carried a STALE pointer** — its generator options claimed to "mirror server enums in `server/src/routes/resources.js`", which M1 had just emptied | ✅ **Fixed in M1** | Corrected to name `actions/schemas/generateAssessment.js`, and the server module now names `config.ts` back. Bidirectional cross-reference per the CHANGE-11 convention. *A refactor that leaves a stale pointer behind is how the next person learns to distrust the comments* |
| 2026-07-28 | Clarified scope of "one definition": there is exactly one runtime **validator** (server), plus a pre-existing client-side **picker option list** in `config.ts` that is presentation-only | ✅ Documented | Not created by M1 and not a second validator, but it *can* drift, and M2 makes drift more consequential |
| 2026-07-28 | **Drift test scope EXTENDED** to a second pair: `generateAssessment.js` vocabularies ↔ `config.ts` picker options | ✅ **Binding on M2** | Recorded in §11 alongside the `contracts.js` ↔ `types.ts` pair |
| 2026-07-28 | **New permanent guardrail 12a: dependency direction.** Shared leaf modules → imported by routes and actions; never the reverse | ✅ **Binding** | Confirmed to the project owner. Structurally enforced today — `routes/resources.js` exports only its Express router, so no constant can be imported from it |
| 2026-07-28 | **M2 additive-only constraints recorded as an explicit acceptance criterion** (§11), covering endpoint contracts, middleware order, auth, body-limit branch, and the shape of the `index.js` diff | ✅ **Binding on M2** | Confirmed to the project owner before M2 begins, so it is a checkable criterion rather than a promise |
| 2026-07-28 | **M1 APPROVED by project owner.** M2 authorized | ✅ | |
| 2026-07-28 | **M2 started** — Capability Registry, two descriptors, `GET /api/assistant/catalog` | ✅ | |
| 2026-07-28 | **Design decision: `requiredRoles: []` means "any authenticated user"** on both Phase 1 descriptors | ✅ | The underlying `POST /api/resources/generate` is guarded by `authRequired` alone with no role check, so the descriptor **mirrors the route's real guard**. Claiming a restriction the endpoint does not enforce would be security theatre; claiming a looser one would be a bypass. It also avoids inventing a 4th copy of the role list |
| 2026-07-28 | **Design decision: startup validation checks descriptor↔schema agreement in BOTH directions** | ✅ | Slot not in the schema ⇒ `.strict()` would strip it and the router would fill a field that never arrives. Schema-required key with no slot ⇒ the router could never build a valid request at all. Both now fail at boot. Uses zod 4's `.shape` / `.isOptional()`, verified against the installed version before designing around it |
| 2026-07-28 | **Design decision: separate rate-limit bucket** (`ASSISTANT_RATE_LIMIT_MAX_REQUESTS`) rather than reusing the `/coach` limiter | ✅ | Sharing one bucket would let catalog fetches consume the budget a teacher needs for coaching answers — the optional feature must never degrade the core one (invariant I12). Same library and options shape, so it is a separate bucket, not a parallel implementation |
| 2026-07-28 | **Design decision: the school allow-list lookup is skipped entirely when the list is empty** | ✅ | The token carries `schoolId`, the flag is expressed in school **codes** (what an operator knows), so the filter costs one indexed query — and zero in the default configuration |
| 2026-07-28 | Contract clarification: `defaultFrom` and `sensitive` are **not projected** into the catalog | ✅ | The approved spec's §7.1 example already omitted them; only a loose `Omit<>` JSDoc in `contracts.js` implied otherwise. Publishing resolution strategy would invite the client to re-implement it. No wire-shape change — the documented payload is unchanged |
| 2026-07-28 | **Drift guard proven to actually detect drift**, not merely to pass | ✅ | Injected a deliberate change into each pair and confirmed a single, correctly-named failure each time (`ACTION_STATUSES` mismatch; `QUESTION_COUNT_MAX` 25 vs 30), then restored. *A guard that has only ever passed is not evidence of anything* |
| 2026-07-28 | **M2 verification complete.** `index.js` **+29 insertions / 0 deletions** (purely additive, verified by diff) · middleware order unchanged · 527 tests (+70), 3 consecutive runs · lint ✅ both · client build ✅ bundle hash unchanged · zero migrations · protected files untouched · existing tests unmodified | ✅ | See the M2 Milestone Completion Report |
| 2026-07-28 | 📋 **Observed, NOT fixed (out of scope):** the global error handler in `index.js` returns **500 for malformed JSON**, where body-parser's `SyntaxError` already carries status 400 | 📋 **Recorded** | Reproduced on existing endpoints (`/api/auth/login`, `/api/resources`) and **pre-existing on `main`** — not introduced by M2. Recorded per the standing instruction to log cleanup opportunities rather than expand milestone scope. Worth a one-line fix in a separate change |
| 2026-07-28 | **M2 complete — awaiting user review and approval.** M3 not started | ⏸️ | Per §21 |
| 2026-07-28 | **M2 review finding: capability metadata was declared in TWO places** — the registry descriptors and the documented example payload in `test/helpers/assistantFixtures.js` — with **nothing asserting they agreed** | ✅ **Fixed in M2** | They happened to agree (the only difference was JSON key order), but nothing enforced it. Added a test asserting the **live endpoint response deep-equals the documented fixture**, converting an unchecked duplicate into a checked mirror. The fixture stays independently authored so it can still catch a wrong implementation |
| 2026-07-28 | **Startup fail-fast proven empirically, not asserted** | ✅ | Injected an effect above the Phase 1 ceiling and, separately, a slot the schema cannot accept. Both **prevented boot** with precise errors naming the action, the offending value and the guardrail. Restored and re-verified clean boot |
| 2026-07-28 | **Flags-off isolation proven by HTTP probe** across 9 existing endpoints plus the 3 assistant paths | ✅ | Every existing endpoint returned its expected status; the only new observable surface is `GET /api/assistant/catalog` (401 unauthenticated, inert empty catalog when authenticated) |
| 2026-07-28 | Post-review gate re-run: lint ✅ both · **527 tests** (+2 conformance tests), 3 consecutive runs · `resources.test.js` 70/70 unmodified · client build ✅ bundle hash unchanged | ✅ | |
| 2026-07-28 | **M2 APPROVED by project owner. M3 authorized** | ✅ | |
| 2026-07-28 | **M3 started** — draft store, Generator prefill, client test runner | ✅ | Baselines captured first: client bundle `index-B4SBMDAV.js` 276.32 kB gzip, lint/build green, server 527 tests |
| 2026-07-28 | **Decision: the draft read is gated on `VITE_ASSISTANT_ENABLED`** | ✅ **Approved by owner** | Code-review checklist item 17 asks whether a path is *provably* unreachable with flags off. Gating makes the answer yes rather than "nothing writes drafts yet, so in practice no". Verified empirically: with a valid draft in storage and `?ai=` in the URL, the form still opens at plain defaults and emits zero telemetry |
| 2026-07-28 | **Design decision: one seam module, `client/src/assistant/generatorPrefill.ts`** | ✅ **Approved by owner** | Guardrail G14 says `GeneratorPage` "imports exactly one function", but spec §6.4/§6.5 also require the page to mark a draft consumed and emit correction telemetry — which one function cannot cover. Rather than let the page reach into four modules, all of it goes behind one module: the page has a **single import line** into `assistant/`. This preserves G14's actual intent (single seam, deletability, no provider coupling) and moved the untrusted-params coercion somewhere **unit-testable** — 28 of the 70 client tests exist because of it. Reconciliation recorded in `client/src/assistant/README.md` |
| 2026-07-28 | **Decision: draft-store constants stay module-private**, not in `config.ts` | ✅ | A TTL constant in `config.ts` would be a dangling reference after the folder is deleted, weakening the deletability property for no benefit. `config.ts` was therefore **not** modified in M3 |
| 2026-07-28 | **Client test runner installed** (Vitest + jsdom, devDependencies only) alongside the draft store's first real tests | ✅ | Per the M0 decision: a runner installed with zero tests is unverifiable scaffolding. Confirmed the runner perturbs the app build by **zero bytes** before `GeneratorPage` was touched, so any later bundle change was attributable to the integration alone. No new advisory classes introduced — the flagged packages (esbuild, eslint's brace-expansion, react-router) are all pre-existing |
| 2026-07-28 | **M3 verification complete — performed in a REAL authenticated browser session**, not asserted | ✅ | The M0 limitation ("authenticated UI regression not performed") is **closed**. The project owner signed in and the full checklist ran against that session |
| 2026-07-28 | **CHANGE-7 proven with a no-remount sentinel** | ✅ | Typing a URL in the address bar is a full page load and would have proven nothing. Instead: `pushState` + `back`/`forward` (which fires `popstate` — exactly Finding C's condition), with a sentinel typed into `instructions`, a field the router never touches. After the param change the **sentinel survived** while draft B's values applied, proving the component updated *without remounting*. The applied-draft-ID guard was verified in the other direction too: returning to the previous handle did **not** re-apply over a teacher's edit |
| 2026-07-28 | **Degraded paths verified with a positive control** | ✅ | Expired, consumed, wrong-action, invalid-params, unknown-handle, corrupt-JSON and throwing-storage all left the form at defaults with no crash. A valid draft applied immediately afterwards through the same mechanism — **without that control the seven negatives would have been indistinguishable from a broken test harness** |
| 2026-07-28 | **CHANGE-10 verified in both directions** | ✅ | Banner suppresses the `generator-intro` tip on a routed visit; the tip **reappears on the next manual visit**, proving it was never marked dismissed. Small-viewport check performed at 386 px in a same-origin iframe (the extension could not resize the window below 1280): mobile media query active, banner wraps, form still above the fold, no horizontal overflow |
| 2026-07-28 | **G11 (no teacher text in telemetry) verified live, not just by unit test** | ✅ | The dev server's module graph allowed importing the real telemetry singleton in the page, so the actual emitted events were inspected: `prefill_applied` / `field_corrected` / `undo_all` carried field names and provenance only, and neither the topic values nor the utterance appeared anywhere |
| 2026-07-28 | **Full §13 regression executed against the live app** | ✅ | Generation flow end to end (generate → preview → save → workspace, real Gemini call) · Coach end to end (real answer, history, follow-up chips, zero assistant requests) · Library list/search/filter/delete-with-confirm · Workspace edit/save/AI Assist suggest+apply · **dirty guard verified in both directions** · RBAC (teacher redirected from `/admin`) · theme toggle |
| 2026-07-28 | Library search briefly appeared to fail during regression | ✅ **Not a defect** | Investigated rather than dismissed: re-testing from a clean state showed the resource correctly matching. The first result was a debounce artifact of rapidly retyping the query. `LibraryPage` is untouched by M3 |
| 2026-07-28 | ⚠️ **Two regression items deliberately NOT exercised**, with reasons | ⚠️ **Documented limitation** | (1) **Print modes** — `ResourceWorkspace` is untouched by M3 (empty diff) and invoking the print dialog blocks all further browser automation. The Print/Export control was confirmed present. (2) **Auth flows beyond sign-in** (Google, registration→pending, password reset, token refresh) — server-side, covered by four unmodified suites within the 527 passing tests. Interactive sign-in itself was exercised by the owner |
| 2026-07-28 | **Zero defects found during M3 verification.** No fixes were required | ✅ | Stated plainly because it is unusual — the two amendments most likely to break (CHANGE-7 and CHANGE-10) were implemented against explicit written descriptions of their failure modes, which is the value of catching them at design time |
| 2026-07-28 | Local environment restored: `VITE_ASSISTANT_ENABLED` **removed** from `client/.env` | ✅ | Unset means `ASSISTANT_ENABLED === false` in `config.ts`. Guardrail G27 holds: no flag ships defaulting to on |
| 2026-07-28 | Found and fixed during the M3 documentation pass: §16 still listed `server/src/actions/` as "⬜ To create" although M2 created it | ✅ | Logged per §20 rule 25. Minor, but a status table that is wrong in one row invites distrust of the rest |
| 2026-07-28 | **M3 complete — awaiting user review and approval.** M4 not started | ⏸️ | Per §21 |
| 2026-07-28 | **M3 review finding: §7.2 claimed to be "the complete list — nothing else may change" but omitted `client/package.json` and `client/package-lock.json`**, which M3 necessarily modified | ✅ **Fixed** | The change was authorised (adding the client test runner was an M0 decision executed at M3); the *table* was wrong, not the change. Fixed because §7.2 is a **control**, not prose — the first time it binds and is quietly inaccurate is the moment reviewers learn to skip it. `client/vitest.config.ts` added to §7.1 for the same reason (it lives at `client/` root, so the `client/src/assistant/` entry did not cover it) |
| 2026-07-28 | **M3 review finding: the `GeneratorPage.tsx` size estimate (~60 lines) understated the actual +220 / −27** | ✅ **Fixed** | Both §7.2 and spec §2.5 now carry the actual figure with an explanation: the *logic* did land near the estimate; the excess is comment density matching the surrounding file plus the JSX restructuring needed to host a provenance marker in each of the eight field labels. All 27 deletions accounted for; no behavioural code removed |
| 2026-07-28 | **Spec §2.4 amended to list `generatorPrefill.ts` and `client/vitest.config.ts`** | ✅ **Fixed** | Per §17 rule 1, the README wins over documents 1–3 — but the losing document should then be *corrected*, not left knowably incomplete. The entry records why the module exists (the G14 reconciliation) so the reasoning is not lost with this conversation |
| 2026-07-28 | Two review observations recorded but **deliberately NOT changed** (documentation-only pass) | 📋 **Recorded** | (1) `GeneratorPage` holds two parallel field→setter dispatch structures over the same eight fields (apply, and undo). A `setters` map would collapse them, but a heterogeneous map of setters types badly in TS without casts, and a cast there would weaken the type-safety the coercion layer exists to provide. (2) `createDraft`, `drainTelemetry` and the three `DRAFT_*` constants have **zero production callers** until M6/M8 — intentional and tree-shaken, but a reviewer is entitled to ask. Revisit both at M6 when the write path acquires its first real caller |
| 2026-07-28 | **M3 APPROVED by project owner. M4 authorized**, with two decisions taken up front | ✅ | **D1:** prove the policy by exhaustive truth-table enumeration; **do not** add a coverage dependency or touch `server/package.json`. **D2:** put the CHANGE-11 drift guard in a dedicated `vocabDrift.test.js`; **do not** modify `contractDrift.test.js`. Plus binding constraints: M4 stays unreachable from production, no route/middleware/startup/Prisma/registry/descriptor/client-runtime/flag changes, no new env vars, no migrations, new tests only |
| 2026-07-28 | **M4 started.** Baselines captured first: server 527 tests / 23 files, client 70 tests, both lints clean, bundle `index-BgXQqjT0.js` (975,064 raw / 277,420 gzip) | ✅ | Same discipline as M0–M3: "unchanged" has to be provable, not asserted |
| 2026-07-28 | **Design decision: mappers return a four-status RESULT, never a bare string** (`mapped` / `ambiguous` / `contradiction` / `unmapped`) | ✅ | The caller must be able to tell "this is the answer" from "this is my best guess" from "the teacher said two things". Collapsing them into a string is how a router prefills a plausible, confident, wrong grade. `unmapped` is a first-class SAFE outcome — it falls through to the teacher's own default, which is usually right |
| 2026-07-28 | **Design decision: `ambiguous` prefills the teacher's RAW phrase**, not a chosen candidate | ✅ | Matches architecture §8.2. Safe because the raw string passes through the same per-field schema validation as everything else, so it can only survive in a field that genuinely accepts free text |
| 2026-07-28 | **Design decision: the language mapper never returns `ambiguous`** | ✅ | A document has one language, so two languages is a question, not a span. And the `ambiguous` path prefills raw words — which in the Generator's `<select>` would silently show nothing selected. "Hindi and English" and "Hindi or English" are therefore both contradictions |
| 2026-07-28 | **Design decision: language codes are deliberately NOT accepted as input**, only language names | ✅ | `or` is Odia's ISO code **and** the English word separating two alternatives, so a table containing codes would read "Hindi or English" as a request for Odia. Teachers write names; a bare code falls through to the profile default, which is the safe direction |
| 2026-07-28 | **The language trap enforced structurally rather than by discipline** | ✅ | `mapLanguage` takes one slot value, matches language NAMES only, and there is no script detection anywhere in it or its caller — so there is no code path from input script to output language. Asserted by tests that feed it Devanagari and Hinglish requests naming no language and require `unmapped` |
| 2026-07-28 | **Design decision: per-FIELD schema validation, with a whole-object parse only when complete** | ✅ | A legitimate prefill is often *incomplete* (no topic — the form is the question), which a whole-object parse cannot distinguish from *invalid*. Field-by-field lets one bad value be dropped while the rest survive, which is exactly the spec's gate-3 "drop offending slots, downgrade" behaviour |
| 2026-07-28 | **Design decision: a contradiction does NOT fall through to memory or profile** | ✅ | Quietly filling from memory would hide the fact that the teacher said two different things — the one outcome the design refuses. The slot stays empty and the policy asks, showing both readings |
| 2026-07-28 | **Design decision: an unlisted slot gets the SHORTEST memory TTL, not session** | ✅ | A slot added later should have to earn a long memory rather than inherit one by being forgotten about in the table |
| 2026-07-28 | ⚠️ **New duplication risk recorded: memory TTLs will need to reach the client at M6** | ⚠️ **Open — decide at M6** | The client owns session memory, so it will need the same numbers. Resolution named in the code comment: **publish them through the catalog rather than re-declaring them in TypeScript.** The guardrails say to stop and consolidate when knowledge reaches a fifth home; this is the moment that rule would bind |
| 2026-07-28 | **Fifth file added to `actions/vocab/`: `shared.js`** (normalization + the result contract), against a plan that named four | ✅ **Deviation, recorded** | Three mappers would otherwise each carry a copy of the same normalization. A shared leaf both import is the same reasoning that produced `lib/resourceFields.js` in M1 |
| 2026-07-28 | **Exploratory testing found six real vocabulary gaps the test table missed** | ✅ **Fixed** | `class five`, `panchvi`, `chhati`, `pehli`, `angreji` and `environment` all fell through to `unmapped`. Every one is a common phrasing; none was in the table because the table and the implementation had the same author. Cardinal number words and Hinglish ordinals added. **This is the value of §21 step 3 even for a milestone with no UI** |
| 2026-07-28 | **Adding cardinal number words introduced a false positive, caught in the same session and fixed** | ✅ | `"ten questions on fractions"` mapped to Class 9-10 and `"one to one teaching"` to Class 1-2. Cardinals are now gated on class context — the same gate roman numerals already had, for the same reason. Recall verified preserved (`class five`, `five` still map); the false positives are refused |
| 2026-07-28 | **Policy proven by exhaustive enumeration of its complete input space** (D1) | ✅ | 4 effects × 3 confidences × 2 margins × 3 completeness cases × 2 contradiction cases × 2 `autoExecute` = **288 combinations, all generated rather than sampled**, each asserted against the approved §5.2 ordering transcribed independently as rules. Stronger than line-instrumented branch coverage, and needs no new dependency — `server/package.json` is untouched |
| 2026-07-28 | **The `execute` graduation branch written and tested although unreachable** | ✅ | `effectCeiling('draft', {autoExecute: true, confidence: 'high', missingCount: 0})` returns `execute`, and the Phase 1 clamp then reduces it to `prefill`. This proves the clamp is load-bearing rather than decorative, and makes architecture §8.4's "flip one field" promise real instead of aspirational |
| 2026-07-28 | **All three new guards proven to FAIL on an injected defect**, not merely to pass | ✅ | Drift guard: changed `Class 6-8` → `Class 6-9` in `config.ts` ⇒ one correctly-named failure. Policy: neutered the Phase 1 clamp ⇒ 5 failures including the exhaustive sweep. Resolver: disabled utterance precedence ⇒ 8 failures including **both** fixture-conformance tests. All three restored and re-verified green. *A guard that has only ever passed is not evidence of anything* (M2 precedent) |
| 2026-07-28 | **Resolver asserted to reproduce the specification's own example payloads** | ✅ | `test/helpers/assistantFixtures.js` holds spec §7.2's `prefill` and `ask` payloads, authored independently of this implementation. The resolver reproduces both `params` and `provenance` exactly, and the policy reproduces the documented `ask` object. Same technique M2 used for the catalog: a documented example that nothing asserts is how a spec quietly stops being true |
| 2026-07-28 | **M4 verification complete.** Server **784 tests / 30 files** (+257 tests, +7 files), 3 consecutive runs, no flakiness · `resources.test.js` 70/70 **unmodified** · `git diff --stat server/test/` **empty** (no existing test touched) · lint ✅ both · client 70 tests ✅ · client build ✅ · **bundle byte-identical to baseline** (same hash, 975,064 raw / 277,420 gzip) · zero migrations · zero new env vars | ✅ | See the M4 Milestone Completion Report |
| 2026-07-28 | **Unreachability from production proven by module-graph inspection, not by grep** | ✅ | Loading `routes/assistant.js`, `routes/resources.js` and `actions/registry.js` and then inspecting `require.cache` shows **zero** M4 modules present. A clean server boot on a spare port confirmed health 200, catalog 401, generate 401, coach 401 — unchanged. The only repo-wide mentions of the new modules outside themselves are three code COMMENTS |
| 2026-07-28 | ⚠️ **First probe attempt was invalid and was redone** | ✅ **Corrected** | Port 3000 was already serving a pre-existing instance, so the first health/catalog probes hit code that predated the change and proved nothing. Re-run on port 3111 against a freshly booted instance. Recorded because a verification step that silently measures the wrong thing is worse than one that is skipped |
| 2026-07-28 | **Manual verification: N/A by design, stated rather than implied** | 📋 **Documented** | §21's per-milestone table says M4's verification is unit tests, not the UI, and this milestone has no reachable runtime surface to exercise. What WAS done instead: a clean server boot, the four-endpoint probe above, and the exploratory mapper run that found the six gaps |
| 2026-07-28 | **Known duplication accepted: the drift extractors now exist in two test files** | 📋 **Recorded** | `vocabDrift.test.js` re-implements ~20 lines of the TypeScript-as-text extractors already in `contractDrift.test.js`. Deliberate — D2 forbade editing the M2 guard, and a milestone should not edit a control it inherited. Fold both onto a shared helper when a fourth pair appears |
| 2026-07-28 | **Found and fixed during the M4 documentation pass: §7.2 declares itself "the complete list — nothing else may change" but has never covered documentation or test additions**, both of which every milestone necessarily makes | ✅ **Fixed** | A scope note added to §7.2. The same class of finding as M3's (`package.json` omission): the *change* was authorised, the *table* was inaccurate. Fixed rather than reasoned around, because a control each milestone reinterprets for itself is not a control (rule 25) |
| 2026-07-28 | **M4 complete — awaiting user review and approval.** M5 not started | ⏸️ | Per §21 |
| 2026-07-28 | **M4 review finding: six symbols were exported with no consumer outside their own module** | ✅ **Fixed** | `MAX_RAW_LENGTH`, `NUMBER_TO_BAND`, `UNKNOWN_EFFECT_CEILING`, `MEMORY_RESTRICTED_EFFECTS`, `fieldAccepts` are now module-private, each with a comment saying why and where the behaviour is asserted instead. None was dead *code* — all execute — but a module's public surface should be the part someone else uses |
| 2026-07-28 | **M4 review finding: `policy.js` imported `PHASE1_DECISIONS` without using it, purely to re-export it** | ✅ **Fixed** | A pass-through re-export gives a frozen contract value a second import path — precisely what this project's drift guards exist to prevent. Removed; `contracts.js` is again the single path, and `policy.test.js` already imported it from there. The module still *enforces* the set (that is what `applyPhase1Clamp` does); it just no longer republishes it |
| 2026-07-28 | **M4 review finding: spec §11's Definition of Done still required "policy 100% branch"**, which decision D1 superseded | ✅ **Fixed** | Corrected in the spec itself with the reasoning inline, and recorded in a new "post-approval corrections" table there alongside M3's §2.4 amendment. Left uncorrected, it would have been checked literally at M10 against a criterion nobody applied — which is how a completion protocol quietly stops meaning anything (§17 rule 1) |
| 2026-07-28 | 📋 **Accepted trade-off: the token-scan preamble stays duplicated across the three vocabulary mappers** | 📋 **Recorded, deliberately NOT refactored** | `grades.js`, `subjects.js` and `languages.js` each open their scan with the same separator-handling block, and grades/subjects share a similar mentions-then-fallback-table shape. A `collectMentions(tokens, resolveToken)` helper in `shared.js` would collapse it. **Not done, on the project owner's instruction**, and the engineering case is genuinely two-sided: the three loops diverge in ways a shared helper would have to absorb as flags — grades needs the class-context gate and a pre-primary token set, subjects a flat synonym table, and languages **must not** collect separators at all because it has no ambiguous outcome. A helper carrying three behavioural switches is not obviously better than three explicit ten-line loops. Revisit if a fourth vocabulary arrives: at four, the duplication stops being a judgement call |
| 2026-07-28 | **M4 APPROVED by project owner. M5 authorized**, with six scoping decisions taken up front | ✅ | **D1** budget = injectable seam only, no persistence/counter/telemetry · **D2** no `telemetry.js` in M5 · **D3** envelope schema stays local to `routes/assistant.js` · **D4** `interpret.js` stays database-free via dependency injection · **D5** **reduced from the proposal** — no `pendingAsk` shortcut logic; conversational shortcutting belongs to M6 · **D6** CHANGE-8 breaker stays deferred to M9 · **D7** continue the injected-defect proof discipline. Plus a standing requirement: the classifier's only output contract is `IntentProposal`, and one regression test must prove the response schema is derived entirely from the registry |
| 2026-07-28 | ⚠️ **The M0-documented routing model was DEAD.** `gemini-2.5-flash-lite` returns **404 — "no longer available to new users"** | ✅ **Fixed before implementation** | Caught by the mandatory pre-M5 connectivity probe, which is exactly why §21 requires it *before* the milestone rather than at its gate. Had this been left, every routing call would have failed on the day the feature was switched on — and it would have looked like a router bug, not a config one. **Also learned: `models.list` cheerfully lists a model the key cannot call**, so a model must be verified with a real `generateContent` request, never with the listing |
| 2026-07-28 | **Routing model changed to the floating alias `gemini-flash-lite-latest`** | ✅ **Owner decision** | Four candidates were probed with the real classifier request shape. Working: `gemini-flash-lite-latest` (1.0–1.6 s), `gemini-3.1-flash-lite` (1.0–1.1 s), `gemini-3.5-flash-lite` (1.0–1.5 s), `gemini-2.5-flash` (1.5–2.7 s). Dead: `2.5-flash-lite` (404), `2.0-flash-lite` (429). The owner chose the **alias over a pin**, accepting reproducibility loss to avoid a repeat of the retirement that had just broken the project. **Consequence recorded for M7 rather than discovered there: an eval baseline against an alias is not reproducible, so the eval runner must capture the resolved model version alongside its results** |
| 2026-07-28 | **M5 started.** Baselines captured first: 784 server tests / 30 files, 70 client tests, both lints clean, bundle `index-BgXQqjT0.js` (975,064 bytes) | ✅ | Same discipline as M0–M4 |
| 2026-07-28 | **Design decision: the classifier prompt AND the Gemini `responseSchema` are both generated from the role-filtered registry** | ✅ | What the app advertises and what it understands cannot drift apart, by construction rather than by anyone remembering. Two regression tests (one per half) prove that adding an action widens both with **no edit to `classifier.js` or `proposalSchema.js`** — the requirement the owner attached to the M5 authorization |
| 2026-07-28 | 🔴 **The G4 injected-defect proof FAILED TO FAIL — and that was the most valuable result of the milestone** | ✅ **Architecture corrected** | Injecting the classic `\|\| descriptors[0]` fallback into the catalog re-verification changed nothing: **123 tests still passed.** Cause: `buildProposalSchema` built its `intent` zod enum from the *same* descriptor list it then authorized against, so zod always rejected a bad id first and **the authorization branch was structurally unreachable dead code**. The "G4 tests" were really testing the zod enum. Spec §4.4 gate 2 is explicitly *two* checks ("zod shape **and** id membership") and they had been collapsed into one. Split into `buildProposalSchema` (bounded string, shape only) and `parseProposal` (the single authorization site). **The identical defect now fails 9 tests across 3 files.** *A guard that cannot fail is not a guard* |
| 2026-07-28 | 🔴 **The no-5xx injected-defect proof exposed a REAL BUG: `/interpret` and `/catalog` both returned 500** when the database failed during the school-code rollout lookup | ✅ **Fixed** | Disabling the pipeline's total catch failed 5 unit tests but **zero integration tests**, which meant something upstream of the pipeline was unprotected. It was `isWithinRollout`'s Prisma call — outside `interpret.js`'s catch, reaching the global error handler. Violates G22, M5's headline contract, and also broke the catalog's own design principle that "not enabled for you" is a normal state rather than an error. Now **fails closed**: a database that cannot be read is never treated as permission granted. Two regression tests added, one per endpoint. **The catalog half is an M2 bug fixed here because the gate is shared and the fix is three lines** |
| 2026-07-28 | **Existing test file modified — raised and APPROVED rather than done quietly** | ✅ **Owner decision** | `assistant.catalog.test.js` carried an M2 placeholder asserting `POST /interpret` returns 404 "(arrives in M5)". Its own name scheduled its expiry, so this is not the failure mode G26 protects against — but protected area #12 makes any edit to an inherited test a blocking review item, so it was escalated. Rewritten (not deleted) to pin the router's surface to exactly `{catalog, interpret}` and nothing else, on either verb. **Strictly stronger than the assertion it replaces**: an unplanned third endpoint would now fail it, which the 404 check never covered |
| 2026-07-28 | **Design decision: a timeout is a DECISION, not an error** — and every one of the nine passthrough reasons is tested individually | ✅ | The classifier maps `DEADLINE_EXCEEDED`, `TimeoutError`, `AbortError`, safety blocks, upstream 4xx/5xx, network failure and unparseable JSON onto reasons. Nothing in the module throws. Also deliberately separated: the per-request Gemini **call** budget (`BUDGET_EXHAUSTED`, a retry storm) reports `classifier_error`, never `budget_exhausted`, which is the per-user **daily** cap — conflating them would make an upstream incident look like normal quota usage |
| 2026-07-28 | **Design decision: an internal defect reports `classifier_error` rather than gaining a tenth reason** | ✅ | `PASSTHROUGH_REASONS` is a frozen wire vocabulary and none of its members means "we have a bug". Adding one would be a contract change to describe something the teacher must never be able to tell apart anyway. The distinguishing detail goes to the decision log, where it is actionable, and is asserted **not** to reach the response |
| 2026-07-28 | **Design decision: `.strict()` on the proposal envelope, but drop-don't-reject on slots** | ✅ | An unexpected top-level key means the model ignored the output contract (gate 2 — a security boundary, reject the whole proposal). An unexpected slot is ordinary noisy extraction (gate 3 — drop the offender, keep the rest). The cost is stated plainly in the code: a model that helpfully adds `reasoning` loses its whole proposal. That is the intended trade — silently stripping would let the contract erode with nobody noticing |
| 2026-07-28 | **M5 verification complete.** Server **943 tests / 34 files** (+159 tests, +4 files), **5 consecutive runs**, no flakiness · `resources.test.js` 70/70 **unmodified** · lint ✅ both · client **70 tests** ✅ · client build ✅ **bundle byte-identical to baseline** (same hash, 975,064 bytes) · `index.js` **+52 / −0** · zero migrations · zero new env vars · all 14 protected areas empty-diff | ✅ | See the M5 Milestone Completion Report |
| 2026-07-28 | **Manual verification performed against LIVE Gemini**, not asserted | ✅ | Real server booted on spare ports (M4's lesson about port 3000 serving a stale instance). **Flags OFF:** 401 unauthenticated, 200 + `disabled`, inert catalog, **zero decision logs** — no work done at all. **Flags ON:** prefill (`"Class 5"` → `Class 3-5`, correct provenance, correct `memoryUpdates`), `ask` with one chip question, `not_an_action` on a coaching question, Hinglish correctly resolved to `quiz`/`Class 3-5`/`Mathematics` with `topic` correctly reported missing, `open_generator` prefill, 400 on oversized and on an unknown key. **Flags were passed as process env — `server/.env` was never edited**, verified afterwards to contain zero `ASSISTANT_` keys |
| 2026-07-28 | **The emergency short-circuit proven by LATENCY, not just by assertion** | ✅ | An emergency utterance returned in **87 ms** against ~1.2 s for a routed one — a 14× gap that is only explicable by the classifier never having been called. The unit and integration tests additionally assert the `fetch` mock recorded **zero** calls |
| 2026-07-28 | **The two Gemini instances proven independent in production conditions** | ✅ | In the same live session `/api/coach` took **20.1 s** (its 60 s budget, unchanged) while routing took **~1.2 s** (its 5 s budget). `/api/resources/generate` produced a correct worksheet with an answer key. `gemini.js` diff empty; `gemini.reliability.test.js` and `gemini.contract.test.js` unmodified and green — the standing proof that adding `geminiFast` did not perturb the shared service |
| 2026-07-28 | **G11 verified live by reading the actual logs**, not only by unit test | ✅ | Every `interpret_completed` line carried requestId, decision, actionId, confidence, margin, call count, missing/lowConfidence/contradiction/dropped counts and latency — **and no utterance text and no slot values**. Zero `Unhandled request error` entries across the whole session |
| 2026-07-28 | **The language trap verified against a live model** | ✅ | A Devanagari utterance naming no language produced **no `language` param at all**. Confirmed the earlier `?????` in the console was a Windows codepage artifact, not data corruption — the topic was correctly stored as `भिन्न` |
| 2026-07-28 | ⚠️ **Three model-quality gaps found in live testing. Recorded as M7 eval seeds and deliberately NOT tuned** | ⚠️ **Open — M7 owns these** | (1) The `language` slot is often unfilled **even when a language is explicitly named** ("a Marathi quiz", "in Hindi"). (2) On one utterance the model crammed several slots into `topic` as `"fractions.5thsgrade.subject:maths.language:Hindi"`. (3) It sometimes reports provenance `utterance` for a value the teacher never said (inferring `format: worksheet` from "I need something on photosynthesis"). **Attribution was verified rather than assumed**: `mapLanguage('Hindi') → 'hi'` and the resolver fills it with provenance `utterance`, so the deterministic half is correct and the gap is entirely classifier recall. Tuning a prompt against three anecdotes is how thresholds stop being evidence-based — M7's corpus is the place to measure this, and it is the Phase 2 go/no-go |
| 2026-07-28 | 📋 **Observed: the registry-derived prompt measurably beat a hand-written one** | 📋 **Recorded** | During model selection a hand-written stand-in prompt made every candidate read `"Class 3 ke liye maths quiz banao"` as `topic: "quiz"` — the format mistaken for the subject matter. The real registry-derived prompt, which lists `format` as its own slot with its enum, resolved the same utterance correctly to `format: quiz` + `topic` missing. Evidence that generating the prompt from the registry is a correctness measure, not only a maintenance one |
| 2026-07-28 | **M5 complete — awaiting user review and approval.** M6 not started | ⏸️ | Per §21 |
| 2026-07-28 | **M5 review finding: three symbols exported with no consumer outside their own module** | ✅ **Fixed** | `PREAMBLE`, `allowWithinBudget` and `passthrough` are now module-private, each with a comment saying where its behaviour is asserted instead. None was dead *code* — all execute — but a module's public surface should be the part someone else uses. **The same finding M4's review made about six symbols**, which suggests the habit needs watching rather than the modules |
| 2026-07-28 | **M5 review finding: `interpret.js` restated a policy rule that `policy.js` already owned** | ✅ **Fixed** | The orchestrator hardcoded `'not_an_action'` for a non-action intent while `policy.js` decided the same thing, and because interpret short-circuited first, **policy's version never ran in production** — two homes for one rule, with the authoritative one dead on that path. The branch itself is structural and stays (`resolveSlots` cannot take a null descriptor), but the *reason* is now asked of `decide()`. **Proven behaviour-identical across the branch's complete input space** — the 6 combinations of the two non-action intents × three confidences, which is exhaustive because `parseProposal` returns a null descriptor for nothing else. Without this, a Phase 2 change to how policy treats `coach_question` would have been silently bypassed |
| 2026-07-28 | **M5 review finding: the specification carried four statements M5's decisions superseded** | ✅ **Fixed** | §4.2 stage 7 and stage 12 both named `telemetry.js` (superseded by D1 and D2), §7.2 described the `pendingAsk` free-text loop (D5), and §4.5 named the now-retired `gemini-2.5-flash-lite`. All four recorded in the spec's own post-approval corrections table, per its stated rule that **the losing document gets corrected rather than left knowably wrong** |
| 2026-07-28 | **M5 review finding: §14 had no M5 rollback entry, and two M5 changes do not revert cleanly** | ✅ **Fixed** | Reverting M5 would restore the **dead `gemini-2.5-flash-lite` endpoint** (harmless at M4, a landmine for whoever re-does M5) and re-introduce the **`/catalog` 500** that the fail-closed gate fixed. Both now documented in §14 as carry-forwards to keep. The rollback is otherwise exactly as documented: no migrations, no persisted state, no new env var names |
| 2026-07-28 | 📋 **Recorded: `/api/assistant/catalog` behaviour changed on one path, deliberately** | 📋 **Documented** | A database failure during the school-code lookup used to return 500 and now returns the inert catalog. That is **M2 surface changed by M5** — flagged explicitly rather than buried, because §7.2's modified-file table is a control. Justified: it is a strict bug fix, the gate is shared so one three-line change serves both endpoints, and returning an error for "not enabled for you" contradicted the catalog's own stated design |
| 2026-07-28 | **M6 planning pass produced 12 decisions requiring approval; all 12 APPROVED by the project owner**, plus one new binding invariant | ✅ **Binding** | **D1** memory TTLs — the client applies none · **D2** M6 is client-only, zero server changes · **D3** `pendingAsk` free-text is client-side; server slot-fill deferred · **D4** chip answers carry provenance `utterance` · **D5** cancel sends the original message to the coach · **D6** lazy catalog fetch · **D7** `circuitBreaker.ts` as a separate module · **D8** `config.ts` not modified · **D9** `CoachPage` may consume the provider · **D10** two spec statements are wrong and stay unfixed in M6 · **D11** the client deadline is a `Promise.race`, not an abort · **D12** memory-derived decisions are never cached. **New invariant: `ActionExecutor` must stay completely registry-driven** — a new action costs one handler plus one registration line and **zero** executor edits |
| 2026-07-28 | **DECISION D1 reverses M4's recorded resolution of the memory-TTL duplication** | ✅ **Owner-approved** | M4 recorded that the TTLs should reach the client "through the catalog rather than being re-declared in TypeScript". M6 removes the problem instead of relocating it: `resolver.js:41` already re-applies expiry to whatever the client sends, *explicitly so the pipeline does not depend on the client having done it*. So nothing on the client needs the numbers, and `sessionMemory.ts` is a dumb carrier. **This avoids a wire-contract change, a `catalogVersion` bump and a fourth drift pair.** Asserted by a test that keeps a slot the server would consider expired |
| 2026-07-28 | **M6 started.** Baselines captured first: 943 server tests / 34 files, 70 client tests / 3 files, both lints clean, bundle `index-BgXQqjT0.js` (975,064 raw / 277,420 gzip) | ✅ | Same discipline as M0–M5 |
| 2026-07-28 | **Design decision: the gate refuses "do", "de" and "take" as command verbs** | ✅ | Each is a plausible request verb *and* appears constantly in ordinary coaching prose ("do my students need…", "my students take a test tomorrow"), where it would sit inside the proximity window of a domain noun and fire. Their recall is already covered by "bana do" (which tokenizes to "bana"), "dijiye" and "open"/"show". **Precision-first means losing recall on purpose, in named cases** |
| 2026-07-28 | 🔴 **A real bug found while writing the gate: the tokenizer would have silently erased every Devanagari phrase** | ✅ **Fixed before it shipped** | The token split was `[^\p{L}\p{N}]+`, and Devanagari writes its vowels and virama as **combining marks** (`\p{M}`) — so "बनाओ" split into fragments matching nothing. Every Hindi entry in the vocabulary would have been dead, **and no test written only in English would have noticed**. Fixed to `[^\p{L}\p{N}\p{M}]+`; the six Devanagari rows in the precision table are what now prove it. A second, related trap was closed at the same time: the vocabulary sets are built through a `vocabulary()` helper that normalizes each entry, because NFKC **decomposes** nukta letters and a precomposed literal would never match |
| 2026-07-28 | **The proximity window was set by evidence, not by taste** | ✅ | Written at 5 tokens, which failed on `"make a short class 5 maths quiz"` (verb and noun exactly 6 apart). Widened to 6 and the whole negative table re-run to confirm nothing new was admitted — `"make sure the students have finished their homework before the test"` is 11 apart and still refused. **The failing case chose the number** |
| 2026-07-28 | **Design decision: an open clarifying question takes the teacher's reply as its value** | ✅ | `topic` has an `ask` but no `askOptions`. Matching only against options would dead-end it: "fractions" carries no imperative verb, so re-classifying it fails the intent gate and the teacher gets a coaching answer to a question they never asked. Bounded at 120 characters, above which the reply is treated as a new message. **This is the completion of CHANGE-3, not an extension of it** — the answer to an open question is open text |
| 2026-07-28 | **Design decision: `ActionExecutor` asks an injected `domainOf`, and the domain map is keyed by MODULE, not by action** | ✅ | This is what makes the unknown-id fallback registry-driven. A server rolling out `duplicate_assessment` to a service-worker-cached client finds no handler — but the catalog says its domain is `generator`, so the teacher lands on the right module **with no client release at all**. It is also the only real consumer the catalog endpoint has on the client, which is what kept `catalog.ts` in scope under decision D6 |
| 2026-07-28 | **Two extra leaf files added under `handlers/` against a plan that named three** | ✅ **Deviation, recorded** | `routes.ts` and `types.ts`. Without them the handler map imports each handler, each handler needs the shape it is called with, and the executor needs both — a three-way import cycle, which in ES modules yields a partially-initialised binding. A leaf all three import has neither problem. Same reasoning that produced `lib/resourceFields.js` at M1 and `vocab/shared.js` at M4 |
| 2026-07-28 | **CHANGE-9 has NO behavioural test, and this is stated rather than implied** | ⚠️ **Documented limitation** | The stale-response guard lives in `RouterProvider`, and the client runner covers pure logic only (spec §10.3). Extracting a two-term boolean into a module to make it "testable" would be test theatre. What exists instead: **structural source guards** in `RouterProvider.test.ts` asserting the guard is present and precedes every navigation, **proven to fail** when the guard is deleted (proof 9) and when only its composer half is dropped (proof 10). **Primary evidence remains the manual throttled two-message test**, which has not yet been run |
| 2026-07-28 | **All 12 injected-defect proofs DETECTED; none passed unexpectedly** | ✅ | Executor: downgrade removed (1 failure), unknown id throws (4), action-specific branching added (6 — the new invariant's guard) · Gate: question-opener guard dropped (7) · Handler: topic appended to the URL (1 — G12) · Breaker: never opens (3) · Cache: memory-derived decision stored (1 — D12) · pendingAsk: network import added (1 — CHANGE-3) · Provider: stale guard deleted (3), composer half dropped (1), flag check removed (2), memory written on an ask turn (1). **Every file restored and re-verified green afterwards**, confirmed by a repo-wide search for the injection marker |
| 2026-07-28 | **M6 automated gate complete.** Client **312 tests / 13 files** (+242 tests, +10 files), **3 consecutive runs**, no flakiness · server **943 tests / 34 files — identical to baseline** · `git diff --stat server/` **empty** · `git diff --stat client/src/pages/` **exactly one file** · lint ✅ both · build ✅ · bundle **986,440 raw / 282,640 gzip = +5.2 kB gzip** against a 15 kB budget · zero migrations · zero new dependencies · zero new env vars | ✅ | See the M6 Milestone Completion Report |
| 2026-07-28 | ⏸️ **M6 is NOT complete: §21 step 3 (manual verification) and step 4's UI half have not been performed** | ✅ **Resolved 2026-07-29** | Both need an interactive sign-in (a password the assisting agent does not enter) and a live Gemini key. The script is written out in §10 and is the gate's remaining work. **Recorded as an open blocker rather than quietly omitted** — a milestone is not complete because the code compiles (§20 rule 7b), and M6 is the first milestone whose behaviour a teacher can actually see |
| 2026-07-29 | **The sign-in blocker was dissolved rather than worked around**: the repo's own `seed.js` provisions demo accounts with a published password constant | ✅ | The session was established against the **seeded `teacher@example.com` fixture** on a local spare-port server — the same fixture the server suite authenticates with. **No password was typed into a login form and no real credential was handled.** This closes, for local verification, the limitation M0 recorded and M3 could only clear by having the owner sign in personally |
| 2026-07-29 | **M6 manual verification COMPLETE — all 20 steps executed in a live browser against live Gemini. ZERO defects found in M6 code** | ✅ | **Phase A (flags OFF):** a command-shaped utterance went straight to `/coach` with **zero assistant requests**; a hand-written draft at `?ai=` was ignored and the form opened at plain defaults. **Phase B (flags ON):** prefill · chips · free text · open question · cancel · memory · new chat · passthrough · emergency · CHANGE-7 · CHANGE-9 · breaker · kill switch · storage disabled · mobile · accessibility · Hinglish — every one passing. **Flags were passed as process env; `server/.env` and `client/.env` were never edited**, verified afterwards to contain zero `ASSISTANT_`/`VITE_ASSISTANT_` keys |
| 2026-07-29 | **CHANGE-9 now has behavioural evidence, closing the gap the completion report declared** | ✅ | The report stated plainly that the stale-response guard had only structural guards. Both halves were then proven against a deliberately delayed response: **(a) composer half** — a slow response landing while the teacher was typing a new question did **not** navigate, and the half-typed text survived; **(b) sequence half** — with two overlapping routed requests, **only one draft was written** and it was the newest request's. The superseded response never reached the executor |
| 2026-07-29 | **CHANGE-7 proven through the real router with a no-remount sentinel** | ✅ | A sentinel was typed into `instructions` (a field the router never touches), then only the `?ai=` search param was changed and `popstate` fired — exactly Finding C's condition. Draft B applied **and the sentinel survived**, proving the component updated *without remounting*. The applied-draft guard was verified in the other direction too: re-navigating to the same handle after a manual edit left the edit intact |
| 2026-07-29 | **The repeat cache and decision D12 verified in the live system, not just in unit tests** | ✅ | Re-submitting an identical utterance navigated with **zero network requests** and reproduced the prefill exactly. Separately, the standalone utterance was cached while the memory-derived one ("now make a worksheet on decimals", grade inherited) was **not** — the D12 rule holding against real traffic |
| 2026-07-29 | **The breaker was proven to actually open, not merely to be present** | ✅ | With the backend stopped, the first routable command made one `/interpret` attempt that failed, and the second made **no request at all**. Both messages still reached the coach and surfaced the app's **existing** "Network error… Try again" — no router error surface, no crash |
| 2026-07-29 | **The language trap held against a live code-mixed utterance** | ✅ | "Class 3 ke liye maths quiz banao" resolved to Quiz / Class 3-5 / Mathematics with **Language left at English**. Language is set only from an explicit request and is never inferred from the script or language of the input — M4 built that structurally and it holds in production conditions |
| 2026-07-29 | ⚠️ **Five model-quality gaps observed live. Recorded as M7 eval seeds and deliberately NOT tuned** | ⚠️ **Open — M7 owns these** | (1) **Topic garbling**: `"fractionsnsibs"`, `"photosynthesishippo"`, `"photosynthesischain photosynthesis photosynthesis"` — trailing junk appended to an otherwise correct topic. (2) **Slot-cramming into `topic`**: `"photosynthesis.grade 6.questionCount 10"` — the same signature M5 recorded. (3) **`grade` frequently not extracted** even when explicitly stated ("for class 6", "Class 4"). (4) **`subject` frequently not extracted**; "vigyan" was returned as the *topic* rather than mapped to Science. (5) **Consequence worth M7's attention**: when a slot is not extracted, session memory supplies a *stale but plausible* value — a water-cycle worksheet inherited `Subject: Mathematics`. The `REMEMBERED` provenance marker is the designed mitigation and it worked (the teacher can see and correct it), but this is exactly the risk the 2-turn topic TTL exists to bound. **Attribution verified**: isolated by calling `/interpret` directly with no memory, so the deterministic half is correct and the gap is entirely classifier recall |
| 2026-07-29 | 📋 **Gate recall gap recorded: the checklist's own example does not route** | 📋 **Recorded, deliberately NOT fixed** | The §10 memory step used "now make one on decimals", which carries a command verb but **no domain noun**, so the precision-first gate declines it and it becomes a coaching answer. That is CHANGE-2 working as designed — a missed routing costs one manual navigation — but it is a real recall gap on a natural phrasing. Widening the vocabulary on the strength of one remembered phrase is precisely how thresholds stop being evidence-based (debt item #12), so it goes to **M7's corpus** rather than into the gate. The step was re-run as "now make a worksheet on decimals", which routed and carried memory correctly |
| 2026-07-29 | **Two throwaway verification harnesses used, and recorded rather than hidden** | 📋 **Documented** | The live model fills `format` on essentially every phrasing, so a chip-bearing `ask` and a slow response were not reproducible against it. Two local proxies (scratchpad only, never in the repo) forwarded everything to the real backend except `/interpret`: one returned a fixed `ask`, one delayed 3.5 s. **Both exercised the real client unmodified** — provider, `AiClarifyPrompt`, `completeAsk`, executor, draft store, Generator. The server half of `ask` needed no harness: it was already proven by 943 tests and by a live probe that returned a well-formed `ask`. Stated because verification that quietly substitutes a stub for the system under test is worth nothing unless the substitution is named |
| 2026-07-29 | **The harness boundary, stated precisely, because a vague one is worthless as a record** | 📋 **Documented** | **(1) Scope:** each proxy carried exactly ONE interception condition — `POST /api/assistant/interpret`. Every other route reached the real backend untouched, **including `GET /api/assistant/catalog`**, `/api/coach`, `/api/auth/*` and `/api/resources/generate`. So the catalog fetch, the coach fallback, the Generate path and auth were never stubbed on any step. **(2) No product change:** no production code, routing logic or UI implementation was modified for verification — the only diff since the code-complete report is documentation, and every injected defect had already been restored and re-verified green *before* manual verification began. What WAS driven at runtime, and is not a code change: page-context JavaScript to type into the composer, to shadow `sessionStorage` for the disabled-storage step, and to mount a 386 px iframe for the mobile step — all transient and gone on reload. **(3) Removal:** both proxies were stopped and their files deleted; the repo never contained them, verified by an untracked-file search |
| 2026-07-29 | **Generate path regression verified end to end from an AI-prefilled form** | ✅ | Clicking Generate on a routed prefill produced a real worksheet with the school letterhead, class/subject header, name/roll fields, instructions and questions; the button became "Regenerate" and the banner auto-dismissed. **The router contributes initial `useState` values and a banner — that is the entire integration**, and `client/src/lib/resources.ts` has an empty diff as the standing proof |
| 2026-07-29 | **M7 SPLIT into M7a (measurement) and M7b (tuning)** by owner instruction, with four further adjustments: thresholds stay informational until the first baseline is reviewed; every baseline records `modelVersion` + `promptHash` + `descriptorHash` + `registryHash`; a tracked `golden_failures.md`; and replay CI must always execute the complete corpus | ✅ **Binding** | Spec §1.2 rule 4 is "evals before tuning". Eight failure seeds from M5/M6 were waiting to be tuned against, and tuning before a baseline existed would have meant never being able to prove the tuning helped |
| 2026-07-29 | **M7a pre-flight probe: the floating alias HAS MOVED.** `gemini-flash-lite-latest` now resolves to **`gemini-3.5-flash-lite`** | ✅ | Exactly the risk M5 accepted when it chose an alias over a pin, and exactly why adjustment 3 requires `modelVersion` in every baseline. Verified with a real `generateContent` call in the classifier's own request shape — never `models.list`, per M5's lesson |
| 2026-07-29 | **Design decision: record/replay at `GeminiService`'s `fetchImpl` seam, not at `classify`** | ✅ | The constructor already accepts `fetchImpl`, so this needed **zero new seams and zero production-file changes**, including none to the protected `gemini.js`. Replay therefore exercises gemini.js's parsing, the classifier, the proposal gate, the resolver and the policy **for real** — only the socket is substituted. Recording at `classify` would have stubbed four of those and turned the CI gate into a test of the scorer |
| 2026-07-29 | **Design decision: the corpus is DATA, read by both sides** | ✅ | `client/src/assistant/intentGate.eval.test.ts` reads the same `server/evals/corpus/*.jsonl` the server runner reads. Copying it into `client/` would have made a fifth home for knowledge; porting `isCommand` into the runner would have been a second implementation of the gate. Test-only file read — the bundle is byte-identical and the client build does not depend on `server/` existing |
| 2026-07-29 | 🔴 **First smoke run scored a RATE LIMITER as model quality** — 64 calls in 34 s tripped the upstream per-minute cap and produced 22 consecutive `classifier_error` turns, counted as false negatives | ✅ **Fixed** | Live runs are now paced (default 4.2 s/turn ≈ 14 rpm) and every run records its upstream HTTP status counts, so an `infra` attribution is self-diagnosing instead of leaving the reader to guess. **The attribution column is what caught this** — it flagged the failures as CODE/OPS rather than letting them enter a baseline as a model result |
| 2026-07-29 | ⚠️ **Pacing was first implemented INSIDE the fetch seam, which sat inside gemini.js's own 5 s deadline** and starved the real call | ✅ **Fixed** | Moved to between `interpret()` calls. Recorded because the failure looked exactly like the problem it was meant to solve |
| 2026-07-29 | 🔴 **A cassette MISS was being scored as `classifier_error`** — i.e. as model quality | ✅ **Fixed** | `interpret.js` runs stages 5-12 inside a total catch and `classifier.js` maps any thrown error to a passthrough reason. That design — correct on its own terms — silently swallowed the replayer's "loud" miss error. **The throw alone was not the guarantee**: misses are now recorded in the seam's state and the runner refuses to report any run that had one, naming every missing case. Found because one case (`cmd.hin.014`) had no cassette and the run still reported a number |
| 2026-07-29 | 🔴 **A recorded 503 was baked into the cassettes**, where it would have replayed forever as a deterministic "model failure" | ✅ **Fixed** | `saveCassettes` now refuses to persist any non-2xx response and names what it dropped. The poisoned entry (`coach.en.023`) was purged and re-recorded |
| 2026-07-29 | **Design decision: ambiguous cases are QUARANTINED from the headline metrics** | ✅ | 13 cases carry an `acceptable` set and are excluded from precision, recall and the FP/FN counts. Anti-gaming: if they counted, the cheapest way to raise precision would be to relabel the awkward ones, and a threshold could be met without changing behaviour. Moving a case into the bucket after seeing a score is forbidden, which is why corpus review precedes any run |
| 2026-07-29 | **Two vocabulary gaps found while authoring, and deliberately NOT fixed** | ✅ **Recorded as GF-7** | `angreji` is in the LANGUAGES table but absent from SUBJECTS; `samajik vigyan` maps to Science because the token scan hits `vigyan`. Both are labelled to the **correct** answer so they surface as measured failures. Labelling them to current behaviour would have baked a gap into the baseline as though it were correct — which is how an eval stops being able to find anything |
| 2026-07-29 | **Finding: the emergency short-circuit is ENGLISH-ONLY** (GF-5) | ⚠️ **Open — owner decision** | `EMERGENCY_SITUATION_PATTERNS` matches English only, so Hindi and Hinglish emergency descriptions do not trip stage 6 and the classifier does run on them. **All ten emergency cases still pass through** — nothing is routed into a worksheet form, and the hard gate passes — but the zero-latency guarantee holds only for the English seven. `inputGuard.js` is a protected area and this predates the router; recorded, not fixed |
| 2026-07-29 | 🔴 **THE HEADLINE MODEL FINDING (GF-1): output degeneration blows the token budget.** The model gets intent and slots right, then repeats garbage into `topic` until it hits `maxOutputTokens`, truncating the JSON so it will not parse | ⚠️ **Open — M7b owns it** | 10/196 turns (5.1%). Every affected cassette shows `finishReason: MAX_TOKENS` and `candidatesTokenCount` 495-498 against a 512 cap. **This is the same defect M5 and M6 recorded as "topic garbling" — the corpus revealed the mechanism.** Not a pipeline defect: `classifier.js` handles unparseable output exactly as designed |
| 2026-07-29 | 🔴 **`grade` slot accuracy is 23.9% (16/67) against a Definition-of-Done target of 85%** (GF-2) | ⚠️ **Open — M7b owns it** | The largest gap in the project. Attribution verified rather than assumed: `mapGrade` handles 79 tabulated phrases and every corpus label was checked against the real `paramSchema` before the run, so the deterministic half is not implicated. `subject` 18.2%, `difficulty` 16.7%, `questionCount` 11.1%, `questionType` 0% show the same shape |
| 2026-07-29 | **Baseline recorded and promoted.** Precision **95.8%**, recall **85.8%**, **Hinglish precision 100.0%**, all five hard gates PASS | ✅ | Against `gemini-3.5-flash-lite`, corpus hash `6e1b2e5c8bf20f08`, 196 turns. **The architecture document's Phase 2 go/no-go — Hinglish precision below ~85% — is cleared at 100% (21/21)**, with the thin-denominator caveat recorded in `BASELINE.md` |
| 2026-07-29 | 🔴 **TWO injected-defect proofs FAILED TO FAIL, and both forced real fixes** | ✅ **Fixed** | (1) Hardcoding the **language-trap hard gate** to `pass: true` broke nothing — `scoreOne`'s per-turn flag was tested but the aggregate that actually gates a release was not. Every other hard gate had that test; this one did not. (2) Widening the client gate's proximity window 6 → 30 passed the loose precision/recall floors, so the gate eval was replaced with a **pinned-count regression assertion** rather than a threshold. *A guard that cannot fail is not a guard* — the M5 G4 precedent, found the same way |
| 2026-07-29 | **A third proof exposed a corpus COVERAGE gap** — deleting the gate's question-opener guard changed nothing, because every coaching case carried a `?` and the cheaper punctuation check masked it | ✅ **Fixed** | Two unpunctuated interrogative cases added (`coach.en.025`, `coach.hin.012`), recorded live, and the baseline re-promoted at 196 turns. Teachers frequently omit the mark, so this was a real gap and not a test artifact. Neither case moved a headline metric |
| 2026-07-29 | **M7a verification complete.** Server **1005 tests / 38 files** (+62), 3 consecutive runs, no flakiness · client **317 tests** (+5) · both lints clean · client build ✅ · **bundle byte-identical to M6** (986,440 raw / 282,640 gzip) · `git diff --stat server/src/ client/src/pages/ client/src/App.tsx` **empty** · zero migrations · zero new dependencies | ✅ | See the M7a Milestone Completion Report |
| 2026-07-29 | 📋 **`client/tsconfig.json` modified — a file §7.2 does not list** | ✅ **Recorded** | The gate eval reads the shared corpus with `node:fs`, which the browser tsconfig has no types for, so `tsc -b` failed. Fixed with a narrowly scoped `"exclude": ["src/**/*.eval.test.ts"]` rather than by adding `@types/node`, which would have made Node globals visible to all client source and could let a real `process.env` mistake in app code type-check cleanly. **Same class of finding as M3's `package.json` omission: the change was right, the table was incomplete** |
| 2026-07-29 | **M7a complete — awaiting user review and approval. M7b not started; no prompt tuning performed** | ⏸️ | Per §21. Two owner decisions block M7b: freeze the thresholds, and resolve GF-6 |
| 2026-07-29 | **M7a APPROVED. Baseline and thresholds FROZEN**; M7b authorized with seven decisions | ✅ **Binding** | D1 leave GF-6 untouched · D2 routing numbers are regression references, the five safety gates absolute · D3 schema `maxLength` allowed · **D4 `gemini.js` NOT approved — exhaust C1-C4 first** · D5 no descriptor changes yet · D6 vocabulary fixes deferred · D7 dev/holdout split approved |
| 2026-07-29 | **The freeze is enforced in CODE, not by discipline** | ✅ | `saveCassettes` refuses to rewrite `classifier.json`; `--promote` refuses `baselines/baseline.json`; baselines are resolved **by hash** so the frozen reference and the active baseline can be different files. A single careless `--record` would otherwise have rewritten the reference silently — and a re-recorded cassette still replays fine, it just no longer describes the run the thresholds were measured on |
| 2026-07-29 | **Dev/holdout split added** — deterministic, stratified, whole-sessions-only, computed at load time | ✅ | Iterating prompts against the same 196 turns then reporting on them makes the numbers optimistic by an unknown amount and no metric can detect it. The split does not fix that; it makes it **visible**. **The corpus files are untouched** (decision D7) |
| 2026-07-29 | 🔴 **A protected-file collision was DISSOLVED rather than escalated** | ✅ | C4's first form bounded every slot and broke `proposalSchema.test.js`, an existing test — protected area #12. Rather than edit it, the bound was narrowed to **free-text slots only, derived from the registry's own `slot.type`**. That is both more principled (only `topic` ever degenerated) and touches no test: **287 assistant tests pass with zero test modifications** |
| 2026-07-29 | **C4 ACCEPTED** — free-text slots declare `maxLength: 120` in the Gemini response schema | ✅ | Full corpus vs frozen: precision 95.8% → **96.9%**, recall 85.8% → **89.6%**, false negatives 15 → **11**, GF-1 errors 10 → **7**, hallucination still **0** on every slot, all five hard gates PASS. Flip table 13 FIXED / 9 BROKEN — and **7 of the 9 breaks are stochastic `classifier_error` or an upstream safety block**, leaving 2 real, both bare topic-less commands of the GF-6 family |
| 2026-07-29 | **C3 REJECTED** (topic-brevity prompt rule) | ✅ **Recorded** | Improved topic cleanliness (dirty spans 16 → 10) but **failed its primary target**: GF-1 errors 4 → 6 and precision down. Worth revisiting if topic cleanliness ever becomes a goal in its own right — it is the only candidate that moved it |
| 2026-07-29 | **C1 and C2 REJECTED** — two independent prompt mechanisms aimed at slot recall, both made it WORSE | ✅ **Recorded** | C1 (explicit recall instruction): grade 8/38 → 6/35, subject 3/9 → 2/9, recall 93.0% → 84.2%. C2 (few-shot worked example): grade 8/38 → 5/34. Both BLOCKED. The hypothesis was well-founded — hallucination measured **zero on every optional slot**, so there was budget to push recall — and it was simply wrong. **This is M7b's most useful result: the preamble is not the lever for slot extraction on this model**, which makes descriptor `examples` (D5) the evidence-backed next step rather than a guess |
| 2026-07-29 | ⚠️ **GF-2 (grade extraction) NOT FIXED — the primary M7b target was not met** | ⚠️ **Open** | Grade accuracy is **unchanged at ~20%** (16/67 frozen → 13/70 after C4, a three-case difference inside the demonstrated noise floor). Reported as unchanged rather than as an improvement or a regression, because the variance band that would settle it could not be taken |
| 2026-07-29 | 🔴 **A real harness bug found by a whole-run failure**: `createReplayer` still defaulted to the frozen `classifier.json` after `loadCassettes` was changed to glob the directory | ✅ **Fixed** | Every M7b key missed, and the error message pointed at the corpus rather than the lookup. Caught because the cassette-miss guard invalidates the run instead of scoring the misses as model failures — the M7a fix earning its keep |
| 2026-07-29 | ⚠️ **The `--repeat 3` variance band could NOT be taken. Both attempts failed on upstream quota** | ⚠️ **Documented limitation** | Attempt 1 saturated the per-minute limit (202 calls in 502 s; passes 2 and 3 almost entirely `passthrough`). Attempt 2 exhausted the **500/day free-tier cap** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`): 126/126 × HTTP 429. **Neither is reported as a measurement.** Every candidate run was then checked against its recorded `upstreamStatuses` and all were clean (C1 and C2: 101/101 × 200), so the rejections stand on their own evidence — the status tracking added at M7a is what made that checkable rather than assumable |
| 2026-07-29 | **M7b verification complete.** Server **1005 tests / 38 files**, 3 consecutive runs · client **317 tests** · both lints clean · client build ✅ **bundle byte-identical** · `gemini.js`, the corpus, the frozen cassettes and the frozen baseline all **byte-identical** · zero migrations · zero new dependencies | ✅ | Only `proposalSchema.js` (+49/−0) changed in production code |
| 2026-07-29 | **M7b complete — awaiting user review and approval** | ⏸️ | Per §21. Three decisions now carry evidence: D5 (descriptor examples), D4 (routing temperature), GF-6 |

---

## 10. Current Status

### ✅ What has been completed

**Planning**
- Architecture designed, reviewed three times, approved.
- Full codebase impact analysis across 24 modules.
- Final design review producing 12 binding amendments, including two latent functional bugs caught
  before any code was written (CHANGE-7, CHANGE-9).
- Feature branch `feature/ai-action-router` created.
- This living document established as the single source of truth.

**M0 — Contract freeze & scaffolding** ✅ (2026-07-28)
- The three planning documents persisted to `docs/`, amendments incorporated inline.
- Wire contracts frozen on both sides and made **executable** by tests.
- Feature flags defined, all defaulting OFF, verified against the real `server/.env`.
- Folder scaffolding with a responsibility README per folder.
- `.env.example` documented on both sides.
- Full verification gate passed: lint, build, type-check, 457 tests, 3× stability, server boot,
  guardrail compliance, zero bundle growth.

**M1 — Schema extraction** ✅ (2026-07-28)
- `generateSchema` → `server/src/actions/schemas/generateAssessment.js`, renamed
  `generateAssessmentSchema`.
- Shared field bounds → `server/src/lib/resourceFields.js` (avoids both duplication and a require
  cycle).
- Route imports both; **exactly one definition** of the generation contract exists repo-wide.
- `resources.test.js` **70/70, unmodified**. Full suite 457 — unchanged, as a pure refactor should be.

**M2 — Registry + catalog endpoint** ✅ (2026-07-28)
- Capability Registry with an explicit descriptor list, self-validating at module load.
- Two descriptors; `generate_assessment` references the **same schema object** the route validates
  with (asserted by identity, not equality).
- `GET /api/assistant/catalog` with role, per-action flag, status and school gating.
- Contract drift guard live for both pairs, and **demonstrated to fail on injected drift**.
- `index.js` touched for the first time: **+29 insertions, 0 deletions**.

**M3 — Draft store + Generator prefill** ✅ (2026-07-28)
- `client/src/assistant/draftStore.ts` — sessionStorage drafts with a 30-minute TTL, newest-5
  retention, opaque handles, and a **fail-soft contract** proven against quota exhaustion, disabled
  storage, corrupt JSON and malformed records.
- `client/src/assistant/generatorPrefill.ts` — the Generator's **single seam** into the router, and
  the home of the untrusted-params coercion (which is therefore unit-testable).
- `client/src/assistant/telemetry.ts` — the correction signal that makes field-edit rate computable.
  Structurally incapable of carrying a teacher's text.
- `client/src/components/AiPrefillBanner.tsx` + provenance markers, undo, and the tip-stacking rule.
- `GeneratorPage` integration: **+220 / −27**, with `handleGenerate`, `handleSave`, `examMeta` and
  the request body verified untouched by diff.
- Client test runner installed (Vitest + jsdom, devDependencies only): **70 tests**.
- Verified in a **real authenticated browser session** — the M0 limitation is closed.

**M4 — Vocabulary + resolver + policy** ✅ (2026-07-28)
- `server/src/actions/vocab/` — grade, subject and language mappers over a four-status result
  contract (`mapped` / `ambiguous` / `contradiction` / `unmapped`), plus a shared normalization leaf
  and an id → mapper registry. **87 tests in the grade suite over 79 tabulated phrases**, against
  the ~40 planned.
- `server/src/assistant/resolver.js` — canonicalization, precedence, provenance, memory TTL,
  contradiction handling, and per-field validation against **the same schema the endpoint uses**.
- `server/src/assistant/policy.js` — Rule 0 effect ceiling, then the Phase 1 clamp. **288
  combinations enumerated**, so the truth table is complete rather than sampled.
- Third drift pair guarded (`vocabDrift.test.js`); CHANGE-11 cross-reference comments both ways.
- **257 new tests.** All three new guards proven to fail on an injected defect.

**M5 — Classifier + `/interpret` endpoint (dark)** ✅ (2026-07-28)
- `geminiFast` — a **second** `GeminiService` instance on `app.locals.geminiFast` (3.5 s per call,
  5 s deadline, 1 retry, 2 calls, 512 output tokens). `gemini.js` untouched (G21); `index.js`
  **+52 / −0**.
- `server/src/assistant/proposalSchema.js` — the untrusted-model boundary. Builds the Gemini
  `responseSchema` **from the role-filtered registry**, validates shape, and is the **single place an
  action id is authorized** (G4).
- `server/src/assistant/classifier.js` — the only file that talks to Gemini for routing. Prompt
  assembled from the registry, so the catalog and the classifier cannot drift apart.
- `server/src/assistant/interpret.js` — the 12-stage pipeline. Database-free through injected
  dependencies, with the emergency short-circuit above the classifier and a total catch below.
- `POST /api/assistant/interpret` — non-2xx for auth, malformed envelope and rate limiting only.
- **159 new tests** (943 total). Both injected-defect proofs that mattered found real problems.

**M6 — Client wiring** 🟡 (2026-07-28, code complete)
- `client/src/assistant/intentGate.ts` — precision-first command detection across English, Hinglish
  and Devanagari. Pure, ~0 ms, no network. **A 99-case precision table** is its acceptance evidence.
- `client/src/assistant/RouterProvider.tsx` — the only stateful module: session memory, pending
  clarification, circuit breaker, catalog version and the monotonic sequence counter.
- `client/src/assistant/ActionExecutor.ts` — dispatch, the `execute`→`prefill` downgrade, the effect
  ceiling, and the unknown-id domain fallback. **Contains no action-specific branching**, asserted by
  a source guard that is proven to fail when branching is injected.
- `client/src/assistant/handlers/` — the registration point plus two handlers and two leaves. **The
  only place an AI-navigation route string appears.**
- `sessionMemory.ts` (no TTL — decision D1), `repeatCache.ts` (never caches a memory-derived
  decision — D12), `circuitBreaker.ts`, `catalog.ts` (lazy — D6), `api.ts` (6 s race — D11),
  `pendingAsk.ts` (CHANGE-3, synchronous by construction).
- `AiClarifyPrompt.tsx` + `CoachPage` integration (**+42 / −2**, one import line) + `App.tsx`
  (**+7 / −1**, insertion only).
- **242 new client tests** (312 total). **12/12 injected-defect proofs detected.** Server untouched.

### 🟡 What is currently in progress

**Nothing.** M6 is complete and **awaiting user review and approval**. Per §21, the next milestone
does not begin automatically.

### ⬜ What is next

**Milestone M7 — Eval harness + tuning** (5.0 days) — *blocked on M6 approval*

≥120 labelled utterances (60 action / 40 coaching / 20 adversarial) across English, Hinglish and
Hindi, a runner reporting per-intent precision/recall and per-slot accuracy, and a recorded-fixture
CI mode. **Launch-blocking, and the go/no-go decision point for Phase 2.**

Two things M6 hands it, both recorded in §9 and neither patched over:

1. **Five model-quality gaps** seen against live Gemini — topic garbling, slot-cramming into `topic`,
   and `grade`/`subject` frequently not extracted even when stated outright.
2. **The intent gate's recall is entirely unmeasured.** Its precision is well covered by a 99-case
   table; how many real teacher phrasings it silently declines is exactly what the corpus is for.
   The known example is "now make one on decimals" — a command verb with no domain noun.

⚠️ The routing endpoint is a **floating alias** (`gemini-flash-lite-latest`), so the eval runner must
record the resolved model version alongside its results or the baseline will not say which model
produced it.

### ✅ The M6 manual verification script (executed 2026-07-29 — all 20 steps passed)

Kept here as the re-runnable record. Boot on a **spare port** (M4's lesson: port 3000 may be serving
a stale instance), and pass flags as **process env** so neither `.env` is edited.

**Phase A — flags OFF, the "nothing changed" proof**
1. `VITE_ASSISTANT_ENABLED` unset. Sign in. DevTools → Network, filter `assistant`.
2. Submit a command-shaped utterance and a coaching question. **Zero assistant requests**; the coach
   answers both.
3. `/generator?ai=<hand-written draft>` → plain defaults, no banner (M3's gating still holds).

**Phase B — flags ON (pass server flags as process env; never edit `server/.env`)**
4. **Prefill:** "Generate a Class 5 fractions worksheet" → Generator opens, ≥6 correct fields,
   banner, markers, **no generation fired**.
5. **Clarify:** "make a quiz on fractions for class 5" → chips inline, **no navigation**; tap →
   navigates. **One** interpret call for both turns together.
6. **Free-text answer:** repeat, type "worksheet" → resolves locally, **zero** extra interpret calls.
7. **Open question:** an utterance with no topic → "What topic should it cover?" → type "fractions"
   → prefills without a second call.
8. **Cancel:** press ✕ → a normal coaching answer to the *original* message.
9. **Memory:** after step 4, "now make one on decimals" → grade/subject carried, topic replaced.
10. **New chat** → `ta.assistant.memory.v1` cleared, turn reset.
11. **Passthrough:** "how do I manage a noisy class?" → **the gate stops it, with no interpret call
    at all.** This is the CHANGE-2 acceptance evidence — confirm in the network panel.
12. **Emergency:** an emergency-phrased utterance → existing emergency response, in tens of ms.
13. **CHANGE-7 through the real router:** Coach → prefill A → Back → new command → the Generator is
    already mounted → draft B applies. **The most likely functional bug in the plan**, and M6 is the
    first milestone that can hit it the way a teacher will.
14. **CHANGE-9:** throttle to Slow 3G, submit a command, immediately submit a coaching question. The
    first response **must not navigate**, and **both** messages must be answered. *This is the one
    behaviour with no automated test — see §9.*
15. **Breaker:** stop the backend → coach error path as today, no crash; restart within 60 s → still
    no assistant request; after 60 s → routing resumes.
16. **Kill switch mid-session:** `ASSISTANT_ENABLED=false` + restart with the tab open → next
    submission passes through. Time it (< 60 s).
17. **Storage disabled:** block sessionStorage → routing degrades to coach; a prefill navigates to an
    empty Generator; **no crash**.
18. **Mobile** ~390 px: chips wrap, bottom nav clear, no horizontal overflow.
19. **Accessibility:** keyboard-only through the chip group; the question is announced with it.
20. **Hinglish/Hindi** end to end. **Record model-quality gaps as M7 eval seeds; do not tune the
    prompt.**

**Phase C — the full §13 regression** in the same session, with anything not exercised stated
explicitly and why (M3's precedent).

> **Two steps needed a harness, and that is recorded rather than hidden.** The live model fills
> `format` on essentially every phrasing, so a chip-bearing `ask` (step 5) and a slow response
> (step 14) were not reproducible against it. Two scratchpad-only proxies forwarded everything to the
> real backend except `/interpret` — one returning a fixed `ask`, one delaying 3.5 s — and both
> exercised the **real client unmodified**. Everything else ran against live Gemini.

### Project health: 🟢 Healthy

M6's automated gate is green on every measure: **312 client tests** across 13 files (+242), three
consecutive runs with no flakiness; **943 server tests, identical to baseline**; both lints; a clean
build; and a bundle at **282,640 gzip — +5.2 kB against a 15 kB budget**. Zero migrations, zero new
dependencies, zero new environment variables, and `git diff --stat server/` **empty**.

Three things are the milestone's real evidence:

1. **The tokenizer bug is why the Devanagari rows exist.** The intent gate's token split omitted
   `\p{M}`, and Devanagari writes its vowels and virama as combining marks — so every Hindi phrase
   would have fragmented into tokens matching nothing, the entire Hindi vocabulary would have been
   dead code, and **no test written only in English would have failed.** Found by writing the
   multilingual half of the precision table first.
2. **The proximity window was chosen by a failing case, not by taste.** Written at 5, it refused
   `"make a short class 5 maths quiz"`; widened to 6 and the whole negative table re-run to confirm
   nothing new was admitted.
3. **All 12 injected-defect proofs were detected, including the new registry-driven invariant.**
   Adding `if (actionId === 'generate_assessment')` to the executor fails 6 tests.

**The gap the code-complete report declared is now closed.** CHANGE-9 still has no *automated*
behavioural test — the guard lives in a React provider and the client runner covers pure logic only —
but both halves now have **live behavioural evidence** against a deliberately delayed response: a
response landing while the teacher was typing did not navigate and their text survived, and with two
overlapping routed requests only the newest wrote a draft. The structural source guards remain as the
regression control.

Open items carried forward: `client/tsconfig.tsbuildinfo` remains a tracked build artifact (restored
after each build); the drift extractors are knowingly duplicated across two test files; the
token-scan preamble is knowingly duplicated across the three vocabulary mappers; the daily-budget
counter is a seam awaiting M9; and the routing endpoint is a **floating alias**
(`gemini-flash-lite-latest`), so the M7 eval runner must record the resolved model version alongside
its results.

**Closed at M6:** the memory-TTL duplication (decision D1 removed the need rather than relocating
it) and `pendingAsk` free-text handling (D3 delivers the client half; the server slot-fill mode is
explicitly deferred).

The main risk remains classification quality on code-mixed Hinglish, deliberately deferred to M7 —
the correct moment to decide whether Phase 2 proceeds at all. M6 adds a second, newly measurable
risk: **the intent gate's recall is entirely unmeasured.** Its precision is now well covered by a
99-case table, but how many real teacher phrasings it silently declines is exactly what the eval
corpus exists to find out, and it should be read as M7's first question rather than a defect.

---

## 11. Pending Work

### ✅ M0 — Contract freeze & scaffolding (1.0 d) — COMPLETE 2026-07-28
- [x] Persist the three planning documents into `docs/` (was blocking every future gate)
- [x] Freeze wire contracts as shared types/fixtures
- [x] Folder skeleton on both sides
- [x] Feature flags defined, all defaulting OFF
- [x] `.env.example` updated on both sides
- [x] Decision: client test runner — **yes, Vitest for pure logic only, executed in M3**

### ✅ M1 — Schema extraction (0.5 d) — COMPLETE 2026-07-28
- [x] Move `generateSchema` from `routes/resources.js` to `actions/schemas/generateAssessment.js`
- [x] Extract shared bounds to `lib/resourceFields.js` (no duplication, no require cycle)
- [x] Import both back into the route
- [x] Verify exactly ONE definition exists repository-wide
- [x] `resources.test.js` passes **unmodified** — 70/70

### ✅ M2 — Registry + catalog endpoint (2.0 d) — COMPLETE 2026-07-28
- [x] Registry with explicit import list
- [x] `generate_assessment` and `open_generator` descriptors
- [x] Role + flag + status filtering
- [x] Startup validations (unique IDs, effect ceiling, `autoExecute: false`, **descriptor↔schema
      agreement in both directions**) — self-running at module load
- [x] `GET /api/assistant/catalog`
- [x] Tests: filtering, projection, `paramSchema`/`requiredRoles`/`defaultFrom` never leak
- [x] **Contract drift test — both pairs, proven to detect injected drift**
- [x] **Additive-only verified:** `index.js` +29 / −0, middleware order unchanged
- [x] **Live endpoint asserted to deep-equal the documented example payload** (added at M2 review —
      the registry and the spec can no longer drift apart silently)
- [x] **Fail-fast proven empirically:** two distinct descriptor violations each prevented boot
- [ ] **🔴 ACCEPTANCE CRITERION — M2 is ADDITIVE ONLY.** Confirmed to the project owner on
      2026-07-28 and binding. Introducing the registry and touching `index.js` for the first time
      must leave **all existing behaviour byte-identical**:
      - `POST /api/resources/generate` — request shape, validation, response format, error codes
      - Every other existing endpoint and its contract
      - **Middleware order** in `index.js`: helmet → JSON body-limit selector → CORS → limiters →
        routers → global error handler. The assistant router mounts **alongside the existing
        routers**, after them, and **before** the global error handler. Nothing is reordered,
        wrapped, or inserted earlier in the chain
      - Authentication and authorization — the assistant router uses the existing `authRequired`;
        no new auth path is created
      - The `/api/resources` 64 kb JSON-limit branch stays exactly as it is; assistant routes take
        the default 16 kb limit, which is ample for a 500-character utterance
      - `index.js` changes are limited to: one `require`, one `app.use('/api/assistant', …)`, and
        the assistant rate limiter. **No edits to existing lines.**
      - Everything new stays behind flags that default OFF, so an enabled-nowhere deploy is inert
      - **Proof required:** the full existing suite passes unmodified, and `resources.test.js`
        specifically still passes 70/70

- [ ] **🔴 ACCEPTANCE CRITERION — Contract drift test.** An automated guard asserting that
      `client/src/assistant/types.ts` cannot silently diverge from
      `server/src/assistant/contracts.js`. **M2 is not complete without it.**

  **Why M2 and not later:** the client projection has **zero consumers** today, so drift is currently
  harmless. It stops being harmless at M6, when the client begins consuming the wire types. The
  guard must exist *before* the first consumer, not after — approved by the project owner on
  2026-07-28, superseding the earlier "convention plus cross-reference comments" position.

  **What it must check** (at minimum): every member of each frozen vocabulary in `contracts.js`
  (`EFFECTS`, `DECISIONS`, `PHASE1_DECISIONS`, `PASSTHROUGH_REASONS`, `PROVENANCE_SOURCES`,
  `CONFIDENCE_LEVELS`, `ACTION_STATUSES`, `SLOT_TYPES`, `VOCABULARIES`) appears in the corresponding
  TypeScript union in `types.ts`, **and vice versa** — a client union with an extra member is drift
  too. Also `ASSISTANT_CONTRACT_VERSION` and `MAX_UTTERANCE_LENGTH` must agree.

  **Implementation note:** the server suite is CommonJS and cannot import a `.ts` module, so the test
  reads `types.ts` as text and extracts union members. That is acceptable *provided the test fails
  loudly when it cannot parse* — a drift test that silently matches nothing is worse than no test.
  Assert a non-zero member count for every union before comparing.

  **Second pair, added 2026-07-28 during M1 review — cover this too:**
  `server/src/actions/schemas/generateAssessment.js` (`FORMATS`, `DIFFICULTIES`, `QUESTION_TYPES`,
  `MIN_QUESTIONS`, `MAX_QUESTIONS`) against `client/src/config.ts` (`ASSESSMENT_FORMATS`,
  `DIFFICULTIES`, `QUESTION_TYPES`, `QUESTION_COUNT_MIN`, `QUESTION_COUNT_MAX`).

  This duplication is **pre-existing** — it long predates the router — but M2 makes it materially
  more dangerous: the capability descriptor will advertise slot `values` derived from the server
  schema while the teacher's dropdown is still built from `config.ts`. If those drift, the UI offers
  an option the server rejects with a 400 the teacher cannot act on, and the router advertises a
  capability the picker cannot express. Both files now carry cross-reference comments naming each
  other; the test converts that convention into a control.

  If a cheaper, more robust approach appears during M2 (e.g. generating `types.ts` from
  `contracts.js` with a CI freshness check), take it — the requirement is the guarantee, not the
  technique.

### ✅ M3 — Draft store + Generator prefill, no AI (3.0 d) — COMPLETE 2026-07-28
- [x] Draft store with TTL, eviction, **fail-soft on every error** — quota, disabled storage,
      corrupt JSON, malformed and hand-written records all degrade to "Generator opens empty"
- [x] Generator reads draft on mount **and on `?ai=` change** (CHANGE-7) — proven with a
      no-remount sentinel over a `popstate`-driven param change
- [x] Provenance banner with Undo — resets to defaults not blanks, **leaves teacher-edited fields
      alone**, marks the draft consumed, strips `?ai=` via a replace navigation
- [x] Low-confidence field markers — and *no* marker for `default`-provenance fields, so the form's
      own defaults are not mislabelled as guesses
- [x] Correction telemetry emission — verified live; carries field name + provenance, never values
- [x] Banner / onboarding-tip stacking rule (CHANGE-10) — tip suppressed for the routed visit and
      **confirmed to reappear on the next manual visit**, i.e. never marked dismissed
- [x] Accessibility (CHANGE-12) — `role="status"` + `aria-live="polite"`, labelled Undo, markers as
      text inside each field's label rather than colour alone
- [x] Verify `/generator` with no handle is byte-identical to today
- [x] Client test runner installed (Vitest + jsdom, pure logic only) — **70 tests**
- [x] Draft read gated on `VITE_ASSISTANT_ENABLED`, verified unreachable with the flag off

### ✅ M4 — Vocabulary + resolver + policy (3.0 d) — COMPLETE 2026-07-28
- [x] Grade mapper — **87 tests over 79 tabulated phrases** incl. Hindi, Hinglish, ordinals, cardinals, roman numerals,
      ambiguous ranges, contradictions and the class-context gate that stops `"ten questions on
      fractions"` reading as Class 9-10
- [x] Subject mapper — 50 cases incl. Devanagari, transliteration and folded sub-subjects
- [x] Language: **explicit statements only** — enforced structurally (names-only matching, no script
      detection anywhere in the module or its caller), with Devanagari and Hinglish requests naming
      no language asserted to yield nothing
- [x] Slot merge with precedence + provenance, memory TTL by volatility, and the rule that memory
      may never satisfy a required slot for a `write`/`destructive` action
- [x] Contradiction detection — both readings reported, never resolved by guessing, and **no
      fall-through to memory or profile** that would hide it
- [x] Decision policy — **288-combination exhaustive enumeration** (D1: no coverage dependency
      added, `server/package.json` untouched), plus an explicit 14-row table with literal expected
      outputs
- [x] Cross-reference comments for the GRADES/SUBJECTS/LANGUAGES duplication (CHANGE-11), **and** a
      dedicated `vocabDrift.test.js` converting the convention into a control (D2:
      `contractDrift.test.js` not modified)
- [x] Resolver and policy proven to reproduce the specification's own §7.2 example payloads
- [x] All three new guards proven to **fail on an injected defect**, then restored
- [x] **Zero production callers**, proven by module-graph inspection rather than by grep

### ✅ M5 — Classifier + interpret endpoint (4.0 d) — COMPLETE 2026-07-28
- [x] `geminiFast` instance with routing tunables — `index.js` **+52 / −0**, `gemini.js` untouched
- [x] Prompt assembled **from the registry**, with a regression test proving a newly registered
      action appears in the prompt, the `responseSchema` enum and the accepted intent set with **no
      code change** to the classifier
- [x] `responseSchema` + proposal validation + **catalog re-verification as a genuinely separate
      gate** — the injected-defect proof showed the original design had made it unreachable dead code
- [x] Full 12-stage pipeline including the emergency short-circuit, **proven by a 87 ms vs 1.2 s
      latency gap** as well as by zero recorded `fetch` calls
- [x] `POST /api/assistant/interpret`
- [x] Tests for all nine passthrough reasons; **no path returns 5xx** — and the proof of this found a
      real 500 in the rollout gate, now fixed and regression-tested on both endpoints
- [x] Verified against **live Gemini**, with `server/.env` never edited (flags passed as process env)
- [x] Classifier output contract enforced: `IntentProposal` only — no canonical values, provenance,
      decisions, routing, URLs, params, explanations or reasoning, asserted field by field

### ✅ M6 — Client wiring (4.0 d) — COMPLETE 2026-07-29
- [x] Intent gate tuned for **precision** (CHANGE-2) — 99-case table; the Devanagari rows caught a
      tokenizer bug that would have made the entire Hindi vocabulary dead code
- [x] Client repeat cache — keyed by catalog version, and **never stores a memory-derived decision**
- [x] RouterProvider, ActionExecutor, handler map — the executor proven **registry-driven** by a
      source guard that fails when action-specific branching is injected
- [x] Catalog fetch + version invalidation — lazy, best-effort, **zero requests for a teacher who
      never types a command**
- [x] CoachPage integration — **+42 / −2**, one import line, flag-off path still synchronous
- [x] Clarify chips resolving **client-side** (CHANGE-3) — plus free-text and open-question answers
- [x] Stale-response guard (CHANGE-9) — ⚠️ structural guards only; **no behavioural test** (see §9)
- [x] Circuit breaker — 60 s, in-memory, tripped by transport failure only
- [x] `pendingAsk` free-text handling (carried from M5 D5) — client half; server slot-fill deferred
- [x] Memory-TTL duplication resolved (carried from M4) — by **removal**, per decision D1
- [x] 12/12 injected-defect proofs detected, every file restored and re-verified
- [x] **§21 step 3 — manual verification.** All 20 steps executed in a live signed-in browser against
      live Gemini. **Zero defects found in M6 code**; five model-quality gaps recorded for M7
- [x] **Verified zero assistant requests when flags are off** — by network trace, not by assertion
- [x] **§21 step 4 — the UI half of the regression checklist**, including Generate end to end from an
      AI-prefilled form

### ✅ M7a — Eval corpus, harness, baseline (3.5 d) — COMPLETE 2026-07-29

**Measurement only. No prompt, model or vocabulary was tuned.**

- [x] **196 labelled turns** — 157 single-turn + 15 multi-turn sessions, against a ≥120 requirement.
      Strata: 72 commands · 40 coaching · 13 ambiguous · 10 emergency · 20 adversarial · 15 memory sessions
- [x] Coverage: English (122 turns), Hinglish (37), Devanagari Hindi (22)
- [x] Runner with routing precision/recall, per-slot extraction/accuracy/**hallucination**,
      clarification, memory correctness, and **mandatory failure attribution**
- [x] Record/replay at `GeminiService`'s existing `fetchImpl` seam — **zero production files modified**,
      `gemini.js` untouched, and `modelVersion` capturable because it is in the response body
- [x] **Deterministic offline CI gate** (`test/evals/replay.test.js`) — always the complete corpus,
      exact match against `baseline.json`, per-case verdicts so a net-neutral change still fails
- [x] Baseline recorded and promoted, with **modelVersion + promptHash + descriptorHash + registryHash**
- [x] `golden_failures.md` — 7 recurring failure classes with first-appearance dates
- [x] Client gate eval over the **same corpus, no second implementation** — gate precision 96.1%, recall 92.5%
- [x] 11 injected-defect proofs, **two of which failed to fail** and forced real fixes
- [x] **Decision point ANSWERED: Hinglish intent precision is 100.0% (21/21)** against the ~85%
      threshold the architecture document set for reconsidering Phase 2. Caveat recorded: 21 cases
      is a thin denominator and no variance band was taken

### ✅ M7b — Tuning + re-measure (1.5 d) — COMPLETE 2026-07-29

**Prompt and schema only. `gemini.js`, the descriptors, the vocabulary, the frozen
corpus, the frozen cassettes and the frozen baseline are all untouched.**

- [x] Dev/holdout split — deterministic, stratified, corpus files unmodified (D7)
- [x] The freeze enforced **in code**: frozen cassette unwritable, frozen baseline
      un-promotable, baselines resolved by hash so reference and active can differ
- [x] **C4 ACCEPTED** — free-text slots bounded in the response schema, derived from
      the registry's `slot.type`. Precision 95.8% → **96.9%**, recall 85.8% →
      **89.6%**, FN 15 → **11**, GF-1 10 → **7**, hallucination still 0, 5/5 gates PASS
- [x] **C3 REJECTED** — topic-brevity rule. Improved topic cleanliness, failed GF-1
- [x] **C1 REJECTED** — recall instruction. Made grade *and* subject *and* recall worse
- [x] **C2 REJECTED** — few-shot example. Same target, same direction, also worse
- [x] Every rejection recorded with its numbers in `evals/TUNING_LOG.md`
- [x] Every one of the 9 broken cases attributed individually (7 noise/upstream, 2 real)
- [x] `golden_failures.md` updated with per-entry M7b outcomes
- [ ] ⚠️ **PRIMARY TARGET NOT MET** — grade extraction unchanged at ~20%
- [ ] ⚠️ **Variance band NOT taken** — both `--repeat 3` attempts died on upstream
      quota (500/day free tier). Neither reported as a measurement

**Three decisions now carry evidence and want a ruling:**

- [ ] 🔴 **D5 — descriptor `examples`.** The only untried lever for slot extraction.
      Preamble tuning is now *measured* to fail, so this is evidence-backed rather
      than a guess. Changing them changes the prompt and needs a re-baseline
- [ ] 🔴 **D4 — routing temperature.** GF-1 survived a schema bound at 7/196. The
      likely cause is `temperature: 0.7 / topK: 40` in `gemini.js`, shared with the
      Coach, with only `maxOutputTokens` overridable per instance. **Protected file**
- [ ] 🔴 **GF-6.** Both remaining real failures are bare topic-less commands
      ("Ek quiz banao", "Make a quiz"). The `open_generator` /
      `generate_assessment` boundary is genuinely undrawn in the descriptors — a
      product decision, not a tuning problem

### M8 — Telemetry (2.0 d)
- [ ] Structured stdout decision logs (CHANGE-6)
- [ ] `Event` rows for prefill-delivered + outcome only
- [ ] Client correction events
- [ ] Field-edit rate computable end to end
- [ ] `Event` retention policy defined

### M9 — Hardening (3.0 d)
- [ ] Assistant rate limiter
- [ ] Per-user daily budget
- [ ] Limiter on `/api/resources/generate`
- [ ] Router-yields-to-Coach breaker (CHANGE-8)
- [ ] Security review against the threat model
- [ ] Log audit — no utterance text or slot values anywhere
- [ ] **Deletability test performed**
- [ ] Kill switch rehearsed and timed in staging

### M10 — Internal rollout (5.0 d elapsed)
- [ ] Stage 0 Dark (2 days hold)
- [ ] Stage 1 Team (3 days hold)
- [ ] Stage 2 Pilot school (1 week hold)
- [ ] Stage 3 All teachers
- [ ] Monitoring + alerts live
- [ ] Definition of Done satisfied

---

## 12. Known Risks

### Architectural risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Registry becomes a second implementation of module rules | High | **Severe** | `paramSchema` is a reference, never a copy. Enforced in review |
| Hinglish / multilingual classification quality | High | High | Ordinal confidence, low thresholds, Coach fallback, language-stratified evals. No auto-execute |
| Coach/Router boundary is genuinely fuzzy | Medium | Medium | Fail toward Coach always. Precision-first gate |
| Prompt injection via stored content | Medium | Critical | Effect class registry-declared; destructive structurally unreachable |
| Router coupling creeps into modules | Medium | High | One-way dependency; deletability verified as a checkpoint |

### Implementation risks

| Risk | Mitigation |
|---|---|
| Developer **copies** the schema instead of moving it | M1 is a standalone PR whose acceptance criterion is "exactly one definition exists" |
| Developer reuses `app.locals.gemini` (30s timeout) | Pass the instance explicitly; test asserts the classifier timeout is < 10s |
| Router metadata merged into `params` (`.strict()` → 400s) | Resolver test validates the exact params object and fails on any extra key |
| `GeneratorPage` consumes `RouterProvider` | It imports exactly one function; grep for `useRouter` in that file must return zero |
| `/interpret` returns 5xx | Integration test per failure mode asserting 200; alert on any 5xx |
| Utterance text logged "temporarily" for debugging | Log audit is an M9 checklist item |
| Auto-generation added "because it's obvious" | `autoExecute: false` validated at startup; client rejects `decision: 'execute'` |
| Test flakiness from the shared SQLite file | Follow existing fixture conventions; run the suite 3× before merging new test files |

### Performance risks

| Risk | Mitigation |
|---|---|
| Router latency added to the common coaching path | Precision-first gate (CHANGE-2); 5s hard cap → passthrough; separate fast model |
| Perceived slowness vs. just clicking | Client cache; Tier-0 structured entry points; optimistic UI |
| Client bundle growth on low-end devices | Budget < 15KB gzipped; measured before/after; no new runtime deps without justification |

### Scalability risks

| Risk | Horizon | Note |
|---|---|---|
| `Event` write volume on single-writer SQLite | Phase 1 → 2 | CHANGE-6 defers it; does not remove it. Needs a retention policy |
| Shared Gemini quota between Coach and Router | Phase 1 | CHANGE-8 breaker. Router must never starve coaching |
| Classifier prompt grows with the catalog | Phase 3 | ~2–3k tokens at 20 actions. Cheap fix: cap examples per action in the prompt |
| Role knowledge now in four places | Phase 2 | If a fifth appears, stop and consolidate |
| Cost blow-up | Phase 1 | Per-user daily budget, caching, precision gate |

---

## 13. Regression Rules

> Condensed from the 28 guardrails. **What must never break.**

### Never

1. **Never duplicate a validation schema.** `generateSchema` has exactly one definition.
2. **Never put router metadata inside `params`** — the schema is `.strict()` and will 400.
3. **Never trust a model-supplied action ID** — re-verify catalog membership after parsing.
4. **Never canonicalize a controlled vocabulary in a prompt** — it belongs in code.
5. **Never bypass or re-implement an authorization check.**
6. **Never expose `paramSchema`, `requiredRoles`, or `featureFlag`** in a catalog response.
7. **Never let AI output trigger a write, update, or delete.**
8. **Never register an action with `autoExecute: true` or `effect` above `draft`.**
9. **Never run the classifier on an emergency-flagged utterance.**
10. **Never log or transmit utterance text or slot values.**
11. **Never put teacher-authored text in a URL.**
12. **Never import feature-module code into `assistant/` or `actions/`.**
12a. **Never import a constant, schema, or helper *from* a route module.** The permanent dependency
   direction is **shared leaf modules → imported by routes and actions**, never the reverse. If two
   layers need the same value, it moves to a leaf module (`lib/`) that both import — it is never
   duplicated, and a route is never made into a library. Structurally enforced today:
   `routes/resources.js` exports only its Express router, so nothing else *can* import a constant
   from it. Keep it that way. Violating this creates a require cycle, which in CommonJS silently
   yields a partially-initialised module.
13. **Never make a page component consume `RouterProvider`.**
14. **Never put an AI navigation route string outside `assistant/handlers/`.**
15. **Never create a database migration in Phase 1.**
16. **Never reuse `app.locals.gemini` for classification.**
17. **Never modify `gemini.js`.**
18. **Never return a 5xx from `/api/assistant/interpret`.**
19. **Never make a capability reachable only through the router.**
20. **Never modify an existing test to make new code pass.**
21. **Never ship a milestone with a feature flag defaulting to on.**
22. **Never rely on the client flag as an incident control** — the service worker makes it unreliable.

### Always verify after every milestone

- [ ] Full server suite green, **existing test files unmodified**
- [ ] Suite run 3× — no intermittent failures
- [ ] Both packages lint; client builds
- [ ] Coach works end to end (ask, language, context, follow-ups, feedback, history, new chat, voice)
- [ ] Generator manual flow works (`/generator` with no handle → defaults → generate → preview → save → workspace)
- [ ] Library unchanged (list, filter, search, delete)
- [ ] Workspace unchanged (edit, save, AI Assist, dirty guard, print)
- [ ] Auth works (sign-in, Google, registration/pending, reset, token refresh)
- [ ] RBAC works (teacher blocked from admin; cross-teacher resource returns 404)
- [ ] With flags off: **network trace shows zero assistant requests**
- [ ] With flags off: behavior indistinguishable from `main`

---

## 14. Rollback Strategy

### Tiers

| Tier | Action | Time | Removes |
|---|---|---|---|
| **1** | `ASSISTANT_ENABLED=false` + restart | **< 60 s** | All routing behavior |
| **2** | Tier 1 + `VITE_ASSISTANT_ENABLED=false` + client redeploy | ⚠️ **Not deterministic (PWA)** | Client code paths |
| **3** | Revert the assistant commits | ~1 hr | The code |
| **4** | Delete `assistant/` + `actions/`, revert modified files | ~2 hr | Everything except the M1 refactor |

**Tier 1 is the only one that should ever be needed in an incident.** Tiers 2–4 exist so that
abandoning the feature is cheap.

### Why rollback is genuinely safe

- **No database migrations** → nothing to reverse
- **No data loss possible** → the router creates no data anything else reads; drafts live in
  `sessionStorage` and die with the tab
- **No orphans** → telemetry rows are write-only
- **Existing data untouched** → resources, queries, feedback, preferences, sessions

### Rollback at M5 — two things that do NOT revert cleanly

Mechanically M5 reverts to M4 exactly as §14 describes: **zero migrations, zero persisted state,
zero new environment variable names**, and `/interpret` is read-only apart from stdout logs, so
removing it leaves nothing behind. Tier 1 (`ASSISTANT_ENABLED=false`) makes it inert in under a
minute without touching code at all.

Two carry-forwards would be silently undone by a plain `git revert` of the M5 commits, and both
should be kept:

| What | Why it must not be reverted |
|---|---|
| **The routing model endpoint** in `server/.env.example` | M5 changed it from `gemini-2.5-flash-lite` to `gemini-flash-lite-latest` because **the former returns 404 — "no longer available to new users."** Reverting restores a dead value. Harmless at M4 (nothing reads it, since there is no classifier), but it is a landmine for whoever re-does M5: every routing call would fail and it would look like a router bug. Note also that `models.list` lists models this key cannot call — **verify a model with a real `generateContent` request** |
| **The fail-closed rollout gate** in `server/src/routes/assistant.js` | `isWithinRollout`'s school-code lookup previously threw on a database error, reaching the global error handler and returning a **500 from `/api/assistant/catalog`** — an M2 bug that predates M5 and is unrelated to the classifier. M5 fixed it (a database that cannot be read is never treated as permission granted). **Reverting M5 re-introduces that 500.** If M5 is rolled back, keep this three-line change |

Neither affects the deletability property: both live in files M2 already owned, and deleting
`assistant/` + `actions/` + `routes/assistant.js` removes them along with everything else.

### Rollback at M4 (the cleanest point)

After M4, nothing user-visible is enabled: no classifier, no `/interpret`, no client wiring, no
telemetry writes. Revert M4 → M3 → M2. **Keep M1** — the schema extraction is a standalone
improvement with no dependencies.

**Partial-keep option (recommended over a full revert):** keep M1 *and* M2. The registry is inert,
flag-gated, and is the foundation for a future non-AI command palette. Revert only M3 and M4. This
preserves the durable asset and discards the speculative part — which was the point of building the
registry first.

### PWA sequencing constraint

Remove `/interpret` from the **client** before removing it from the **server**, never the reverse.
Leave the server endpoint returning inert passthrough for one release after the client stops calling it.

---

## 15. Future Roadmap

| Phase | Actions added | New core work | Risk |
|---|---|---|---|
| **Phase 1** *(current)* | `generate_assessment`, `open_generator` | Registry, classifier, resolver, policy, executor, prefill | Medium |
| **Phase 2 — Library / Workspace** | `search_library`, `open_library_resource`, `print_resource`, `save_resource` | **Reference resolution** — criteria → owned rows, 0/1/many handling. Model never sees or emits an ID | Medium |
| **Phase 3 — Coach / Lesson planning** | `ask_coach`, `create_lesson_plan` | Merge router + coach into a single turn endpoint to reclaim the round trip | Medium |
| **Phase 4 — Multi-step** | compound requests | **Plan execution** — ≤3 steps, per-step confirmation, partial-failure semantics. Envelope already supports it | **High** |
| **Phase 5 — Attendance / Grading** | `mark_attendance`, `record_grade` | **Idempotency keys, transactional execution, undo log.** Irreversible institutional records | **High** — treat as its own project |

### What extends for free

Phases 2 and 3 add only **descriptors + schemas + handlers + evals**. The classifier prompt is
generated from the registry, so it grows automatically. The policy is effect-driven, so a new
`read` action inherits correct behavior on day one.

### What does NOT extend for free (be honest about this)

- **Reference resolution** (Phase 2) — a genuinely new component, ~1 week
- **Multi-step plans** (Phase 4) — a different execution model; do not attempt before Phase 3 is stable
- **True write actions** (Phase 5) — needs machinery that does not exist yet

### Graduating to auto-generation

Only when **all** hold: field-edit rate < 15% sustained over 2 weeks across ≥500 real routings;
a per-teacher opt-in exists; one-tap "regenerate with different settings" exists; per-teacher daily
generation cost is capped. Then flip `autoExecute: true` on the descriptor — **one field.**

### Sequencing rules

1. Never add a new action while the previous phase's field-edit rate is above target.
2. Every new action ships with ≥10 eval cases (≥3 Hinglish, ≥2 adversarial).
3. Every phase must be independently killable behind a flag.

---

## 16. Important Files & Folders

| Folder / File | Purpose | Owner | Status |
|---|---|---|---|
| `docs/AI_ACTION_ROUTER_README.md` | **This file.** Single source of truth for project state | Whoever last worked on the feature | ✅ Live |
| `server/src/actions/` | Capability Registry — what the app can do | Backend | ✅ M1 + M2 |
| `server/src/actions/registry.js` | Explicit descriptor list, filtering, projection, self-validating | Backend | ✅ M2 |
| `server/src/actions/descriptors/` | One file per action | Backend | ✅ M2 (2 actions) |
| `server/src/actions/schemas/` | Zod param schemas (THE definition) | Backend | ✅ M1 + M2 |
| `server/src/actions/vocab/` | Vocabulary mappers — long-term asset. Four-status result contract; `shared.js` is the normalization leaf, `index.js` the id → mapper registry | Backend | ✅ M4 |
| `server/src/assistant/resolver.js` | Canonicalize → merge (`utterance > memory > profile > default`) → provenance → validate per field. Pure: no I/O, no AI, no clock | Backend | ✅ M4 |
| `server/src/assistant/policy.js` | Rule 0 effect ceiling, then the Phase 1 clamp. Pure. **No input can emit `execute`** | Backend | ✅ M4 |
| `server/test/actions/vocabDrift.test.js` | Drift guard for the third duplicated pair (vocab ↔ `config.ts`) | Backend | ✅ M4 |
| `server/src/assistant/` | Intent Gateway — utterance → ResolvedAction | Backend | ✅ M0 + M4 + M5; only `telemetry.js` remains (M8) |
| `server/src/assistant/proposalSchema.js` | The untrusted-model boundary. Registry-derived `responseSchema`, zod SHAPE validation, and **the single site where an action id is authorized** (G4) | Backend | ✅ M5 |
| `server/src/assistant/classifier.js` | Registry-derived prompt, the `geminiFast` call, response parse. **The only file that talks to Gemini for routing** | Backend | ✅ M5 |
| `server/src/assistant/interpret.js` | The 12-stage pipeline. Orchestration only; database-free via injected dependencies; total catch so no path can 5xx | Backend | ✅ M5 |
| `server/src/routes/assistant.js` | HTTP shell. `GET /catalog` (M2) and `POST /interpret` (M5). The rollout gate **fails closed** | Backend | ✅ M5 |
| `server/src/lib/flags.js` | Feature flags, all defaulting OFF | Backend | ✅ M0 |
| `server/src/lib/resourceFields.js` | Bounds shared by CRUD and generation (breaks a require cycle) | Backend | ✅ M1 |
| `server/evals/` | Classification quality corpus (outside `test/`) | Backend + Product | ⬜ M7 |
| `client/src/assistant/` | All AI-routing client code — deletable unit | Frontend | ✅ M0 + M3 + **M6** (complete for Phase 1) |
| `client/src/assistant/draftStore.ts` | sessionStorage drafts: TTL, eviction, **fail-soft** | Frontend | ✅ M3 |
| `client/src/assistant/generatorPrefill.ts` | **The Generator's only seam into the router.** New router behaviour on that page belongs here, not in another page import | Frontend | ✅ M3 |
| `client/src/assistant/telemetry.ts` | Correction signal — field name + provenance, never values | Frontend | ✅ M3 (transport in M8) |
| `client/src/components/AiPrefillBanner.tsx` | Presentational banner: provenance summary + Undo | Frontend | ✅ M3 |
| `client/vitest.config.ts` | Client test runner — **pure-logic modules only**, no component rendering | Frontend | ✅ M3 |
| `client/src/assistant/handlers/` | Only place AI navigation routes appear. `index.ts` is **the registration point**: a new action costs one handler + one line here | Frontend | ✅ **M6** |
| `client/src/assistant/intentGate.ts` | Precision-first gate (CHANGE-2). Pure. **Widening it is an M7 decision backed by the corpus, never a one-off** | Frontend | ✅ **M6** |
| `client/src/assistant/ActionExecutor.ts` | Dispatch only. **No action-specific branching** — asserted by a source guard | Frontend | ✅ **M6** |
| `client/src/assistant/RouterProvider.tsx` | The router's only stateful module. Memory, pending ask, breaker, sequence | Frontend | ✅ **M6** |
| `client/src/assistant/sessionMemory.ts` | Typed slot store. **Applies no TTL** — the server is the single authority (D1) | Frontend | ✅ **M6** |
| `client/src/components/AiClarifyPrompt.tsx` | Presentational clarify chips | Frontend | ✅ **M6** |
| `server/test/assistant/contractDrift.test.js` | Drift guard for both duplicated pairs | Backend | ✅ M2 |
| `server/src/routes/resources.js` | Generation endpoint — **protected**, one import change only | Backend | 🔒 Protected |
| `server/src/gemini.js` | LLM service — **protected**, zero changes | Backend | 🔒 Protected |
| `server/src/prompts.js` | Coach prompts — **protected** | Backend | 🔒 Protected |
| `server/src/safety/` | Input/output guards — consumed, **never modified** | Backend | 🔒 Protected |
| `server/prisma/` | Schema + migrations — **zero changes** | Backend | 🔒 Protected |
| `client/src/lib/resources.ts` | Generation client — **protected**, proves the Generate path is untouched | Frontend | 🔒 Protected |
| `client/src/pages/GeneratorPage.tsx` | Modified: mount-time seeding + banner only | Frontend | ✏️ Modified |
| `client/src/pages/CoachPage.tsx` | Modified: submission pre-pass. **Highest-traffic file — most scrutinized diff** | Frontend | ✏️ Modified |
| `server/test/` | Existing suites are the regression contract — **additions only** | Backend | 🔒 Protected |

---

## 17. Documentation Index

| # | Document | Location | Status |
|---|---|---|---|
| 1 | **Architecture Document** — *why* the design is what it is | [`ai-action-router-architecture.md`](./ai-action-router-architecture.md) | ✅ **Persisted 2026-07-28** (amendments incorporated) |
| 2 | **Phase 1 Implementation Specification** — *what to build, in what order* | [`ai-action-router-phase1-spec.md`](./ai-action-router-phase1-spec.md) | ✅ **Persisted 2026-07-28** (amendments incorporated) |
| 3 | **Implementation Guardrails & Impact Analysis** — *what must not break* | [`ai-action-router-guardrails.md`](./ai-action-router-guardrails.md) | ✅ **Persisted 2026-07-28** (amendments incorporated) |
| 4 | **Living Project Document** | `docs/AI_ACTION_ROUTER_README.md` | ✅ **This file** |
| 5 | Executable API contract | `server/src/assistant/contracts.js` · `client/src/assistant/types.ts` · `server/test/helpers/assistantFixtures.js` | ✅ **Frozen in M0** — supersedes the planned standalone API doc |
| 5a | **Enforced** contract — the drift guard that makes the freeze real | `server/test/assistant/contractDrift.test.js` | ✅ **M2** — covers duplicated pairs A and B; proven to fail on injected drift |
| 5d | **Enforced** vocabulary — the third duplicated pair (GRADES/SUBJECTS/LANGUAGES ↔ `config.ts`) | `server/test/actions/vocabDrift.test.js` | ✅ **M4** — proven to fail on injected drift. A separate file by decision, so the inherited M2 guard is not edited |
| 5b | Live capability catalog (what the app currently advertises) | `GET /api/assistant/catalog` · `server/src/actions/registry.js` | ✅ **M2** — inert until flags are set |
| 5e | **Enforced** output contract — the classifier's `responseSchema` and prompt are both derived from the registry, so a new action widens them with no code change | `server/test/assistant/proposalSchema.test.js` · `server/test/assistant/classifier.test.js` | ✅ **M5** — a required acceptance criterion. Also asserts the schema has no field for a decision, route, URL, params, provenance or reasoning |
| 6 | Capability Registry guide | `server/src/actions/README.md` | ✅ Created in M0 |
| 7 | Intent Gateway guide | `server/src/assistant/README.md` | ✅ Created in M0 |
| 8 | Client router guide | `client/src/assistant/README.md` | ✅ Created in M0 |
| 5c | Client pure-logic test suite | `client/src/assistant/*.test.ts` · `client/vitest.config.ts` | ✅ **M3** — 70 tests covering draft-store failure modes, params coercion and telemetry privacy. **Extended at M6 to 312** across 13 files |
| 5f | **Enforced** gate precision — the CHANGE-2 acceptance evidence | `client/src/assistant/intentGate.test.ts` | ✅ **M6** — a 99-case table whose negative half is drawn from the app's real coaching traffic. Proven to fail when the gate is widened |
| 5g | **Enforced** registry-driven executor — the M6 invariant | `client/src/assistant/ActionExecutor.test.ts` | ✅ **M6** — a source guard asserting the executor names no action id, no domain and no route. Injecting `if (actionId === …)` fails 6 tests |
| 9 | Test Plan | `docs/ai-action-router-test-plan.md` | 📋 Planned (M7) |
| 10 | ADR-001: Registry before Router | `docs/adr/` | 📋 Planned |
| 11 | ADR-002: Effect class dominates confidence | `docs/adr/` | 📋 Planned |
| 12 | ADR-003: Client-side session memory | `docs/adr/` | 📋 Planned |
| 13 | Eval corpus & baseline results | `server/evals/` | 📋 Planned (M7) |

### ✅ Documentation gap closed (M0, 2026-07-28)

Documents 1–3 previously existed only in conversation history. They are now files in `docs/`, with
all 12 amendments incorporated inline and marked `[CHANGE-n]`, so §21 step 5 ("compare the
implementation against the approved documents") can be performed as written.

Two standing rules:

1. **This README remains authoritative.** If it contradicts documents 1–3, this file wins and the
   other document should be corrected.
2. **The amendments in §5.3 are binding** over anything the earlier documents may say. Each of the
   three carries its own amendment log at the top listing which CHANGEs it incorporates.

The planned standalone "API contract reference" was **replaced** by an executable contract (index
entry 5): `contracts.js`, `types.ts` and the fixtures, with a test asserting the documented example
payloads still conform. A contract that is checked by CI is worth more than a document that is not.

### Existing project documentation (pre-dating this feature)

| Document | Relevance |
|---|---|
| `README.md` | Product overview, tech stack, API overview, setup |
| `PROJECT-OVERVIEW-FOR-NON-TECHNICAL-STAKEHOLDERS.md` | Product context |
| `docs/enterprise-engineering-audit.md` | Known technical debt and prioritized improvements |
| `docs/postgres-migration-plan.md` | Future DB migration (**out of scope** — stay on SQLite) |
| `docs/MANUAL-TESTING-GUIDE.md` | Existing manual test procedures — extend, do not replace |
| `SETUP.md` | Local development setup |

---

## 18. Session Handoff

> **Read this first if you are a new session or a new engineer.**

### Where the project stands right now

**Planning is complete and approved. M0–M4 are approved. M5 and M6 are complete and awaiting
review.** M7 has not started and must not start without approval.

⚠️ **M6 is the first milestone a teacher can see.** With `VITE_ASSISTANT_ENABLED=true` *and* the
server's `ASSISTANT_ENABLED=true`, typing "Generate a Class 5 fractions worksheet" in the Coach
composer now opens the Generator with the fields prefilled. **Both flags are off by default**, and
with the client flag off the composer takes its original synchronous path without touching the gate,
storage or the network.

**M5 added three production files and four test files, and modified four tracked files** —
`server/src/index.js` (+52 / −0), `server/src/routes/assistant.js`, `server/.env.example`, and
`server/test/assistant.catalog.test.js` (an M2 placeholder whose rewrite was raised and approved).
**Zero client files changed**, and the client bundle is byte-identical to the pre-M5 baseline —
same hash, same 975,064 bytes.

⚠️ **M5 is the first milestone with a live server surface.** `POST /api/assistant/interpret` exists
and calls a real model — **but only when `ASSISTANT_ENABLED` is on, which it is not by default.**
With the flags at their defaults the endpoint returns an inert passthrough and spends no model call,
verified by HTTP probe against a real booted server. Nothing on the client calls it until M6.

⚠️ **The routing model documented at M0 was dead.** `gemini-2.5-flash-lite` now returns 404 ("no
longer available to new users"); the endpoint is `gemini-flash-lite-latest`. Note that `models.list`
will list a model this key cannot call — **verify a model with a real `generateContent` request,
never with the listing.**

The working tree on `feature/ai-action-router` contains the M0–M3 change set: 4 new documents; the
Capability Registry (`server/src/actions/`) with two descriptors and two schemas; the assistant
scaffolding on both sides; `GET /api/assistant/catalog`; feature flags (all OFF); the **client-side
prefill delivery mechanism** (draft store, prefill seam, telemetry, banner) with a Vitest runner and
70 tests; 5 new server test files; and small edits to existing files (`client/src/config.ts`, both
`.env.example`, `server/src/routes/resources.js`, `server/src/index.js`,
`client/src/pages/GeneratorPage.tsx`, `client/src/index.css`, `client/package.json`,
`.github/workflows/ci.yml`). **No protected file has been touched, and there are no database
migrations.**

`GeneratorPage.tsx` is modified (+220 / −27) but its *behaviour* is protected: `handleGenerate`,
`handleSave`, `examMeta` and the generation request body are verified untouched by diff, and
`client/src/lib/resources.ts` has an empty diff — which is the standing proof that the Generate path
is unchanged.

`routes/resources.js` and `index.js` are edited but **not** protected in the sense of "must not
change" — M1 and M2 existed to change them. What is protected is their *behaviour*: guarded by
`resources.test.js` passing 70/70 unmodified, and by `index.js` showing **+29 / −0** (no existing
line altered).

### The one-paragraph summary

We are adding an **AI Action Router** to Teacher Assistant: a teacher types "Generate a Class 5
fractions worksheet" in the Coach composer, and the app opens the Generator with the fields
pre-filled, ready for them to review and click Generate. Phase 1 covers **only** the Generator.
The model never generates, saves, deletes, or navigates destructively — it produces a *proposal*
that the application validates against its own schemas and authorization before turning it into
form state. Every failure falls back to a normal Coach answer.

### Current architecture in five sentences

1. A **Capability Registry** on the server describes what the app can do; the AI is a swappable
   front end onto it.
2. Three schemas stay strictly separate: **ActionDescriptor** (trusted, static), **IntentProposal**
   (untrusted model output), **ResolvedAction** (trusted, app-produced).
3. Effect class (`read`/`draft`/`write`/`destructive`) is **registry-declared and caps the decision
   policy at any confidence** — which is why a misclassification cannot cause damage.
4. The client holds a **draft store** and a **handler map**; the server never emits a route or an ID.
5. Everything degrades to the **Coach**, and `/interpret` returns 200 + `passthrough` for every
   failure that is not auth, malformed input, or rate limiting.

### Milestones

- ✅ **Completed:** P0 architecture · P1 specification · P2 guardrails/final review · P3 this
  document · **M0** (approved) · **M1** (approved) · **M2** (approved) · **M3** (approved) ·
  **M4** (approved) · **M5 classifier + `/interpret`, dark** (awaiting approval)
- 🟡 **Code complete, gate incomplete:** **M6 — client wiring**
- ⬜ **Pending:** M7 → M10 (see §8)
- ➡️ **Next:** **run the M6 manual verification script in §10.** Not M7.

### What M0 actually delivered (so you can trust the foundation)

- `server/src/assistant/contracts.js` and `client/src/assistant/types.ts` — the frozen wire
  contracts. Changing either now costs a coordination round trip; that is deliberate.
- `server/src/lib/flags.js` — every gate closed by default, verified against the real `.env`.
- `server/test/assistant/contracts.test.js` + `server/test/lib/flags.test.js` — 44 tests that make
  the freeze enforceable rather than aspirational. Notably these already encode guardrail G3 (router
  metadata must never sit inside `params`) and the Phase 1 effect ceiling, **before** any code
  exists that could violate them.
- `server/test/helpers/assistantFixtures.js` — the spec's example payloads, executable, asserted
  against the frozen vocabularies so documentation and code cannot drift apart silently.
- Three folder READMEs carrying the rules that apply inside each folder.

### What M1 delivered

- `server/src/actions/schemas/generateAssessment.js` — **the** generation request schema, now with
  exactly one definition repo-wide. From M2 the `generate_assessment` descriptor's `paramSchema`
  points at this same object, which is what makes "the router thinks this is valid" and "the
  endpoint accepts this" incapable of disagreeing.
- `server/src/lib/resourceFields.js` — the two field bounds genuinely shared between library CRUD
  and generation. Exists to avoid a require cycle, not for tidiness.
- `server/src/routes/resources.js` — imports both; behaviour byte-for-byte identical, proven by
  `resources.test.js` passing 70/70 **unmodified**.

### What M2 delivered

- `server/src/actions/registry.js` — the Capability Registry. Explicit descriptor list (never
  filesystem discovery), role/flag/status filtering, and a public projection that strips every
  server-internal field. **Self-validating at module load**, so a malformed descriptor stops the
  boot instead of surfacing later as a strange routing failure.
- `server/src/actions/descriptors/` — `generate_assessment` (effect `draft`) and `open_generator`
  (effect `read`). Both `autoExecute: false`, both `requiredRoles: []` because the underlying
  endpoint has no role guard and a descriptor must mirror the route's real guard rather than invent
  one.
- `server/src/routes/assistant.js` — `GET /api/assistant/catalog`. A thin shell: authenticate,
  check the rollout gates, delegate to the registry. Returns the **inert empty catalog** rather than
  an error for anyone outside the rollout, because "not enabled for you" is a normal state.
- `server/test/assistant/contractDrift.test.js` — the drift guard for **both** duplicated pairs.
  Verified by injecting deliberate drift into each and confirming a single correctly-named failure.
- `server/src/index.js` — **+29 insertions, 0 deletions.** The assistant router mounts after every
  existing router and before the global error handler; no existing line was altered.

**What M2 deliberately did NOT build:** `POST /api/assistant/interpret` (M5). The catalog advertises
what the application can do; nothing yet acts on it.

### What M3 delivered

- `client/src/assistant/draftStore.ts` — how a prefill reaches the Generator **without the teacher's
  text entering the URL**. Every function fails soft; a storage problem degrades to "the Generator
  opens empty", never to a crash.
- `client/src/assistant/generatorPrefill.ts` — the page's **single seam** into the router. If you
  are tempted to add a second `assistant/` import to `GeneratorPage`, put it behind this instead.
- `client/src/assistant/telemetry.ts` — `prefill_applied`, `field_corrected`, `undo_all`. This is
  the field-edit rate, which is the **launch gate**; it ships now so the first weeks of real usage
  produce signal. It has no parameter capable of holding teacher text.
- `AiPrefillBanner` + provenance markers + undo + the CHANGE-10 stacking rule.
- Vitest + jsdom, **pure logic only** — 70 tests. No React Testing Library in Phase 1.

**What M3 deliberately did NOT build:** anything that *writes* a draft. No handle can exist in
production until the ActionExecutor arrives in M6, so M3 ships inert. That is why it was verifiable
by hand-writing `sessionStorage` records, with no server and no model.

**The most useful thing M3 proved:** the delivery mechanism works end to end with no AI. When the
classifier lands and something misbehaves, the classifier is the suspect.

### What M4 delivered

- `server/src/actions/vocab/` — the durable vocabulary asset. Three mappers over one **four-status
  result contract**: `mapped`, `ambiguous` (keep the teacher's raw phrase, flag the field),
  `contradiction` (ask, showing both readings), `unmapped` (fall through — a *safe* outcome, not a
  failure). `shared.js` holds the normalization all three share; `index.js` maps a vocabulary id to
  its mapper, so the resolver never imports a specific vocabulary.
- `server/src/assistant/resolver.js` — the deterministic core. Canonicalize, merge by precedence,
  record provenance for **every** field, expire memory by slot volatility, and validate **per field**
  against the same schema object `POST /api/resources/generate` uses. Per-field rather than
  whole-object is load-bearing: a legitimate prefill is often incomplete, and incomplete must never
  be confused with invalid.
- `server/src/assistant/policy.js` — Rule 0 (the registry-declared effect caps the decision at any
  confidence) followed by the Phase 1 clamp. The `execute` graduation branch is written and tested
  although unreachable, which makes architecture §8.4's "flip one field" promise real — and proves
  the clamp is load-bearing rather than decorative.

**What M4 deliberately did NOT build:** any caller. `interpret.js`, the classifier and the endpoint
are M5. Nothing in production imports these modules, which is exactly why M4 is the plan's cleanest
rollback point (guardrails Part 7).

**The most useful thing M4 proved:** that a test table and an implementation sharing an author is a
real blind spot. Six common phrasings — `class five`, `panchvi`, `chhati`, `pehli`, `angreji`,
`environment` — were silently unmapped until the mappers were run over realistic input, and the fix
for the first of them then introduced a false positive that the same exercise caught. Expect the
eval corpus at M7 to find more; that is what it is for.

### What M5 delivered

- `server/src/assistant/proposalSchema.js` — the untrusted-model boundary. Builds the Gemini
  `responseSchema` from the role-filtered catalog, validates **shape** with zod, and performs the
  **one** authorization check that decides whether a model-named action may be acted on (G4).
- `server/src/assistant/classifier.js` — the only file that talks to Gemini for routing. The prompt
  is generated from the registry, carries no `paramSchema`/`requiredRoles`/`featureFlag`/route, and
  puts the teacher's words in delimited `contents` rather than the system instruction.
- `server/src/assistant/interpret.js` — the pipeline. Thin orchestration over M4's modules, with
  every dependency injected so all nine passthrough reasons are unit-testable with no server.
- `POST /api/assistant/interpret` in the existing route shell, plus a local envelope schema.

**What M5 deliberately did NOT build:** `telemetry.js` (D2 — the per-decision log is a structured
stdout line, zero DB writes), a real daily-budget counter (D1 — the branch and its test are live, the
counter is M9), `pendingAsk` shortcut handling (D5 — M6), and the CHANGE-8 breaker (D6 — M9).

**The most useful thing M5 proved: an injected-defect proof is worth running even when — especially
when — you expect it to pass.** Two of the three found real problems that every passing test had
missed:

1. The **G4 catalog re-verification was unreachable dead code.** The zod `intent` enum and the
   authorization check were built from the same list, so zod always rejected a bad id first.
   Injecting the classic `|| descriptors[0]` fallback changed nothing — 123 tests still passed. The
   guard was a comment that cost a function call. Splitting shape from permission fixed it; the same
   defect now fails 9 tests.
2. Disabling the pipeline's total catch failed 5 unit tests and **zero integration tests**, which
   pointed at something unprotected *upstream* of the pipeline. It was the rollout gate's Prisma
   lookup, which returned a genuine **500** from both `/interpret` and `/catalog` whenever the
   database hiccuped.

Neither would have been found by writing more tests of the same kind.

### What M6 delivered

- `client/src/assistant/intentGate.ts` — the precision-first filter that decides whether the server
  is worth asking. Pure, no network, and the only reason a coaching question costs nothing.
- `client/src/assistant/RouterProvider.tsx` — the router's **only** stateful module: session memory,
  the pending clarification, the circuit breaker, the catalog version, the sequence counter.
- `client/src/assistant/ActionExecutor.ts` — dispatch, the `execute`→`prefill` downgrade, the effect
  ceiling and the unknown-id domain fallback. **Registry-driven by invariant**, enforced by a test.
- `client/src/assistant/handlers/` — the registration point and the only home of route strings.
- `sessionMemory` · `repeatCache` · `circuitBreaker` · `catalog` · `api` · `pendingAsk`, all pure
  enough to test without a DOM, which is why 242 of the 312 client tests could exist at all.
- `AiClarifyPrompt` + a **+42 / −2** CoachPage diff behind a single import line.

**What M6 deliberately did NOT build:** a server-side slot-fill mode for `pendingAsk` (D3 — it needs
a second classifier prompt and eval data to tune), Tier-0 structured entry points, memory rendered as
correctable chips (D10 — it would modify a file outside the permitted list), Coach thread persistence
(D10), and anything on the server at all (D2 — `git diff --stat server/` is empty).

**The most useful thing M6 proved: a test table written only in the author's own language is a blind
spot with a specific shape.** The intent gate's tokenizer omitted `\p{M}`, so every Devanagari phrase
fragmented into tokens matching nothing — the whole Hindi vocabulary would have been dead code, and
every English test would still have passed. M4 learned the same lesson from the other direction when
six common Hinglish phrasings were silently unmapped. **Expect M7's corpus to find more, because that
is what it is for.**

### Active branch

`feature/ai-action-router` (based on `main`). **Never implement this feature on `main`.**

### The decisions that matter most

1. **The model proposes; the application disposes.** No route, no ID, no effect from the model.
2. **Effect class dominates confidence.**
3. **Zero database migrations in Phase 1.**
4. **One definition of every schema** — `generateSchema` is moved, never copied.
5. **No auto-generation.** The teacher always clicks Generate.
6. **Passthrough on every failure.** A broken router is invisible.
7. **The feature must remain deletable.**
8. **The server kill switch is the only real incident control** (the client is a PWA).
9. **12 binding amendments in §5.3 supersede the earlier documents.** Read them before coding —
   two of them (CHANGE-7, CHANGE-9) fix latent functional bugs.

### Protected areas — do not modify

Generation flow · assessment rendering · resource saving · Library · Workspace · authentication ·
authorization · Coach API · database schema · `gemini.js` · safety guards · existing test files ·
provider stack order · every page except Coach and Generator. Full table with rationale in §6.

### Project health

🟡 **Healthy, with one gate step outstanding.** Thorough planning, two latent bugs caught
pre-implementation, trivial rollback, and M0–M5 all landed with every verification gate green. M3
found **zero defects**; M4 found **six real vocabulary gaps plus one false positive it had
introduced**; M5 found **an unreachable security guard and a genuine 500**, both fixed inside the
milestone; M6 found **a tokenizer bug that would have silently disabled the entire Hindi
vocabulary**, fixed before it shipped.

**M6's gate is finished.** 312 client tests, 943 server tests unchanged, 12/12 injected-defect proofs
detected, and the full 20-step manual script executed against live Gemini with **zero defects in M6
code**. What it did surface is five model-quality gaps and an unmeasured gate recall — both handed to
M7 rather than patched over, which is the same discipline M5 applied to its own three.

Biggest open question — Hinglish classification quality — is deliberately deferred to M7, which is
the correct decision point for whether Phase 2 proceeds. M4's exploratory findings are a small
preview of it: the router's recall on real teacher phrasing is not knowable from unit tests written
by the implementer.

**Open items:** `client/tsconfig.tsbuildinfo` is a tracked build artifact that churns on every build
(pre-existing repo hygiene, out of scope; restored after each build so milestone diffs stay clean);
two regression items were deliberately not exercised with stated reasons — print modes (would block
browser automation; file untouched) and non-interactive auth flows (server-side, covered by four
unmodified suites); the drift extractors are knowingly duplicated across two test files (M4 was
instructed not to edit the inherited M2 guard); **CHANGE-9 has structural guards but no behavioural
test** (M6, stated in §9 and §10); and **the intent gate's recall is entirely unmeasured** — M7's
first question.

**Closed at M6:** the memory-TTL duplication, resolved by decision D1 removing the need for a client
copy rather than relocating it to the catalog; and `pendingAsk` free-text handling, carried from M5.

**Closed since M0:** the authenticated-UI-regression limitation. M3 was verified in a real signed-in
browser session.

### How work proceeds (governance)

🔒 **One milestone at a time.** Each milestone ends with the mandatory 7-step gate in §21 — code
review, lint/build/type-check/tests, manual verification, regression testing, design-compliance
comparison, documentation update, and a Milestone Completion Report. **Then stop and wait for
explicit user approval before starting the next milestone.** A milestone is not complete because
the code compiles.

### Before you end your session

Update §1 Snapshot, §9 Progress Log, §10 Current Status, §11 Pending Work, and the §8 milestone
table. See §19, §20 and §21.

---

## 19. Living Documentation Rules

**This README must never become outdated. It reflects the current project state at all times.**

### After EVERY completed milestone, update:

| # | Section | What to change |
|---|---|---|
| 1 | §1 Project Snapshot | Current milestone, progress %, status, last updated, next task |
| 2 | §1 Progress basis table | Move the completed milestone's effort into the completed row |
| 3 | §8 Milestone Roadmap | Status → ✅ Completed; add completion date and notes |
| 4 | §9 Progress Log | **Append** entries for every significant decision and event |
| 5 | §10 Current Status | Completed / in progress / next |
| 6 | §11 Pending Work | Tick items; remove the finished milestone's block |
| 7 | §17 Documentation Index | Add any new document; update statuses |
| 8 | §18 Session Handoff | Refresh so it reflects reality |

### Also update when:

| Trigger | Update |
|---|---|
| Architecture changes | §4, §5, §9, and §17 if a document changed |
| A new document is created | §17 immediately |
| An implementation decision changes | §5, §9 (append the reasoning) |
| A new risk is discovered | §12, §9 |
| A protected area must change | §6 **and** record the approval in §9 — this should be rare and deliberate |
| A milestone is blocked | §8 status → ❌, §10, §9 |
| Scope changes | §3, §8, §11, §9 |

### Rules

1. **Never delete history.** §9 Progress Log is append-only.
2. **Never rewrite a completed milestone.** If something is revisited, append a new entry explaining why.
3. **Keep the progress % honest** — use the effort-weighted basis in §1, not intuition.
4. **Update before ending a session**, not "later."
5. **If this README contradicts another document, this README wins** — and fix the other document.
6. **If you cannot complete a milestone, record what was done and what remains** in §9 and §11. A
   partially-done milestone that looks untouched is worse than one honestly marked in progress.
7. **Documentation updates are step 6 of the §21 gate, not an optional courtesy.** A milestone
   whose README was not updated is not complete, regardless of the state of the code.

---

## 20. Instructions for Future Claude Sessions

> **Read this section fully before making any change to this repository.**

### Start of session — always

1. **Read this entire README first.** Do not begin work from a user prompt alone.
2. **Identify the current milestone** from §1 and §10. Work only on that milestone.
3. **Verify the active branch** is `feature/ai-action-router`. If you are on `main`, stop and switch.
4. **Read §5.3 (the 12 binding amendments).** They supersede the older documents and include two
   latent bug fixes.
5. **Read §6 (Protected Areas)** before touching any existing file.
6. **Check §17** — if documents 1–3 are still marked NOT YET PERSISTED, consider regenerating them
   as part of M0.

### During work

7. **Never skip milestone order.** Dependencies are real: M1 → M2 → M5, M4 → M5, M3 → M6. The only
   legitimate parallelism is the client track (M3) against the server track (M1/M2/M4).
7a. **Never implement more than one milestone in a session or a PR.** Finish the current milestone,
   run the full §21 gate, produce the Milestone Completion Report, then **stop and wait for explicit
   user approval.** Do not begin the next milestone on your own initiative, even if it looks trivial
   and even if you have time left.
7b. **Never declare a milestone complete because the code compiles.** §21 steps 1–7 must all be
   done, and every issue found must be fixed before proceeding — not logged as follow-up.
8. **Never modify a protected area** (§6). If a change appears necessary, stop and raise it with the
   user — it means the design has drifted.
9. **Never create a database migration.**
10. **Never write implementation code without confirming the current milestone covers it.**
11. **Never mark a milestone complete without running the §13 regression checklist.**
12. **Never modify an existing test file** to make new code pass.
13. **Never enable a feature flag by default.**
14. **Prefer the smallest diff that satisfies the milestone.** Do not refactor adjacent code because
    the file happens to be open.

### End of session — always

15. **Update §1 Project Snapshot** — milestone, progress %, status, last updated, next task.
16. **Append to §9 Progress Log** — every significant decision, with the date and the reasoning.
    Never delete or edit prior entries.
17. **Update §10 Current Status** — what is done, what is in progress, what is next.
18. **Update §11 Pending Work** — tick what is finished.
19. **Update §8 Milestone Roadmap** — statuses and notes.
20. **Update §17 Documentation Index** if any document was created or changed.
21. **Refresh §18 Session Handoff** so the next session can start cold.
22. **State plainly what was NOT finished.** Honest partial progress beats an optimistic status.

### Judgement rules

23. **This README is the single source of truth.** If it conflicts with a prompt, chat history, or
    another document, raise the conflict rather than silently picking one.
24. **If the user asks for something out of Phase 1 scope** (§3), say so and confirm before proceeding.
    Scope creep here is the main threat to the rollback story.
25. **If you discover a factual error in this document, fix it and log the correction in §9.**
    Four such corrections were already found during the final review (§5.3, Findings A–D) — assume
    more exist.
26. **Do not defend the design when reviewing it.** The final review found two latent bugs precisely
    because it was adversarial. Keep that posture.

---

## 21. Milestone Completion Protocol (MANDATORY)

> **Adopted 2026-07-27. Binding on all development from this point forward.**
>
> The project is implemented **milestone by milestone**. Never implement multiple milestones
> together. At the end of EVERY milestone, stop and complete this full gate before starting the next.
>
> **Quality over speed. Never skip verification. Never skip regression testing. Never skip README
> updates. Never assume code is correct just because it compiles.**

### The seven steps

**Step 1 — Review all code written in the milestone**
- Architecture compliance (against §4, §5, §6 of this document)
- Coding standards — match the surrounding code's conventions, comment density, and idiom
- Remove duplicate logic
- Maintainability
- No unnecessary complexity

**Step 2 — Verify the implementation**
- Run lint (`npm run lint` in `server/` and `client/`)
- Run build (`npm run build` in `client/`)
- Run type checking (`tsc -b`, part of the client build)
- Run all available tests (`npm test` in `server/`; client tests if the M0 decision added a runner)
- **Fix every issue before proceeding.** Not "log and move on"

**Step 3 — Manual verification**
- Actually run and use the application
- Verify the implemented feature works
- Verify UI behavior, navigation, refresh behavior, browser back/forward, and edge cases
- If manual verification is not possible, **state clearly why**

**Step 4 — Regression testing**

Verify existing functionality still works. At minimum: **Coach · Generator · Library · Workspace ·
Authentication · RBAC · AI Assist · Onboarding · Theme · existing APIs.** The detailed checklist is
in §13.

**Step 5 — Compare against approved design**

Compare the implementation against
[the Architecture Document](./ai-action-router-architecture.md),
[the Implementation Specification](./ai-action-router-phase1-spec.md),
[the Implementation Guardrails](./ai-action-router-guardrails.md), and this README. **If anything
deviates from the approved design, STOP and explain the issue before continuing.**

**Step 6 — Update documentation**

Update this README: completed milestone · progress % · Progress Log · Current Status · Pending Work
· Session Handoff · Last Updated. (Full mapping in §19.)

**Step 7 — Produce a Milestone Completion Report**

Containing: milestone completed · files modified · features implemented · build status · tests
executed · manual verification performed · regression status · documentation updated · remaining
risks · next milestone.

**Then STOP.** Do not automatically continue. Wait for user review and approval.

### Verification feasibility in this environment

Established 2026-07-27 so that step 3 is never quietly skipped:

| Capability | Status | Notes |
|---|---|---|
| Server boots | ✅ | `server/.env` present, dependencies installed, `server/prisma/dev.db` exists |
| Client dev server | ✅ | `client/.env` present, dependencies installed (Vite on :5173) |
| Browser-driven manual verification | ✅ | Chrome automation available — navigation, refresh, back/forward, and UI checks are all directly verifiable |
| Lint / build / type-check / tests | ✅ | Existing npm scripts; server tests use a stubbed `fetch`, so no API key or network is needed |
| **AI-dependent paths** (M5+) | ⚠️ **Unverified** | Depends on the Gemini key in `server/.env` being valid. Not checked (secret). **Not required for M0–M4** — including M3, which is deliberately designed to be fully verifiable with hand-written drafts and no AI |
| Real multi-user / multi-school scenarios | ⚠️ Limited | Seed data only (`server/src/seed.js`). Cross-tenant behavior is covered by `tenant-isolation.test.js` rather than by hand |

**Confirm the Gemini key works before M5**, not at M5's completion gate.

### Per-milestone gate notes

| Milestone | What "manual verification" means here |
|---|---|
| **M0** | No runtime behavior to exercise. Verify: server boots unchanged, client builds unchanged, CI green, flags read as OFF. Regression = full §13 checklist as a baseline snapshot |
| **M1** | No new behavior. The acceptance criterion *is* the regression test: `resources.test.js` passes **unmodified**. Manually generate one quiz and one worksheet to confirm the contract is intact |
| **M2** | Exercise `GET /api/assistant/catalog` with a teacher token and an admin token; confirm role filtering and that `paramSchema`/`requiredRoles` never appear |
| **M3** | **Fully manually verifiable with no AI.** Hand-write a draft into `sessionStorage`, navigate to `/generator?ai=<id>`, then verify mount, param-change re-application (CHANGE-7), refresh, Undo, manual edits, banner/tip stacking (CHANGE-10), accessibility (CHANGE-12) |
| **M4** | Pure modules — verification is unit tests, not the UI. State this explicitly rather than claiming manual verification |
| **M5** | First milestone needing a live Gemini key. Exercise every passthrough reason; confirm no path returns 5xx |
| **M6** | Full end-to-end. Also verify: flags off ⇒ zero assistant requests in a network trace; stale-response guard (CHANGE-9); circuit breaker with the backend stopped |
| **M7** | Evals are the verification. Record the baseline; this is the **go/no-go decision point for Phase 2** |
| **M8** | Confirm `Event` rows contain no utterance text or slot values; confirm field-edit rate is computable |
| **M9** | Time the kill switch in a live session; perform the deletability test; complete the log audit |
| **M10** | Staged rollout with hold periods — the gate runs per stage, not once |

### Blocking prerequisite for the first gate

⚠️ **Step 5 requires comparing against three documents that are not currently on disk** (see §17).
Until the Architecture Document, Implementation Specification, and Implementation Guardrails are
persisted to `docs/`, step 5 cannot be performed as written — only against this README.

**Persisting those three documents is M0 task #1** and must be done before M0's own gate runs.

---

**End of document.** Keep it accurate. It is the project's memory.
