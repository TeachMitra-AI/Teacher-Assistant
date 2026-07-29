# AI Action Router — Phase 1 Implementation Specification

**Status:** Approved · **Scope:** Phase 1 (Generator only) · **Created:** 2026-07-27
**Last amended:** 2026-07-28 (M4 — §11 Definition of Done corrected per decision D1)

> **Companion documents**
> - [`ai-action-router-architecture.md`](./ai-action-router-architecture.md) — *why*
> - [`ai-action-router-guardrails.md`](./ai-action-router-guardrails.md) — what must not break
> - [`AI_ACTION_ROUTER_README.md`](./AI_ACTION_ROUTER_README.md) — **living project state**

The architecture document says *why*. This one says *what to build, in what order, and what "done"
means.*

**Scope lock:** one capability — natural utterance → Generator opens → fields prefilled → teacher
reviews → teacher clicks Generate. Nothing generates automatically. Nothing is saved automatically.
No other module participates.

## Amendment log

| Applied here | Effect |
|---|---|
| CHANGE-1 | Server-persisted per-user opt-out **removed** (§2.4, §11) |
| CHANGE-2 | Client gate tuned for **precision** (§5.4) |
| CHANGE-3 | Chip answers resolve **client-side** (§7.2) |
| CHANGE-4 | `suggest` decision **deferred to Phase 2** (§4.3, §7.2) |
| CHANGE-5 | Server-side repeat cache **deferred** (§4.2) |
| CHANGE-6 | **Telemetry split** — logs for decisions, `Event` rows for outcomes (§4.8, §9 M8) |
| CHANGE-7 | Generator reacts to **`?ai=` param change**, not only mount (§6.1) |
| CHANGE-8 | **Router yields to Coach** under upstream 429 (§4.5, §9 M9) |
| CHANGE-9 | **Stale-response guard** (§5.4) |
| CHANGE-10 | Banner / onboarding-tip **stacking rule** (§6.8) |
| CHANGE-11 | Vocabulary duplication **documented and cross-referenced** (§8.4) |
| CHANGE-12 | **Accessibility** specified for new UI (§6.9) |

### Post-approval corrections

Applied after this document was approved, when implementation showed a statement here to be
incomplete or superseded. The living README wins on any conflict (README §17 rule 1) — but the
losing document gets corrected rather than left knowably wrong.

| Milestone | Correction |
|---|---|
| M3 | §2.4 amended to list `client/src/assistant/generatorPrefill.ts` and `client/vitest.config.ts` |
| **M4** | **§11 Definition of Done:** "policy 100% branch" → **exhaustive enumeration of the policy's complete input space** (decision D1). No coverage dependency is added |
| **M5** | **§4.2 stage 7 (per-user daily budget)** names `telemetry.js` as its module. Superseded by **decision D1**: the budget is an **injectable seam in `interpret.js`** that counts and persists nothing. The stage, its `budget_exhausted` reason and its test are live; the counter itself is M9. Inventing per-user state at M5 would have meant either a migration (forbidden in Phase 1) or a process-local cache that lies after every restart |
| **M5** | **§4.2 stage 12 (telemetry)** names `telemetry.js`. Superseded by **decision D2**: `telemetry.js` is **not created in M5**. The per-decision record is a structured stdout line emitted by `routes/assistant.js` (`logAssistantEvent`), which is what CHANGE-6 asks for and costs zero database writes. The module arrives at M8 with the low-volume `Event` rows it actually exists for |
| **M5** | **§7.2** describes a free-text answer re-calling `/interpret` with `pendingAsk` populated. Superseded by **decision D5**: M5 **validates `pendingAsk` and otherwise ignores it**, so such a turn is simply classified normally — correct, if slightly less efficient. Conversational shortcutting is turn handling and belongs with the rest of it in **M6** |
| **M5** | **§4.5** specifies `gemini-2.5-flash-lite` as the routing model. **That model now returns 404 — "no longer available to new users."** The endpoint is `gemini-flash-lite-latest`, a deliberate floating alias (see README §9 and §14). Verify any future model with a real `generateContent` call: `models.list` will list models the key cannot call |
| **M6** | **§5.4 rule 1** states that navigation is a push so "the back button returns to the Coach **with the conversation intact**." The second half is **factually wrong, and was wrong before this feature existed**: `CoachPage` holds `turns` in `useState`, so navigating to `/generator` unmounts it and the thread is lost. Back returns to an empty Coach page — which is today's behaviour for *any* navigation away from Coach. M6 deliberately does **not** add thread persistence: it is a real feature with its own scope, and inventing it inside a client-wiring milestone would be exactly the scope creep the rollback story depends on avoiding. Approved as decision **D10** |
| **M6** | **§5.6** says session memory is "**rendered, not hidden** — `ContextBar` already displays this shape." Rendering it would require modifying `ContextBar.tsx`, which sits outside §2.5's permitted-file list (and under README §6 protected area #14's spirit). Memory is therefore **held and sent but not displayed** in Phase 1. The inspectability argument in the architecture document stands — it is simply not yet delivered, and it is the natural first item for Phase 2's catalog-driven UI. Approved as decision **D10** |
| **M6** | **§2.5** budgets "~5 lines" of change to `client/src/config.ts` at M6. **The file is not modified at all.** M3 had already established (and the owner approved) that router constants stay module-private so the folder remains deletable without leaving dangling references in shared files; that reasoning applies unchanged to the gate, cache, memory and breaker constants. `ASSISTANT_ENABLED` was already added at M0 and is the only assistant value that genuinely belongs there. Approved as decision **D8** |
| **M6** | **§2.4** lists the client module set. M6 adds **four files that list does not name**: `circuitBreaker.ts` and `pendingAsk.ts` (both extracted so the logic is reachable by the pure-logic-only test runner rather than buried in a React provider), and `handlers/routes.ts` + `handlers/types.ts` (leaf modules that break what would otherwise be an import cycle between the handler map, the handlers and the executor — the same reasoning that produced `lib/resourceFields.js` at M1). Approved as decisions **D7** and, for the handler leaves, recorded here on the same basis |
| **M8** | **§4.1** stated "Exactly two" endpoints. **A third, `POST /api/assistant/events`, was approved and shipped at M8** — see the amended §4.1 for why the two-endpoint shape could not carry the field-edit rate without biasing it. Recorded here because a spec that quietly grows an endpoint is a spec nobody can check an implementation against |
| **M8** | **§4.8** requires an `Event` retention policy "before enabling telemetry". Delivered at M8 as **90 days**, enforced by `server/tools/pruneAssistantEvents.js` (scoped to the two `assistant_*` types and structurally unable to reach safety-flag or user-approval rows) rather than by an in-process sweeper, which would have put deletes on the very request path CHANGE-6 exists to keep quiet |
| **M7** | **§11 Definition of Done** requires an "eval baseline recorded (intent precision ≥90%, recall ≥75%, **grade-slot accuracy ≥85%**)". The first two are met and exceeded (95.8% / 85.8%, and 100% Hinglish against the architecture's ~85% Phase 2 gate). **Grade-slot accuracy is measured at ~20% and is NOT met.** It is not an oversight and not a measurement artifact: `mapGrade` handles 79 tabulated phrases correctly, so the deterministic half is not implicated, and M7b tried two independent prompt mechanisms to raise extraction — both measurably made it worse. Recorded as `golden_failures.md` GF-2 with the descriptor `examples` named as the untried lever. **M10 must check this criterion against the recorded measurement rather than assuming it was met**, which is precisely what this corrections table exists to prevent |

---

## 1. Implementation strategy

### 1.1 Ordering principle

Build **deterministic before probabilistic**, and **inside-out along the trust boundary**.

The entire feature can be built and exercised end-to-end *before any AI exists*, because a prefill
is just a data object. If a hand-written draft lands the teacher on the Generator with six correct
fields, the only thing the classifier adds is producing that object from a sentence.

Consequences: the risky part lands **last**, on a path already proven correct; when something breaks
after the classifier arrives you know it is the classifier; and if the project is cancelled after M3
you still shipped a working prefill mechanism and a capability registry.

### 1.2 Four ordering rules

| Rule | Meaning | Consequence if violated |
|---|---|---|
| **Contract-first** | Freeze the three wire shapes at M0 | Client and server block on each other for six weeks |
| **Deterministic before probabilistic** | Draft store, executor, prefill, vocabulary all before the classifier | Every bug looks like "the AI is dumb" |
| **Dark by default** | Every milestone merges with flags off | Long-lived branch, painful merge, no incremental review |
| **Evals before tuning** | The corpus exists (M7) before any threshold moves | Prompt tuning by anecdote |

### 1.3 Dependency graph

```
                  M0  Contract freeze + scaffolding
                                │
        ┌───────────────────────┴───────────────────────┐
   ═══ SERVER TRACK ═══                         ═══ CLIENT TRACK ═══
        │                                               │
   M1 Schema extract (ships alone)          M3 Draft store + Generator
        │                                       prefill (no AI at all)
   M2 Registry + catalog ◄─── catalog shape ────────────┤
        │                                               │
   M4 Vocab + resolver + policy                    M6 Gate, cache,
        │                                          provider, executor
   M5 Classifier + /interpret ──────────────────────────┘
        │
   M7 Evals → M8 Telemetry → M9 Hardening → M10 Rollout
```

**Hard dependencies:** M1→M2 (registry references the schema) · M2→M5 (prompt derives from the
registry) · M4→M5 (interpret composes resolver+policy) · M3→M6 (executor writes a draft the
Generator reads) · M5+M6→M7.

**Parallel:** the client track (M3) against the server track (M1/M2/M4). This is the main schedule
lever.

**Not on the critical path but launch-blocking:** M7 (evals) and M8 (telemetry). Both are commonly
deferred; both are why post-launch tuning is possible at all.

---

## 2. Repository impact

### 2.1 Backend — new

| Path | Responsibility |
|---|---|
| `server/src/actions/registry.js` | Action list, lookup, role filtering, catalog projection, catalog version |
| `server/src/actions/descriptors/generateAssessment.js` | The one real action |
| `server/src/actions/descriptors/openGenerator.js` | Bare navigation, no slots |
| `server/src/actions/schemas/generateAssessment.js` | The zod schema **moved** from `routes/resources.js` |
| `server/src/actions/vocab/grades.js` | Grade phrase → `GRADES` + ambiguity signalling |
| `server/src/actions/vocab/subjects.js` | Subject phrase → `SUBJECTS` |
| `server/src/actions/vocab/languages.js` | Explicit language-request detection only |
| `server/src/actions/vocab/index.js` | Barrel + shared normalization |
| `server/src/assistant/contracts.js` | **Frozen wire contracts** (M0) — constants + typedefs |
| `server/src/assistant/proposalSchema.js` | Zod for `IntentProposal` + the Gemini `responseSchema` |
| `server/src/assistant/classifier.js` | Prompt assembly, `geminiFast` call, response parse |
| `server/src/assistant/resolver.js` | Canonicalize, merge, provenance, param validation |
| `server/src/assistant/policy.js` | Decision policy — pure, no I/O |
| `server/src/assistant/interpret.js` | Pipeline orchestration only |
| `server/src/assistant/telemetry.js` | Decision logs + outcome events |
| `server/src/routes/assistant.js` | `GET /catalog`, `POST /interpret` |
| `server/src/lib/flags.js` | Boolean/list env parsing + assistant flags (M0) |

### 2.2 Backend — modified

| Path | Change | Milestone |
|---|---|---|
| `server/src/index.js` | Mount router; construct `geminiFast`; env tunables; assistant limiter; **limiter on `/resources/generate`** | M2/M5/M9 |
| `server/src/routes/resources.js` | Replace the inline `generateSchema` with an import. **Nothing else** | M1 |
| `server/.env.example` | Document new variables | M0 |

### 2.3 Backend — explicitly untouched

`gemini.js` · `prompts.js` · `safety/*` · `middleware/auth.js` · `routes/auth.js` · `routes/admin.js`
· `routes/queries.js` · `lib/db.js` · `lib/googleAuth.js` · `lib/email.js` · `lib/geminiPolicy.js` ·
`lib/assessmentSchema.js` · `lib/asyncHandler.js` · `seed.js`

> **`prisma/schema.prisma` is untouched. Phase 1 ships zero migrations.** Telemetry reuses `Event`.
> `[CHANGE-1]` The per-user opt-out is **removed from scope** — `preferencesSchema` in
> `routes/auth.js` is `.strict()`, so persisting a new preference key would require editing a
> protected file. Kill switch + role + school flags are sufficient for Phase 1 rollout control.

`gemini.js` needing no change is load-bearing: it already accepts per-instance tunables and supports
`responseSchema`, including correctly skipping the continuation loop for structured responses. **A
developer editing `gemini.js` has taken a wrong turn.**

### 2.4 Frontend — new

| Path | Responsibility |
|---|---|
| `client/src/assistant/types.ts` | **Frozen wire types** (M0). Deliberately *not* in `src/types.ts` — keeps the module self-contained and deletable |
| `client/src/assistant/api.ts` | Typed wrappers over the existing `api()` |
| `client/src/assistant/RouterProvider.tsx` | Session memory, pending ask, circuit breaker |
| `client/src/assistant/ActionExecutor.ts` | Dispatch; unknown-ID fallback |
| `client/src/assistant/handlers/index.ts` | Handler map — **the only place routes appear** |
| `client/src/assistant/handlers/generateAssessment.ts` | Write draft, navigate |
| `client/src/assistant/handlers/openGenerator.ts` | Navigate, no draft |
| `client/src/assistant/draftStore.ts` | sessionStorage CRUD, TTL, eviction, fail-soft |
| `client/src/assistant/generatorPrefill.ts` | **Added at M3.** The Generator's single seam into the router: read a draft, coerce untrusted params into typed form values, record the teacher's corrections. Guardrail G14 requires the page not to consume `RouterProvider` and phrased that as "imports exactly one function", but §6.4/§6.5 also require the page to mark a draft consumed and emit telemetry — more than one function. Putting all of it behind one module keeps the page's coupling to **a single import line**, which is what G14 is actually protecting, and makes the coercion unit-testable |
| `client/vitest.config.ts` | **Added at M3.** Test runner config (vitest + jsdom), scoped to `src/assistant/**`. Pure-logic modules only — see §10.3 |
| `client/src/assistant/sessionMemory.ts` | Typed slot store |
| `client/src/assistant/intentGate.ts` | Precision-first gate — pure |
| `client/src/assistant/repeatCache.ts` | Normalized-utterance cache |
| `client/src/assistant/catalog.ts` | Fetch, cache, version invalidation |
| `client/src/assistant/telemetry.ts` | Correction signal |
| `client/src/components/AiPrefillBanner.tsx` | Presentational only |
| `client/src/components/AiClarifyPrompt.tsx` | Presentational only |

### 2.5 Frontend — modified

| Path | Change | Size | Milestone |
|---|---|---|---|
| `client/src/App.tsx` | Wrap in `RouterProvider` | ~2 lines | M6 |
| `client/src/pages/CoachPage.tsx` | Submission pre-pass; clarify chips | ~40 lines | M6 |
| `client/src/pages/GeneratorPage.tsx` | Draft read; banner; provenance; telemetry | **actual: +220 / −27** (est. ~60; the excess is comments and per-field label restructuring, no behavioural code removed) | M3 |
| `client/src/config.ts` | Flag + constants | ~5 lines | M0/M6 |
| `client/src/index.css` | Banner/chip/marker styles | additive | M3 |
| `client/.env.example` | `VITE_ASSISTANT_ENABLED` | 1 line | M0 |
| `client/package.json` + lockfile | `vitest` + `jsdom` devDependencies and a `test` script | ~5 lines | M3 |

### 2.6 Frontend — explicitly untouched

`api.ts` · `auth.tsx` · `onboarding.tsx` · `main.tsx` · **`lib/resources.ts`** · `lib/assessment.ts`
· `lib/format.ts` · `lib/examMeta.ts` · `lib/math.ts` · `lib/followUp.ts` · `lib/tts.ts` ·
`lib/onboarding.ts` · all `hooks/*` · every page except Coach and Generator · every component except
the two new ones

> **`lib/resources.ts` staying untouched is the proof that the Generate path is untouched.**

### 2.7 The deletability test

Deleting `client/src/assistant/`, the two new components, `server/src/assistant/`,
`server/src/actions/`, `server/src/routes/assistant.js`, and reverting the modified files must
restore today's behavior exactly — with the sole intentional exception of the M1 schema extraction,
which stands on its own merits. **A merge checkpoint, not an aspiration.**

---

## 3. Folder structure

```
server/src/
├── actions/                ← Capability Registry. Knows WHAT the app can do.
│   │                         No AI, no HTTP, no Express. Testable in isolation.
│   ├── registry.js         ← Explicit descriptor list, role filter, catalog projection
│   ├── descriptors/        ← One file per action. Pure data + schema reference
│   ├── schemas/            ← Zod param schemas. THE definition, shared with the route
│   └── vocab/              ← Controlled-vocabulary mappers. Pure, heavily tested
│
├── assistant/              ← Intent Gateway. Utterance → ResolvedAction.
│   │                         Depends on actions/; actions/ never depends on this.
│   ├── contracts.js        ← Frozen wire contracts (constants + typedefs)
│   ├── proposalSchema.js   ← The untrusted-model boundary, in one file
│   ├── classifier.js       ← The ONLY file that talks to Gemini
│   ├── resolver.js         ← Canonicalize, merge, validate. No I/O, no AI
│   ├── policy.js           ← Decision rules. Pure
│   ├── interpret.js        ← Orchestration only. Thin
│   └── telemetry.js        ← Decision logs + outcome events
│
├── routes/assistant.js     ← HTTP shell: auth, rate limit, envelope, delegate
└── lib/flags.js            ← Boolean/list env parsing (mirrors config.js style)

server/evals/               ← Classification quality corpus + runner.
                              OUTSIDE test/ — not a CI gate (§10.5)

client/src/assistant/       ← Everything AI-routing. Self-contained and deletable.
                              Pages import at most ONE function from here.
```

**Two rules this encodes:**

1. `actions/` never imports from `assistant/` — the registry must stay usable by a non-AI consumer.
2. `assistant/` never imports a feature module — the handler navigates by route string and stops.

---

## 4. Backend design

### 4.1 Endpoints

**Three, as amended at M8.** This section read "exactly two" until M8; the third is
approved and its reasoning is recorded below.

| Method | Path | Auth | Rate limit | Purpose |
|---|---|---|---|---|
| `GET` | `/api/assistant/catalog` | `authRequired` | shared `limiter` | Role-filtered catalog + version |
| `POST` | `/api/assistant/interpret` | `authRequired` | dedicated `assistantLimiter` | Utterance + context → decision |
| `POST` | `/api/assistant/events` | `authRequired` | dedicated `assistantLimiter` | **M8.** Prefill delivered + outcome. Always 204 |

The first two are read-only. **The third writes `Event` rows and nothing else** — never to
anything a teacher owns (G8).

> **Why a third endpoint was necessary (approved before M8 began).** Both halves of the
> field-edit rate are **client-side facts**. The server knows it *decided* `prefill`; only the
> client knows the draft actually reached the form (it may have expired, storage may be
> disabled, the teacher may have navigated away) and which fields were then edited. The
> alternative considered was folding these onto the next `/interpret` call, which was rejected
> as **systematically biased**: a session that ends at the Generator — i.e. one where routing
> *worked* — never returns to the composer, so successes would under-report and the metric
> would be worse than none.

### 4.2 The interpret pipeline

| # | Stage | Module | On failure |
|---|---|---|---|
| 1 | Kill-switch check | `routes/assistant.js` | Immediate `passthrough`, no work |
| 2 | Auth | existing `authRequired` | **Hard 401** |
| 3 | Rate limit | `assistantLimiter` | **Hard 429** |
| 4 | Envelope validation | `routes/assistant.js` | **Hard 400** |
| 5 | Normalize (`normalizeQuery`) | existing `inputGuard` | Empty → `passthrough` |
| 6 | **Emergency check (`detectEmergency`)** | existing `inputGuard` | **Match → immediate `passthrough`; classifier never runs** |
| 7 | Per-user daily budget | `telemetry.js` | Exhausted → `passthrough` |
| 8 | Build role-filtered catalog | `registry.js` | Empty → `passthrough` |
| 9 | Classify | `classifier.js` | Timeout / 5xx / safety / unparseable → `passthrough` |
| 10 | Validate proposal → canonicalize → merge → validate params | `proposalSchema` → `resolver` | Unknown ID → `passthrough`; invalid params → drop slots, downgrade |
| 11 | Decide | `policy.js` | — |
| 12 | Telemetry | `telemetry.js` | Swallowed and logged |

`[CHANGE-5]` The server-side cache stage is **deferred to a later phase**.

**Stage 6 is non-negotiable:** a teacher describing an active emergency reaches the existing
emergency Coach prompt with zero added latency and zero chance of being routed into a worksheet form.

### 4.3 Response decisions

| `decision` | Meaning | Client behavior |
|---|---|---|
| `prefill` | Confident enough to open a module with values | Write draft, navigate, show banner |
| `ask` | Exactly one required slot missing | Render clarify chips; **do not navigate** |
| `passthrough` | Not an action, or anything failed | Submit to `/coach` exactly as today |
| `suggest` | **Defined but never emitted in Phase 1** `[CHANGE-4]` | — |
| `execute` | **Defined but never emitted in Phase 1** | Client must **reject defensively** and downgrade to `prefill` |

`execute` being defined-but-never-emitted is deliberate: a future server rollout must not be able to
surprise an old client into auto-generating.

### 4.4 Validation — three gates

| Gate | Validates | On failure |
|---|---|---|
| **1. Envelope** | The client's request shape | 400 |
| **2. Proposal** | Model output: zod shape **and** ID membership in the *role-filtered* catalog | Unknown intent → `passthrough` |
| **3. Params** | Merged slots against **the same** `generateSchema` the route uses | Drop offending slots, re-validate, downgrade |

Gate 2 is the security boundary — enum constraints in `responseSchema` are a hint, not a guarantee.
**Re-check membership after parsing, every time.**

> **Gate 3 subtlety that will bite someone:** `generateSchema` is `.strict()`. **Provenance,
> confidence and any other router metadata must travel as siblings of `params`, never inside it.**
> Merging them "to keep it together" makes every generation request 400.

### 4.5 Gemini flow

A **second `GeminiService` instance**, `app.locals.geminiFast`. Same class, no modification to
`gemini.js`.

| Tunable | Env var | Coach | **Router** |
|---|---|---|---|
| Model | `ASSISTANT_GEMINI_ENDPOINT` | `gemini-2.5-flash` | `gemini-2.5-flash-lite` (measure) |
| Per-call timeout | `ASSISTANT_LLM_TIMEOUT_MS` | 30000 | **3500** (1000–10000) |
| Overall deadline | `ASSISTANT_LLM_TOTAL_TIMEOUT_MS` | 60000 | **5000** (2000–15000) |
| Retries | `ASSISTANT_LLM_MAX_RETRIES` | 2 | **1** (0–2) |
| Calls per request | `ASSISTANT_LLM_MAX_CALLS` | 8 | **2** (1–3) |
| Max output tokens | `ASSISTANT_LLM_MAX_OUTPUT_TOKENS` | 8192 | **512** (128–1024) |

All parsed with the existing `parseIntEnv` so a bad value clamps with a warning instead of crashing.

**Timeout is a decision, not an error.** At the 5-second deadline the pipeline returns `passthrough`
with a 200.

`[CHANGE-8]` **Global breaker:** if the classifier observes N upstream 429s within a window, router
Gemini calls disable for M minutes while `/api/coach` continues unaffected. **When the upstream is
constrained, coaching wins.**

### 4.6 Registry location

`server/src/actions/registry.js`, assembling descriptors from `descriptors/` via an **explicit import
list** — not filesystem auto-discovery, which would make the active capability set depend on what
happens to be on disk.

Four capabilities: get by ID · list for a role (applying `requiredRoles`, `featureFlag`, `status`) ·
project the public catalog (descriptor minus `paramSchema`) · report `catalogVersion`.

Three startup validations (fail-fast): unique IDs · every descriptor's default slot set passes its
own `paramSchema` · every action has `autoExecute: false`.

### 4.7 Feature flags (server)

| Flag | Default | Effect |
|---|---|---|
| `ASSISTANT_ENABLED` | **false** | Master kill switch |
| `ASSISTANT_ACTION_GENERATE_ASSESSMENT` | **false** | Per-action |
| `ASSISTANT_ALLOWED_ROLES` | `teacher` | Coarse rollout using existing role data |
| `ASSISTANT_ALLOWED_SCHOOL_CODES` | empty = all | Tenant rollout, no new infrastructure |
| `ASSISTANT_DAILY_BUDGET_PER_USER` | 100 | Interpret calls per user per day |

Default-false at every layer. A deploy that forgets to set anything ships an inert feature.

### 4.8 Error handling

> **`/api/assistant/interpret` returns non-2xx only for auth, malformed requests, and rate limiting.
> Every other failure returns 200 with `passthrough: true`.**

This endpoint sits in front of a text box. A 502 here means an error toast on a feature the teacher
did not knowingly invoke.

`[CHANGE-6]` **Telemetry is split into two channels:**

| Channel | Contents | Volume | Destination |
|---|---|---|---|
| **Structured stdout log** | Every decision: request ID, action, decision, confidence, latency, calls, passthrough reason | One per interpret | Existing `logAiEvent` pattern — **zero DB cost** |
| **`Event` row** | Prefill *delivered*, and its outcome (generated / edited / undone / abandoned) | ~one per routed session | Database |

Rationale: `Event` is currently a *rare-incident* table. One row per interpret call would turn it
into a sustained write stream on **single-writer SQLite** that also serves every request — presenting
later as generalized slowness, misattributed. The split still yields field-edit rate (both numerator
and denominator come from the low-volume channel) while removing ~70% of the writes.

**Define an `Event` retention policy before enabling telemetry.** None exists today, which is fine
for rare incidents and not for routine telemetry.

---

## 5. Frontend design

### 5.1 RouterProvider

Mounted innermost in the existing provider stack, following the pattern `onboarding.tsx` already
establishes.

Owns: session slot memory (`sessionStorage`) · pending clarification (memory) · circuit-breaker
status (memory) · catalog + version (`sessionStorage`) · in-flight request state.

Does **not** own: form values, generated content, navigation history, or anything a page already
owns. It is a coordinator, not a store.

### 5.2 ActionExecutor

A dispatcher, not a decision-maker. Receives an already-decided `ResolvedAction`, looks up a handler
by `actionId`, invokes it.

- **Unknown `actionId`** → do not throw. Log, navigate to the module home if the domain is
  recognizable, otherwise passthrough. This is what makes server-side action rollout safe against
  stale PWA clients.
- **`decision: 'execute'`** → log and downgrade to `prefill`.
- **Handler throws** → catch, passthrough. A broken handler must not break the composer.

The handler map is the **only** place AI navigation route strings appear.

### 5.3 Draft store

| Property | Value | Reason |
|---|---|---|
| Storage | `sessionStorage` | Survives refresh, dies with the tab, never reaches the server |
| TTL | 30 minutes | Long enough for a distracted teacher |
| Retention | Last 5, oldest evicted | Bounded storage on low-end devices |
| ID | Opaque random | Never guessable |
| `initialParams` | **Immutable after creation** | Refresh semantics depend on it |
| Failure mode | **Fail soft, always** | Quota / disabled / corrupt → Generator opens empty |

The fail-soft rule is a hard contract. Private browsing, quotas and corrupt entries are all real on
the target devices. **A draft store failure degrades to today's behavior, never to a crash.**

The source utterance is stored **only** for banner text. It is never sent back to the server.

### 5.4 Navigation flow

```
Teacher types in the Coach composer
      │
      ▼
intentGate (pure, ~0ms, PRECISION-FIRST)  ──"not a command"──► existing /coach, unchanged
      │ "strong command signal"
      ▼
repeatCache hit? ──yes──► ResolvedAction (0ms, no network)
      │ no
      ▼
POST /api/assistant/interpret   [breaker open? → straight to /coach]
      │
      ├── passthrough ──► existing /coach, unchanged
      ├── ask ─────────► clarify chips inline; NO navigation
      └── prefill ─────► ActionExecutor → write draft → update memory
                              → navigate('/generator?ai=<draftId>')
                                    │
                                    ▼
                        GeneratorPage seeds its existing form state.
                        The router is now out of the picture.
```

**Rules**

1. Navigation is a **push** — the back button returns to the Coach with the conversation intact.
2. The URL carries only an opaque handle. **Teacher text never enters the URL**, history, referrer
   headers, or server access logs.
3. Phase 1's only entry point is the Coach composer. `CoachPage` has no unsaved-work guard, so
   **there is no dirty-guard interaction in Phase 1.** This becomes live the moment the composer
   appears on another page — record it as a Phase 2 entry condition.
4. `/generator` is always reachable directly with no handle, behaving exactly as today.

`[CHANGE-9]` **Stale-response guard.** Every interpret request carries a monotonic sequence number.
A response is discarded unless it is the newest in-flight request **and** the composer content is
unchanged since submission. Without this: a teacher gives up on a slow request, types a coaching
question, and the first response arrives and navigates them away mid-thought.

### 5.5 State management

No state manager is introduced. Ownership stays partitioned: `CoachPage` keeps composer/turns/history;
`GeneratorPage` keeps form fields via its existing `useState`; `RouterProvider` keeps memory and
pending ask; `draftStore` keeps drafts (not React state).

**Critical:** `GeneratorPage` does **not** consume `RouterProvider`. It imports one function — the
draft reader. It does not know a router exists and renders identically if the provider is absent.

### 5.6 Session memory

| Slot | TTL |
|---|---|
| `grade`, `subject`, `language` | Session |
| `format` | 3 turns |
| `topic` | **2 turns** |

Sent to the server on each call (server stays stateless). Cleared by "New chat". **Rendered, not
hidden** — `ContextBar` already displays this shape.

---

## 6. Generator integration

### 6.1 Mount and param-change sequence

`[CHANGE-7]` **The Generator reads the draft on mount AND whenever the `ai` parameter changes**,
guarded by an "already-applied draft ID" check so the same draft is never re-applied over the
teacher's edits.

> **Why this is mandatory, not a nicety.** React Router does not remount a component when only the
> search parameter changes — the path `/generator` stays the same. A mount-only read therefore
> **silently does nothing** on a second routing. Sequence: Coach → prefill A → back → Coach → new
> command → the Generator is already mounted → nothing happens. The teacher concludes the feature is
> broken. This is the single most likely functional bug in the plan.

Sequence:

1. Read the `ai` query parameter. Absent → behave exactly as today.
2. Look up the draft. Missing / expired / wrong action / store failure → behave exactly as today.
3. **Version check** — if `draft.version` exceeds the client's known version, prefill only recognized
   fields.
4. Seed each form field: draft value where present, existing default otherwise.
5. Store the provenance map in local page state.
6. Render the banner.

**No generation request fires on mount.**

### 6.2 Draft storage

Written by the handler *before* navigation, read by the Generator *after* mount, keyed by the opaque
URL handle. Never sent to the server, never in `localStorage`. `initialParams` immutable.

### 6.3 Refresh behavior

**Specified: the AI prefill is re-applied from `initialParams`; unsaved manual edits are lost.**

This is correct, not a compromise. Today, refreshing the Generator loses *everything*. Re-applying
the prefill is strictly better than the status quo. The alternative — persisting live edits on every
keystroke — adds a write-heavy sync path, a draft/edit merge conflict, and a new class of bug, to
protect against an action browsers already treat as destructive.

Once a draft is `consumed` (via Undo), refresh loads plain defaults.

### 6.4 Undo — "Clear AI fields"

1. Every AI-provenance field resets to the **Generator's own default** — not blank. Blanking would
   leave required fields empty and the Generate button disabled, reading as a broken page.
2. Fields the teacher already edited are left alone. **Undo reverses the AI, not the teacher.**
3. Provenance clears; markers and banner disappear.
4. The draft is marked `consumed`.
5. The `ai` parameter is removed via a **replace** navigation — no history entry, back button still
   returns to the Coach.
6. An `undo_all` telemetry event fires — a high-signal indicator that a routing was flatly wrong.

Available until Generate is pressed; the banner auto-dismisses after generation.

### 6.5 Manual edits

Field provenance becomes `user`; its marker disappears; the banner stays. A correction event fires
with **field name and previous provenance only — never the value.** No re-interpretation, no
navigation. The teacher's edit is final.

### 6.6 Correctness details

**Grade** — canonicalized server-side. Confident → canonical value. Ambiguous → prefill the raw
string, mark low-confidence (safe because the field is free text with a `datalist`). Unmapped →
profile default, visibly labelled.

**Language** — set **only** from an explicit request. Never inferred from input script.

**Question count** — extracted only when a number sits adjacent to a question noun. A bare number in
a topic ("Chapter 5 fractions") is not a count.

**API-required slots** (`difficulty`, `questionType`, `questionCount`) — defaults move from
`GeneratorPage`'s `useState` literals into the registry. Provenance `default`, and **not** marked
with confidence indicators: flagging six fields as "guessed" reads as failure when it is just the
form's normal defaults.

### 6.7 The Generate path

Unchanged. `handleGenerate` runs as today; `generateAssessment()` posts the shape it posts today;
preview, `examMeta`, edit and Save are untouched.

> **The router contributes initial `useState` values and a banner. That is the entire integration.**
> Router concepts inside `handleGenerate`, `handleSave` or any request body mean the integration has
> overreached.

### 6.8 Banner / onboarding-tip stacking

`[CHANGE-10]` `GeneratorPage` already renders an `OnboardingTip` for `generator-intro` above the
form. A first-time teacher arriving via AI routing would see two stacked banners plus a form — on a
small screen the form may fall entirely below the fold.

**Rule: the AI prefill banner takes precedence.** When a draft is applied, suppress the onboarding
tip for that visit **without marking it dismissed**, so it appears on a later manual visit. The
banner is contextual to *this* action and carries an Undo; the tip is general education that can wait.

Verify on a small viewport.

### 6.9 Accessibility

`[CHANGE-12]` The codebase is consistently careful (`role="radiogroup"`, `aria-checked`,
`aria-pressed`, `aria-label`, `aria-current`). New UI matches those conventions rather than inventing
new ones:

- The banner is an `aria-live="polite"` region — it announces something that happened without a user
  request.
- Chips form a proper radio/button group with labels.
- Provenance markers are **not colour-only** — each carries an accessible label.
- Undo is a real button with a descriptive label.
- The clarifying question is programmatically associated with its options.

---

## 7. API contracts

### 7.1 `GET /api/assistant/catalog`

**200:**

```json
{
  "catalogVersion": 1,
  "actions": [
    {
      "id": "generate_assessment",
      "version": 1,
      "status": "active",
      "domain": "generator",
      "effect": "draft",
      "summary": "Create a printable quiz or worksheet with an answer key.",
      "examples": [
        "Generate a Class 5 fractions worksheet",
        "Create a Science paper for Class 8",
        "Class 3 ke liye maths quiz banao"
      ],
      "slots": [
        { "name": "format", "type": "enum", "required": true,
          "values": ["quiz", "worksheet"],
          "ask": "Quiz or worksheet?", "askOptions": ["Quiz", "Worksheet"] },
        { "name": "topic", "type": "text", "required": true,
          "ask": "What topic should it cover?" },
        { "name": "grade", "type": "vocab", "vocab": "GRADES", "required": false },
        { "name": "subject", "type": "vocab", "vocab": "SUBJECTS", "required": false },
        { "name": "difficulty", "type": "enum", "required": false,
          "values": ["easy", "medium", "hard"] },
        { "name": "questionType", "type": "enum", "required": false,
          "values": ["mcq", "true_false", "short_answer", "mixed"] },
        { "name": "questionCount", "type": "number", "required": false, "min": 3, "max": 30 },
        { "name": "language", "type": "vocab", "vocab": "LANGUAGES", "required": false }
      ]
    },
    {
      "id": "open_generator",
      "version": 1,
      "status": "active",
      "domain": "generator",
      "effect": "read",
      "summary": "Open the quiz and worksheet generator.",
      "examples": ["Open the generator", "I want to make a worksheet"],
      "slots": []
    }
  ]
}
```

`paramSchema`, `requiredRoles` and `featureFlag` are **absent by design**.

**Kill switch off — 200:** `{ "catalogVersion": 0, "actions": [] }`. An empty catalog is a valid
inert state, not an error.

### 7.2 `POST /api/assistant/interpret`

**Request:**

```json
{
  "utterance": "Generate a Class 5 fractions worksheet",
  "catalogVersion": 1,
  "memory": {
    "grade":   { "value": "Class 3-5",   "source": "utterance", "turn": 2 },
    "subject": { "value": "Mathematics", "source": "utterance", "turn": 2 }
  },
  "pendingAsk": null,
  "turn": 3,
  "sequence": 7
}
```

`sequence` supports the stale-response guard `[CHANGE-9]`.

**200 — `prefill` (the main path):**

```json
{
  "catalogVersion": 1,
  "passthrough": false,
  "actions": [
    {
      "actionId": "generate_assessment",
      "version": 1,
      "effect": "draft",
      "decision": "prefill",
      "confidence": "high",
      "params": {
        "format": "worksheet",
        "topic": "Fractions",
        "grade": "Class 3-5",
        "subject": "Mathematics",
        "difficulty": "medium",
        "questionType": "mcq",
        "questionCount": 10,
        "language": "en"
      },
      "provenance": {
        "format": "utterance", "topic": "utterance", "grade": "utterance",
        "subject": "memory", "difficulty": "default", "questionType": "default",
        "questionCount": "default", "language": "profile"
      },
      "lowConfidenceFields": [],
      "missing": []
    }
  ],
  "memoryUpdates": {
    "format": { "value": "worksheet", "source": "utterance", "turn": 3 },
    "topic":  { "value": "Fractions", "source": "utterance", "turn": 3 },
    "grade":  { "value": "Class 3-5", "source": "utterance", "turn": 3 }
  },
  "requestId": "6f1c…"
}
```

Note `provenance` sits **beside** `params`, never inside.

**200 — `ask` (one required slot missing):**

```json
{
  "catalogVersion": 1,
  "passthrough": false,
  "actions": [
    {
      "actionId": "generate_assessment",
      "version": 1,
      "effect": "draft",
      "decision": "ask",
      "confidence": "high",
      "params": { "topic": "Fractions", "grade": "Class 3-5", "difficulty": "medium",
                  "questionType": "mcq", "questionCount": 10, "language": "en" },
      "provenance": { "topic": "utterance", "grade": "memory", "difficulty": "default",
                      "questionType": "default", "questionCount": "default",
                      "language": "profile" },
      "missing": ["format"],
      "ask": {
        "slot": "format",
        "question": "Quiz or worksheet?",
        "options": [
          { "label": "Quiz", "value": "quiz" },
          { "label": "Worksheet", "value": "worksheet" }
        ]
      }
    }
  ],
  "requestId": "8a2d…"
}
```

`[CHANGE-3]` **Answering by chip is resolved entirely client-side** — the client already holds the
full params; it fills `format` and executes. **No second network call, no second LLM call.** Only a
free-text answer re-calls `/interpret` with `pendingAsk` populated.

**200 — `passthrough`:**

```json
{
  "catalogVersion": 1,
  "passthrough": true,
  "actions": [],
  "reason": "not_an_action",
  "requestId": "c3f9…"
}
```

`reason` ∈ `not_an_action` · `low_confidence` · `disabled` · `classifier_timeout` ·
`classifier_error` · `safety_blocked` · `invalid_proposal` · `budget_exhausted` ·
`emergency_detected`. **Diagnostic only — never shown to the teacher.** All produce identical UX.

### 7.3 Errors

**401:** `{ "error": "Your session has expired. Please log in again." }` — the existing shape, so the
existing refresh-and-retry handles it with no new code.

**400:** `{ "error": "A non-empty \"utterance\" string is required.", "requestId": "…" }`

**429:** existing limiter shape. Client opens its circuit breaker for 60 s.

**There is no 5xx contract for `/interpret`.** A 5xx reaching the client is a bug.

### 7.4 Validation examples

| Input | Gate | Outcome |
|---|---|---|
| 900-char utterance | 1 | 400 — cap is 500, matching `MAX_QUERY_LENGTH` |
| Only zero-width characters | 1→5 | Normalizes to empty → `passthrough` |
| `"intent": "delete_all_resources"` | 2 | Not in catalog → `passthrough`, logged |
| `"questionCount": 500` | 3 | Fails schema (max 30) → slot dropped, default 10, `prefill` |
| `"grade": "class 5"` | canonicalize | → `"Class 3-5"`, provenance `utterance` |
| `"grade": "class 5-6"` | canonicalize | Ambiguous → raw string prefilled, marked low-confidence |
| `"format": "test paper"` | 3 | Not in enum → dropped → `format` missing → `ask` |
| "how do I manage a noisy class?" | gate | `passthrough`, `not_an_action` |
| "a student is unconscious" | 6 | `passthrough`, `emergency_detected`, **classifier never called** |

---

## 8. Action Registry

### 8.1 Registration

An explicit import list in `registry.js`. The live capability set must be visible in one file, in a
diff, in a review.

### 8.2 Schema attachment

By reference. `descriptors/generateAssessment.js` imports from `actions/schemas/generateAssessment.js`;
`routes/resources.js` imports the identical module.

The M1 refactor must **move** the schema, not copy it. When done, searching the server for
`format: z.enum` must return exactly one hit.

### 8.3 Adding a future action

Four artifacts and nothing else: a descriptor (+ one registry line) · a zod schema · a client handler
(+ one map line) · ≥10 eval cases. Plus a `catalogVersion` bump.

> **If adding an action requires editing `classifier.js`, `resolver.js`, `policy.js`, `interpret.js`
> or `ActionExecutor.ts`, the abstraction has failed. Stop and fix the core.**
>
> Make this an explicit review question on every future action PR: *which core files did this touch?*
> The correct answer is none.

### 8.4 Vocabulary duplication

`[CHANGE-11]` The canonical grade and subject lists live in `client/src/config.ts`. The server has no
copy today (it accepts free text). The vocab mapper introduces a **new server-side copy of a
client-side constant**.

Resolution for Phase 1: **accept the duplication with mandatory cross-referencing comments in both
files**, matching the existing convention in `routes/resources.js` (the answer-key heading copy).
"Did you update both?" becomes a review checklist item.

Phase 2 migrates the Generator's `datalist` to the catalog, at which point the duplication disappears
legitimately. **This is a conscious, documented exception** — undocumented duplication is the debt;
documented duplication with a scheduled resolution is a tradeoff.

---

## 9. Milestones

| M | Goal | Deliverable | Independently testable by | Effort |
|---|---|---|---|---|
| **M0** | Eliminate cross-team blocking | Frozen contracts both sides; folder scaffolding; flags defined (all OFF); `.env.example`; **planning docs persisted** | Server boots unchanged; client builds unchanged; CI green | 1.0 d |
| **M1** | One definition of the generation contract | `generateSchema` moved; route imports it | **`resources.test.js` passes with zero modifications** | 0.5 d |
| **M2** | The app can describe itself | Registry, 2 descriptors, `GET /catalog`, startup validations | Unit: filtering, projection, no `paramSchema` leak. Supertest: 401, empty-when-disabled | 2.0 d |
| **M3** | Prove prefill with zero AI | Draft store, Generator integration, banner, provenance, undo, telemetry stubs | **Hand-write a draft into sessionStorage, navigate to `/generator?ai=…`.** Every §6 behavior verifiable with no server, no model | 3.0 d |
| **M4** | All deterministic logic, unit-tested | Vocab mappers, slot merge, policy | Pure-function tests. ~40 grade phrases. Policy as a truth table | 3.0 d |
| **M5** | Utterance → ResolvedAction | `geminiFast`, prompt from registry, `responseSchema`, 12-stage pipeline, endpoint | Supertest + `geminiMock` — happy path, unknown ID, invalid params, timeout, safety block, emergency. **No real Gemini calls in CI** | 4.0 d |
| **M6** | The composer routes | Gate, cache, provider, executor, handlers, CoachPage, chips, breaker | End-to-end locally. Flag off → identical to today | 4.0 d |
| **M7** | Know how good it is | ≥120 labelled utterances; runner; recorded-fixture CI mode | It *is* the test | 5.0 d |
| **M8** | Post-launch tuning possible | Split telemetry channels; metrics query | `Event` rows correct and clean | 2.0 d |
| **M9** | Safe to expose | Limiters, budget, breaker, security review, log audit, deletability test | Limiter tests; deliberate attempt to reach a destructive action | 3.0 d |
| **M10** | Real teachers, small numbers | Staged rollout, monitoring | §11 Definition of Done | 5.0 d |

> Every milestone additionally ends with the **Milestone Completion Protocol** (§21 of the living
> README): review, verify, manually test, regression test, compare against these documents, update
> documentation, produce a completion report, **then stop for approval.**

---

## 10. Testing strategy

### 10.1 Server unit tests

| Module | Focus | Cases |
|---|---|---|
| `vocab/grades.js` | Canonicalization | ~40: "class 5", "5th", "V", "पाँचवीं", "class 5-6" (ambiguous), "primary" (ambiguous), "nursery", garbage |
| `vocab/subjects.js` | Mapping + synonyms | ~20 |
| `policy.js` | Decision truth table | Every confidence × completeness × effect. **`destructive` never exceeds `prefill` at any confidence** |
| `resolver.js` | Precedence + provenance | utterance > memory > profile > default; contradiction; param failure |
| `registry.js` | Filtering + projection | Role, flag, `paramSchema`/`requiredRoles` never projected |
| `proposalSchema.js` | Untrusted boundary | Unknown intent, missing fields, wrong types, injected keys |

### 10.2 Server integration tests

Supertest via `test/helpers/testApp.js` with `mockGeminiFetch` stubbing `fetch`. **No network, no API
key, deterministic.** Respect `fileParallelism: false` — tests share one SQLite file.

Scenarios: catalog auth/filtering/disabled · interpret happy path · each passthrough reason · unknown
action ID · params failing the schema · oversized utterance · **emergency short-circuit (assert
Gemini `fetch` was never called)** · rate limit · budget exhaustion · telemetry cleanliness.

### 10.3 Client tests

**There is currently no client test runner** (no Vitest, no jsdom; CI runs only lint and build).

**Decision: add Vitest for pure-logic modules only** — `draftStore`, `intentGate`, `sessionMemory`,
`repeatCache`. **Do not add React Testing Library in Phase 1.** The draft store has quota failures,
corrupt JSON, TTL expiry and eviction — all cheap to test and all guaranteed to occur on the target
devices. Component behavior is better covered by the manual script at this stage; introducing a
component-testing culture mid-project is a separate initiative.

**Execution timing: M3**, alongside the first module worth testing. A test runner installed with zero
tests is unverifiable scaffolding; installing it with its first real test proves both at once.
Requires `vitest` + `jsdom` devDependencies, a client `vitest.config`, and a CI step.

### 10.4 Manual testing script

Every step run with the flag on and again with it off.

**Prefill** · **Clarify** · **Memory** ("now make one on decimals") · **Passthrough** · **Refresh**
· **Undo** · **Manual edit** · **Degradation** (backend stopped; sessionStorage disabled; flag
flipped mid-session) · **Mobile** (small viewport, bottom nav, chips) · **Language** (a Hindi
utterance with unstated output language must use the profile default).

### 10.5 Evals — deliberately not a CI gate

The corpus lives in `server/evals/`, outside `test/`, and **does not run on every PR**. It is
non-deterministic, costs money, needs a live key, and measures the *model* rather than the *code*. A
flaky paid gate gets disabled within a month, leaving no evals at all.

Instead: a CI mode using recorded fixtures (deterministic, free — catches pipeline regressions), plus
manual live runs before each rollout stage and after any prompt or registry change, with results
recorded in a tracked file.

### 10.6 Regression

The whole existing suite must pass **unmodified**. Guards: `resources.test.js` (M1 changed nothing) ·
`coach.reliability.test.js` (Coach untouched) · `gemini.*.test.js` (`geminiFast` did not perturb the
shared service) · `rbac.test.js` / `tenant-isolation.test.js` (no isolation weakened) ·
`ai-safety.test.js` (guards still apply).

> **A PR that modifies an existing test file to make it pass is a red flag requiring explicit
> justification.**

---

## 11. Definition of Done

**Functional** — utterance produces ≥6 correct prefilled fields · one missing slot produces one chip
question · coaching questions pass through · memory carries grade/subject, topic expires · refresh,
undo and manual-edit behaviors match §6 · Generate/preview/`examMeta`/Save byte-identical ·
`/generator` with no handle identical to today.

**Quality** — full existing suite passes **unmodified** · new unit tests (vocab, **policy proven by
exhaustive enumeration of its complete input space**, resolver, registry, proposal) · integration
covers every passthrough reason and the error contract · client pure-logic tests exist · manual
script executed by someone who did not write the code · eval baseline recorded (intent precision
≥90%, recall ≥75%, grade-slot accuracy ≥85%) · lint clean, client builds, CI green.

> **Amended at M4 (decision D1).** This criterion previously read "policy 100% branch". The policy's
> input space is finite and small, so the delivered tests **enumerate it completely** — every effect
> class × confidence × margin × completeness × contradiction × `autoExecute` combination is generated
> and asserted, rather than sampled until a coverage percentage is reached. That is a stronger claim
> than line-instrumented branch coverage (it exercises every combination of inputs, not merely every
> line), and it requires no coverage tooling, so `server/package.json` stays untouched. Corrected
> here rather than only in the living README, because a Definition of Done that is checked at M10
> against a criterion nobody actually applied is how a completion protocol quietly stops meaning
> anything.

**Safety** — every descriptor `autoExecute: false`, validated at startup · no action above `draft` ·
fabricated IDs produce passthrough · `paramSchema`/`requiredRoles` never in a response · no utterance
text in any log or `Event` · emergency short-circuit verified (zero Gemini calls) · limiters on
`/interpret` **and** `/resources/generate` · per-user budget enforced · security review signed off.

**Operations** — kill switch verified in staging (<60 s) · circuit breaker verified by killing the
backend · monitoring live · field-edit rate computable · rollback tiers 1 and 2 rehearsed.

**Documentation** — README updated (endpoints, env vars, flags) · `.env.example` complete both sides
· "how to add an action" written as the four-artifact checklist · eval baseline recorded.

**"Nothing changed" proofs** — flags off ⇒ **zero** assistant requests in a network trace · flags off
⇒ behavior indistinguishable from the previous release · `git diff` touches no file in §2.3 or §2.6 ·
**zero Prisma migrations** · deletability verified.

---

## 12. Timeline

| Team | Calendar |
|---|---|
| 1 developer | 7–8 weeks |
| **2 developers** | **4.5–5 weeks** (client track ∥ server track, converging at M6) |
| 3 developers | ~4.5 weeks (coordination cancels most of the third person) |

Total implementation effort ≈ **32.5 dev-days**, plus ~0.5 d per milestone for the completion
protocol (≈ 5.5 d). Add **20% contingency**, concentrated in M4 (vocabulary is always
underestimated) and M7 (nobody's first eval corpus is good enough).

Estimates assume the flag stays off in the branch throughout. A "let's just turn it on to show
someone" mid-project costs more than the contingency.
