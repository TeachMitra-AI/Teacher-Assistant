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
| **Current Milestone** | **M3 — Draft store + Generator prefill** ✅ **COMPLETE — awaiting review/approval** |
| **Overall Progress** | **31%** (planning + M0 + M1 + M2 + M3 complete) |
| **Current Status** | 🟢 Healthy — M3 verified end to end in a real authenticated browser session; all gates green; **zero defects found** |
| **Architecture Status** | ✅ **Approved** (reviewed 3×, 12 amendments applied — see §5.3) |
| **Implementation Status** | 🟡 **M0–M3 complete** — contracts frozen, registry live behind flags (all OFF), catalog endpoint serving, drift guard active, **prefill delivery mechanism working end to end with no AI** |
| **Last Updated** | 2026-07-28 |
| **Governance** | 🔒 **Milestone Completion Protocol in force** — see [§21](#21-milestone-completion-protocol-mandatory). One milestone at a time; full verification gate before the next begins; explicit user approval required to proceed |
| **Next Task** | ⏸️ **Awaiting user approval of M3.** Next milestone is **M4 — Vocabulary + resolver + policy**, pure server-side modules verified by unit tests rather than by UI. M4 is also the **cleanest rollback point** in the plan |

### Progress basis (keep this calculation consistent)

Progress % is weighted by estimated effort-days, not by milestone count.

| Work | Effort (days) | Status | Contribution |
|---|---|---|---|
| Planning (architecture, spec, guardrails) | 5.0 | ✅ Complete | 13.3% |
| M0 — contract freeze & scaffolding | 1.0 | ✅ Complete | 2.7% |
| M1 — schema extraction | 0.5 | ✅ Complete | 1.3% |
| M2 — registry + catalog + drift guard | 2.0 | ✅ Complete | 5.3% |
| M3 — draft store + Generator prefill | 3.0 | ✅ Complete | 8.0% |
| M4 → M10 implementation | 26.0 | ⬜ Not started | 0% |
| **Total** | **37.5** | | **≈ 30.7%** → reported as **31%** |

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
| `server/evals/` | Classification quality corpus + runner. **Outside `test/`** — not a CI gate |
| `client/src/assistant/` | Everything AI-routing. Self-contained and deletable |
| `client/src/assistant/handlers/` | The ONLY place AI navigation route strings appear |
| `client/src/components/AiPrefillBanner.tsx` | Presentational only |
| `client/src/components/AiClarifyPrompt.tsx` | Presentational only |
| `client/vitest.config.ts` | Client test runner (M3). **Pure-logic modules only**, scoped to `src/assistant/**`. Sits at `client/` root, so it is not covered by the `client/src/assistant/` entry above. Loads none of the app's Vite plugins, and does not affect the production build |

### 7.2 Modified files (the complete list — nothing else may change)

| Path | Change | Size |
|---|---|---|
| `server/src/index.js` | Mount assistant router; construct `geminiFast`; new env tunables; assistant limiter; **add a limiter to `/api/resources/generate`** | additive |
| `server/src/routes/resources.js` | Replace the inline `generateSchema` definition with an import. **Nothing else** | ~15 lines relocated |
| `server/.env.example` | Document ~8 new variables | additive |
| `client/src/App.tsx` | Wrap `AppRoutes` in `RouterProvider` | ~2 lines |
| `client/src/pages/CoachPage.tsx` | Route submissions through the router pre-pass; render clarify chips | ~40 lines |
| `client/src/pages/GeneratorPage.tsx` | Draft read on mount + param change; banner; provenance markers; correction telemetry | **actual at M3: +220 / −27** (original estimate ~60 lines — see note below) |
| `client/src/config.ts` | Flag constant + assistant constants | ~5 lines |
| `client/src/index.css` | Banner / chip / marker styles | additive |
| `client/.env.example` | `VITE_ASSISTANT_ENABLED` | 1 line |
| `client/package.json` | `vitest` + `jsdom` **devDependencies** and a `test` script (M3) | ~5 lines |
| `client/package-lock.json` | Lockfile for the above | generated |
| `.github/workflows/ci.yml` | **Conditional** — only if a client test runner is added. Added at M3 | ~6 lines |

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
| **M4** | Vocabulary + resolver + policy (pure modules) | 3.0 d | ⬜ **Pending** | ← **NEXT** (awaiting approval). ~40 grade-phrase cases. 100% branch coverage on policy. **Cleanest rollback point** |
| **M5** | Classifier + `/interpret` endpoint (dark) | 4.0 d | ⬜ Pending | `geminiFast`, `responseSchema`, 12-stage pipeline. Tested with `geminiMock` — no real API calls in CI |
| **M6** | Client wiring | 4.0 d | ⬜ Pending | Gate (CHANGE-2), cache, provider, executor, CoachPage integration, CHANGE-3, CHANGE-9 |
| **M7** | Eval harness + tuning | 5.0 d | ⬜ Pending | ≥120 labelled utterances (EN / Hinglish / HI / adversarial). **Launch-blocking** |
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

### 🟡 What is currently in progress

**Nothing.** M3 is complete and **awaiting user review and approval**. Per §21, the next milestone
does not begin automatically.

### ⬜ What is next

**Milestone M4 — Vocabulary + resolver + policy** (3.0 days) — *blocked on M3 approval*

Pure server-side modules with no UI and no AI. Verification is unit tests, and the README should say
so explicitly rather than claiming manual verification.

- Grade mapper (~40 cases including Hindi, Hinglish, ordinals, and deliberately ambiguous ranges),
  subject mapper (~20 cases).
- **Language set only from an explicit statement** — never inferred from the script the teacher
  typed in. Getting this wrong prints a worksheet in the wrong language.
- Slot merge with precedence (`utterance > memory > profile > default`) and provenance.
- Contradiction detection, and the decision policy at **100% branch coverage**.
- Cross-reference comments for the GRADES/SUBJECTS duplication (CHANGE-11).

**M4 is the cleanest rollback point in the plan** — after it, nothing user-visible is enabled.

### Project health: 🟢 Healthy

M3 landed with **zero defects found in verification** and no fixes required. Every gate is green:
lint, type-check and build on both packages, 70 client tests and 527 server tests each run three
times without flakiness, zero migrations, zero protected files touched, and exactly one page
modified. Bundle growth is **+1.79 kB gzip** against a 15 kB budget.

The delivery mechanism the whole feature depends on now works end to end **with no AI involved**,
which was the point of sequencing M3 before M5: when the classifier arrives and something breaks,
it will be the classifier.

Open items: `client/tsconfig.tsbuildinfo` remains a tracked build artifact that churns on every
build (pre-existing, out of scope, restored after each build so milestone diffs stay clean); and two
regression items were deliberately not exercised for stated reasons (print modes, non-interactive
auth flows — see §9).

The main risk remains classification quality on code-mixed Hinglish, deliberately deferred to M7 —
the correct moment to decide whether Phase 2 proceeds at all.

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

### M4 — Vocabulary + resolver + policy (3.0 d)
- [ ] Grade mapper (~40 cases incl. Hindi, Hinglish, ordinals, ambiguous ranges)
- [ ] Subject mapper (~20 cases)
- [ ] Language: **explicit statements only** — never infer from input script
- [ ] Slot merge with precedence + provenance
- [ ] Contradiction detection
- [ ] Decision policy — 100% branch coverage
- [ ] Cross-reference comments for the GRADES/SUBJECTS duplication (CHANGE-11)

### M5 — Classifier + interpret endpoint (4.0 d)
- [ ] `geminiFast` instance with routing tunables
- [ ] Prompt assembled **from the registry** (no free-text action descriptions in the classifier)
- [ ] `responseSchema` + proposal validation + catalog re-verification
- [ ] Full 12-stage pipeline including the emergency short-circuit
- [ ] `POST /api/assistant/interpret`
- [ ] Tests for all nine passthrough reasons; **no path returns 5xx**

### M6 — Client wiring (4.0 d)
- [ ] Intent gate tuned for **precision** (CHANGE-2)
- [ ] Client repeat cache
- [ ] RouterProvider, ActionExecutor, handler map
- [ ] Catalog fetch + version invalidation
- [ ] CoachPage integration
- [ ] Clarify chips resolving **client-side** (CHANGE-3)
- [ ] Stale-response guard (CHANGE-9)
- [ ] Circuit breaker
- [ ] Verify zero assistant requests when flags are off

### M7 — Eval harness + tuning (5.0 d)
- [ ] ≥120 labelled utterances: 60 action / 40 coaching / 20 adversarial
- [ ] Coverage: English, Hinglish, Hindi
- [ ] Runner with per-intent precision/recall and per-slot accuracy
- [ ] Recorded-fixture mode for CI (deterministic, free)
- [ ] Baseline recorded; thresholds tuned from data
- [ ] **Decision point:** if Hinglish intent precision < ~85%, reconsider whether Phase 2 proceeds

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
| `server/src/actions/vocab/` | Vocabulary mappers — long-term asset | Backend | ⬜ M4 |
| `server/src/assistant/` | Intent Gateway — utterance → ResolvedAction | Backend | 🟡 `contracts.js` only (M0); rest in M4/M5 |
| `server/src/routes/assistant.js` | HTTP shell. `GET /catalog` live; `POST /interpret` in M5 | Backend | 🟡 M2 |
| `server/src/lib/flags.js` | Feature flags, all defaulting OFF | Backend | ✅ M0 |
| `server/src/lib/resourceFields.js` | Bounds shared by CRUD and generation (breaks a require cycle) | Backend | ✅ M1 |
| `server/evals/` | Classification quality corpus (outside `test/`) | Backend + Product | ⬜ M7 |
| `client/src/assistant/` | All AI-routing client code — deletable unit | Frontend | 🟡 `types.ts` (M0) + draft store, prefill seam, telemetry (M3); provider/executor/gate in M6 |
| `client/src/assistant/draftStore.ts` | sessionStorage drafts: TTL, eviction, **fail-soft** | Frontend | ✅ M3 |
| `client/src/assistant/generatorPrefill.ts` | **The Generator's only seam into the router.** New router behaviour on that page belongs here, not in another page import | Frontend | ✅ M3 |
| `client/src/assistant/telemetry.ts` | Correction signal — field name + provenance, never values | Frontend | ✅ M3 (transport in M8) |
| `client/src/components/AiPrefillBanner.tsx` | Presentational banner: provenance summary + Undo | Frontend | ✅ M3 |
| `client/vitest.config.ts` | Client test runner — **pure-logic modules only**, no component rendering | Frontend | ✅ M3 |
| `client/src/assistant/handlers/` | Only place AI navigation routes appear | Frontend | ⬜ M6 |
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
| 5a | **Enforced** contract — the drift guard that makes the freeze real | `server/test/assistant/contractDrift.test.js` | ✅ **M2** — covers both duplicated pairs; proven to fail on injected drift |
| 5b | Live capability catalog (what the app currently advertises) | `GET /api/assistant/catalog` · `server/src/actions/registry.js` | ✅ **M2** — inert until flags are set |
| 6 | Capability Registry guide | `server/src/actions/README.md` | ✅ Created in M0 |
| 7 | Intent Gateway guide | `server/src/assistant/README.md` | ✅ Created in M0 |
| 8 | Client router guide | `client/src/assistant/README.md` | ✅ Created in M0 |
| 5c | Client pure-logic test suite | `client/src/assistant/*.test.ts` · `client/vitest.config.ts` | ✅ **M3** — 70 tests covering draft-store failure modes, params coercion and telemetry privacy |
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

**Planning is complete and approved. M0, M1 and M2 are approved. M3 is complete and awaiting
review.** M4 has not started.

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
  document · **M0** (approved) · **M1** (approved) · **M2** (approved) · **M3 draft store +
  Generator prefill** (awaiting approval)
- ⬜ **Pending:** M4 → M10 (see §8)
- ➡️ **Next:** **M4 — Vocabulary + resolver + policy** (see §10). ⏸️ Blocked on user approval of M3.

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

🟢 **Healthy.** Thorough planning, two latent bugs caught pre-implementation, trivial rollback, and
M0–M3 all landed with every verification gate green. M3 found **zero defects** and required no fixes.

Biggest open question — Hinglish classification quality — is deliberately deferred to M7, which is
the correct decision point for whether Phase 2 proceeds.

**Open items:** `client/tsconfig.tsbuildinfo` is a tracked build artifact that churns on every build
(pre-existing repo hygiene, out of scope; restored after each build so milestone diffs stay clean),
and two regression items were deliberately not exercised with stated reasons — print modes (would
block browser automation; file untouched) and non-interactive auth flows (server-side, covered by
four unmodified suites).

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
