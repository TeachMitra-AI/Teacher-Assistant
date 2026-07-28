# AI Action Router — Architecture Document

**Status:** Approved · **Phase:** 1 (Generator only) · **Owner:** Teacher Assistant engineering
**Created:** 2026-07-27 · **Last amended:** 2026-07-28 (M0 — amendments incorporated)

> **Companion documents**
> - [`ai-action-router-phase1-spec.md`](./ai-action-router-phase1-spec.md) — implementation specification
> - [`ai-action-router-guardrails.md`](./ai-action-router-guardrails.md) — guardrails & impact analysis
> - [`AI_ACTION_ROUTER_README.md`](./AI_ACTION_ROUTER_README.md) — **living project state (single source of truth)**

## Amendment log

The final design review (2026-07-27) produced 12 binding amendments. Those affecting this document
are incorporated inline and marked `[CHANGE-n]`. The full list lives in §5.3 of the living README.

| Applied here | Effect |
|---|---|
| CHANGE-2 | Client gate tuned for **precision**, not recall (§3.2) |
| CHANGE-3 | Chip answers resolve **client-side**, no second LLM call (§5.2) |
| CHANGE-4 | `suggest` decision **deferred to Phase 2** (§5.2) |
| CHANGE-5 | Server-side repeat cache **deferred** (§3.2) |
| CHANGE-8 | Router **yields to Coach** under upstream quota pressure (§9, §10.4) |

---

## 1. Executive summary

This document specifies an intelligence layer that lets a teacher type naturally — *"Generate a
Class 5 fractions worksheet"* — and have the application open the right module with the right
fields pre-filled.

The recommendation differs from the original framing in one important way.

The request was for an **AI Action Router**. The recommendation is to build a **Capability
Registry** first, and treat the AI router as one of several front ends onto it.

The router is the exciting part and the part that will be rewritten three times. The registry — a
machine-readable description of *what this application can do, with what parameters, under what
permissions* — is the durable asset. It is useful with zero AI: it can drive a command palette,
onboarding suggestion chips, the admin permission matrix, and the evaluation corpus. Build the
registry, ship a non-AI command palette on it, and the AI layer becomes a swappable front end.

Everything follows from one invariant:

> **The model proposes. The application disposes.**
>
> The model never emits a route, never emits an ID, never triggers an effect. It emits a *proposal*
> against a catalog the application owns, which the application validates with the same schemas and
> the same authorization it uses for a manual click.

---

## 2. Challenging the original flow

Five weaknesses in the flow as originally described.

### 2.1 "Action Router" fuses three concerns that must not be one component

| Concern | Nature | Owner |
|---|---|---|
| Understanding — "what did they mean?" | Probabilistic; will always sometimes be wrong | LLM |
| Resolution — "what exactly should happen?" | Deterministic, validated, authorized | Application (server) |
| Execution — "make it happen in the UI" | Deterministic, reversible, observable | Application (client) |

The standard failure mode is letting the LLM do all three. Then a wrong classification becomes a
wrong *action*, not just a wrong *suggestion*. With the seams kept sharp, a misclassification
degrades to "landed on the wrong page with a prefilled form" — annoying, recoverable, undoable.

### 2.2 Confidence as a single float is not a real signal

LLMs are poorly calibrated at self-reported numeric confidence. A policy built on
`if (confidence > 0.8) execute()` feels random. §5 replaces it with a multi-signal policy in which
**effect class dominates confidence**.

### 2.3 Conversational slot-filling is the wrong UI for more than two slots

The originally sketched exchange — *"Which class?" → "5" → "Subject?" → "Math"* — is worse than the
current form: four round trips, ~6 seconds of latency, and a keyboard on a low-end Android device,
to fill two fields a teacher can see and correct at a glance.

**The prefilled form is the disambiguation UI.** The router's job is to jump the teacher into the
form with 6 of 8 fields already right, not to interview them. Conversational questions are reserved
for the case of exactly *one* missing required slot.

### 2.4 "The app should just know" is an invisible product

If teachers cannot see which phrasings work, they will try twice, fail once, and go back to
clicking. The mitigation is architectural: the registry's `examples` field feeds both the classifier
prompt *and* the visible suggestion chips, so what the app advertises and what it understands cannot
drift apart.

### 2.5 The Coach/Router boundary is fuzzy and must fail toward Coach

*"Explain fractions to Class 5"* is a Coach answer. *"Make me a fractions worksheet for Class 5"* is
an action. *"Help me with fractions"* is neither. Fortunately the Coach is a universal, always-valid
fallback: **no utterance ever has to dead-end.** "I don't know what you meant" costs the teacher
nothing but a normal coaching answer.

---

## 3. High-level architecture

### 3.1 Layers

```
┌──────────────────────────────── CLIENT ─────────────────────────────────┐
│  Composer (existing Coach box) · Command palette · Suggestion chips      │
│                          │                                              │
│                          ▼                                              │
│              ┌────────────────────────┐  cheap, local, no network       │
│              │ Intent Gate + Cache    │  "does this look like a         │
│              │ (precision-first)      │   command?" + repeat cache      │
│              └───────────┬────────────┘                                 │
│                          ▼                                              │
│            POST /api/assistant/interpret                                │
│                          ▼                                              │
│              ┌────────────────────────┐  session slot memory,           │
│              │   RouterProvider       │  pending clarification,         │
│              │                        │  circuit breaker, drafts        │
│              └───────────┬────────────┘                                 │
│                          ▼                                              │
│              ┌────────────────────────┐  actionId → handler →           │
│              │   ActionExecutor       │  navigate + prefill             │
│              └───────────┬────────────┘                                 │
│                          ▼                                              │
│   Generator · Library · Workspace · Coach · Settings · Admin             │
│      (UNCHANGED modules — the router is additive, never a wrapper)       │
└─────────────────────────────────────────────────────────────────────────┘
                           │
┌───────────────────────── SERVER ────────────────────────────────────────┐
│  POST /api/assistant/interpret                                          │
│    1 authn/authz → 2 rate limit → 3 normalize → 4 emergency check        │
│    5 budget → 6 catalog build → 7 classify (geminiFast + responseSchema) │
│    8 proposal validation → 9 canonicalize → 10 slot merge                │
│    11 paramSchema validation → 12 decision policy → telemetry            │
│                          │                                              │
│  ┌───────────────── CAPABILITY REGISTRY ──────────────────┐             │
│  │ descriptors: id, effect, roles, slots, paramSchema,     │             │
│  │ examples, flags, version                                │             │
│  └─────────────────────────────────────────────────────────┘             │
│                                                                          │
│  GET /api/assistant/catalog   (role-filtered, versioned)                 │
│  Existing routes untouched: /coach /resources /admin /auth               │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Where intent detection happens — hybrid, precisely scoped

| | Frontend-only | Backend-only | **Hybrid (chosen)** |
|---|---|---|---|
| API key exposure | Impossible — disqualifying | Safe | Safe |
| Latency, common cases | Best | +600–1500 ms on every utterance | Best for repeats; backend otherwise |
| Cost | n/a | One LLM call per utterance | Gate + cache remove a large share |
| Policy tuning | Needs a client release | Instant | Instant |
| Authorization correctness | Impossible to trust | Correct | Correct |
| Offline / 2G | Degrades gracefully | Dead | Degrades gracefully |

Frontend-only is disqualified by the API key alone (`GEMINI_API_KEY` is server-only —
`server/src/index.js`). Backend-only pays an LLM call for every message, including coaching
questions that will never be actions.

**The client layer is a filter and a cache. It never classifies.**

- **Tier 0 — Structured entry points (zero NLU).** Chips, palette entries, quick actions emit a
  fully-formed action directly. No model, no latency, no cost. This hardens the execution pipeline
  before the classifier is ever trusted with it.
- **Tier 1 — Client gate.** `[CHANGE-2]` **Tuned for high precision, accepting lower recall.** Refer
  to the classifier only on a strong command signal (imperative verb adjacent to a domain noun).
  Everything ambiguous goes straight to Coach.

  > **Rationale for the reversal.** The original design said "over-refer, never decide," reasoning
  > that a false *maybe* costs only one round trip. That is wrong: a false *maybe* costs the full
  > classifier budget **added to** the Coach call, on the app's most common path, for teachers who
  > may never use the router. A missed routing costs one manual navigation — today's experience.
  > Five extra seconds on every coaching question costs adoption. Measure the recall gap via the
  > eval corpus and widen deliberately in Phase 2.

- **Tier 2 — Client repeat cache.** Normalized utterance → resolved action, `sessionStorage`,
  ~1 hour TTL, invalidated on catalog version change.
- **Tier 3 — Server classifier.** One Gemini call, small catalog-derived prompt, tight budget.

`[CHANGE-5]` **The server-side repeat cache is deferred.** With two actions and pilot traffic it adds
an invalidation surface (role, catalog version, flags all affect correctness) for negligible benefit.
Add it when measured hit-rate data justifies it.

### 3.3 Responsibility table

| Responsibility | Lives | Why |
|---|---|---|
| Capability registry | Server | Authorization and schemas must be server-authoritative |
| `paramSchema` per action | Server, **shared with the route** | Two schemas = two divergent contracts |
| Classification | Server | API key is server-only |
| Prompt construction | Server | Keeps the injection boundary in one place |
| Canonicalization | Server | Must match both the client vocabulary and server enums |
| Slot precedence + provenance | Server | Reads profile preferences server-authoritatively |
| Decision policy | Server | Thresholds tunable without a client release |
| Route mapping (`actionId` → path) | **Client** | The server must never emit a URL |
| Prefill application | Client | Module-local form state |
| Session slot memory | Client (Phase 1) | Keeps the server stateless, matching `/api/coach` |
| Confirmation UX | Client | Uses each module's *existing* guards |
| Telemetry | Both | Server: decisions. Client: the correction signal |

### 3.4 Non-negotiable invariants

1. **Every action stays reachable without the router, forever.**
2. **The router adds no capability** — only things a teacher could already do by clicking.
3. **The model never emits an identifier that grants access** — no route, no `resourceId`, no
   `userId`. It emits *criteria*; the app resolves them against rows the caller owns.
4. **Effect class is registry-declared, never model-declared.**
5. **Modules never import the router.** Dependency points one way.

---

## 4. The Action schema

Three distinct schemas. Keeping them separate is what prevents a rewrite.

### 4.1 ActionDescriptor — static, server-owned

| Field | Purpose | In catalog |
|---|---|---|
| `id` | Permanent identifier; never renamed or reused | ✅ |
| `version` | Bumped on breaking slot changes | ✅ |
| `status` | `active` / `beta` / `deprecated` | ✅ |
| `domain` | Grouping for UI and telemetry | ✅ |
| `effect` | `read` / `draft` / `write` / `destructive` — **caps the policy** | ✅ |
| `requiredRoles` | Filtered server-side before prompt construction | ❌ |
| `featureFlag` | Env flag gating this action | ❌ |
| `autoExecute` | **Must be `false` for every Phase 1 action** | ❌ |
| `summary` | One line for the classifier prompt | ✅ |
| `examples` | ≥5 including Hinglish; feeds prompt, chips and evals | ✅ |
| `slots` | Slot definitions | ✅ |
| `paramSchema` | **Reference** to the route's zod schema | ❌ |

**Two deliberate omissions:**

- **No route or URL.** Coupling is by ID only; the client holds the handler map. A server that ships
  a new action to an old client produces an unknown ID, which the client handles gracefully. Given
  the client is a PWA with service-worker caching, stale clients are routine, not theoretical.
- **`paramSchema` is a reference, not a copy.** The same object validates the router's output and
  the endpoint's input. *If you copy it, the rewrite has already started.*

**SlotSpec:** `name`, `type` (`enum`/`vocab`/`text`/`number`), `values` or `vocab`, `required`,
`defaultFrom` (`prefs.*` / `memory.*` / constant), `ask`, `askOptions`, `sensitive`, `min`/`max`.

### 4.2 IntentProposal — the model's output, untrusted

Fields: `intent` (catalog-constrained enum, or `unknown`/`coach_question`), `confidence`,
`alternatives`, `slots`.

Three rules, each earning its place:

- **`confidence` is ordinal** (`high`/`medium`/`low`). Models produce meaningless numeric confidence
  and meaningfully *ordered* categorical confidence.
- **Slots are raw strings.** The model returns `"class 5"`, not `"Class 3-5"`. Canonicalization is
  the app's job — testable, fixable, localizable without touching a prompt.
- **`intent` is enum-constrained in `responseSchema` *and* re-checked server-side.** A schema
  constraint is a strong hint, not a guarantee.

### 4.3 ResolvedAction — the app's output, trusted

Fields: `actionId`, `version`, `effect`, `decision`, `params`, `provenance`, `missing`, `ask`,
`lowConfidenceFields`, `confidence`, `requestId`.

`provenance` is not decoration. It drives the UI ("filled from your defaults"), the decision policy
(a value from the utterance is stronger than one from a profile default), the undo behavior, and the
correction metric. **Ship it from day one; retrofitting is painful.**

> **`provenance` and all other router metadata are siblings of `params`, never inside it.** The
> generation schema is `.strict()` and rejects unknown keys.

### 4.4 Response envelope — forward compatibility bought cheaply

`{ catalogVersion, passthrough, actions: [ResolvedAction], requestId }`

`actions` is **a list from day one**, with the documented contract: *Phase 1 clients execute
`actions[0]` and ignore the rest.* When compound requests arrive in Phase 4 the wire format already
supports them. Cost: one array literal. Saving: a breaking change.

### 4.5 Extensibility rules

1. Action IDs are permanent. Never rename, never reuse.
2. Slots are additive. New required slots ⇒ `version` bump ⇒ old clients degrade to `prefill`.
3. Both sides tolerate unknown IDs.
4. `effect` may only become *more* restrictive without explicit review.
5. Deprecate via `status`, never by deletion — cached catalogs exist in the wild.
6. **Adding an action touches exactly four things:** a descriptor, a schema, a client handler, and
   ≥10 eval cases. *If it touches the router core, the abstraction is wrong — stop and fix the core.*

---

## 5. Confidence and the decision policy

### 5.1 Signals — only one comes from the model

`intentConfidence` (model, ordinal) · `margin` (top-1 vs top-2) · `slotCompleteness`
(deterministic) · `slotProvenance` (deterministic) · `effect` (registry) · `contradiction`
(deterministic) · `historicalAccuracy` (telemetry).

### 5.2 The policy

**Rule 0 — effect dominates confidence.** Applied before anything else:

| `effect` | Maximum permitted decision, at *any* confidence |
|---|---|
| `read` | `execute` — navigate/search; reversible and visible |
| `draft` | `prefill` in Phase 1; `execute` only with `autoExecute` + high confidence + all required slots from utterance/memory |
| `write` | `prefill` + explicit user commit. Never auto |
| `destructive` | **`prefill` at most.** May navigate to the object; never pre-arm, never confirm on the user's behalf |

Within that ceiling:

```
contradiction                        → ask (present both readings)
intent unknown / coach_question      → passthrough
confidence low                       → passthrough        [CHANGE-4]
confidence medium and margin close   → passthrough        [CHANGE-4]
exactly ONE required slot missing    → ask (chip options)
two or more required slots missing   → prefill (the FORM is the question)
otherwise                            → ceiling decision
```

Note the asymmetry in the last two lines — counter-intuitive but correct: **more missing information
means fewer questions, not more.** One gap is a quick chip; several gaps means the teacher needs to
see the whole form.

`[CHANGE-4]` **The `suggest` decision is deferred to Phase 2.** With only two actions it can offer
nothing more useful than "generate an assessment" vs "open the generator" — a distinction of almost
no value, costing a UI component, a policy branch, wire surface and test cases. **The enum value
stays defined in the contract** so Phase 2 is additive rather than breaking.

`[CHANGE-3]` **A chip answer to an `ask` resolves client-side.** The client already holds the full
params from the first response; selecting a chip fills one enum slot. Re-calling the server would be
a network round trip and a second LLM call to learn something the app already knows. Only a
**free-text** answer requires re-interpretation. This halves the cost and latency of the `ask` path
and removes a failure mode.

### 5.3 Tuning honestly — instrument the correction signal

Model confidence will not tell you whether the router is good. These will:

| Metric | Meaning | Target |
|---|---|---|
| **Field-edit rate** | % of prefilled fields changed before generating | < 20% |
| Field-edit rate by provenance | *Which source* is wrong | diagnostic |
| Abandon rate | Routed, then navigated away without acting | < 15% |
| Passthrough-regret rate | Fell back to Coach, then did the action manually within 2 min | < 10% |
| Correction loop | Immediately re-typed a near-identical utterance | < 5% |
| Ask-answer rate | Clarifying questions answered vs abandoned | > 70% |

A router that is 95% "confident" with a 60% field-edit rate is a bad router. **Ship the metrics
before the feature.**

---

## 6. Conversation memory

**Yes, follow-ups reuse previous answers. No, do not keep a chat transcript.**

### 6.1 A typed slot store, not a message log

Each slot holds a canonical value, the raw phrase, its source, the turn, and an expiry.

| | Transcript | Slot store |
|---|---|---|
| Token cost | Grows every turn | Constant, tiny |
| Determinism | Re-inferred each turn | Fixed once resolved |
| **Inspectability** | Opaque to the teacher | Renderable as chips |
| **Correctability** | Argue with a model | Tap to change |
| Privacy | Full free text retained | Bounded, typed, expirable |

Inspectability is decisive. Teachers will correct the router constantly in year one; a slot store
lets them do it with a tap. The surface already exists — `ContextBar` on the Coach page renders
exactly this shape today.

### 6.2 Tiers

| Tier | Lifetime | Storage |
|---|---|---|
| Turn | One request | Request body |
| Session | Tab session / 60 min idle | React context + `sessionStorage` |
| Durable | Across devices | `User.preferences` (**already exists**) |

Phase 1 keeps the **server stateless** — the client sends the slot store with each call, exactly as
`CoachPage` sends `context` with each `/coach` call. No new tables (respecting the SQLite
constraint), comprehensible multi-tab behavior. Server-side memory later is *additive*, because the
wire contract already carries the context.

### 6.3 Rules

1. **Explicit beats remembered** — an utterance value overwrites; no merge.
2. **Per-slot TTL by volatility.** `grade`/`subject` ≈ session; `topic` ≈ 2 turns (a stale topic is
   worse than none — it produces a confident, wrong worksheet); `format` ≈ 3 turns.
3. **Memory never satisfies a required slot for `write`/`destructive`.**
4. **Explicit reset** — "New chat" clears it (`CoachPage.handleNewChat` is the natural hook).
5. **Memory is never an LLM input as raw text** — resolved slots enter the prompt as a structured
   trusted block; the utterance stays delimited untrusted content.
6. **Sensitive slots are never persisted or cached.**

---

## 7. Navigation model

| Effect | Behavior | Rationale |
|---|---|---|
| `read` | **Navigate immediately** + toast with Undo | Reversible and visible; a confirm here is friction with no safety value |
| `draft` | **Navigate + prefill, do not submit** | Generation costs money and time; the teacher reviews first |
| `write` | Navigate + prefill + commit via the module's own button | The module's save path stays the single write path |
| `destructive` | Navigate to the object; **never pre-arm** | The existing confirm is the human gate |

**Rules**

1. **Never destroy unsaved work.** `ResourceWorkspace` has a dirty guard; router navigation must go
   *through* it, not around it. This is the most damaging possible early bug — a teacher who loses
   20 minutes of editing will not use the feature again.
2. **The model never returns a path.** `actionId` → handler map → navigate. The reachable route set
   is a compile-time constant.
3. **Every AI navigation is a real router navigation** — back button works, deep links work.
4. **Prefill travels by handle, not by URL.** Write params to a client draft store, navigate to
   `/generator?ai=<draftId>`. Refresh and back/forward work; the teacher's topic never enters the
   URL, history, referrer headers, or server logs.
5. **Always show what happened** — a dismissible banner with Undo on every routed landing.
6. **Cross-module navigation preserves nothing implicitly.** The target receives an explicit params
   object and never reads router state.

**On "preview vs navigate":** a confirmation step before navigating for `read`/`draft` is the
intuitive safe choice and is **rejected**. It doubles the happy path's interaction cost to guard an
outcome — landing on the right page with one wrong field — that is already visible and one tap from
fixed. **The prefilled destination is the preview.**

---

## 8. Phase 1 — the Generator

### 8.1 Slot model against the real contract

`generateSchema` is `.strict()` and requires `format`, `topic`, `difficulty`, `questionType`,
`questionCount`. The current UI hides this by holding defaults in React state; **those defaults move
into the registry** so both paths read one source.

| Slot | Required by API | Default source | Extraction difficulty |
|---|---|---|---|
| `format` | ✅ | — (must ask) | Easy — strong lexical signal |
| `topic` | ✅ | — (must ask) | Medium — boundary detection |
| `difficulty` | ✅ | `medium` | Easy, rarely stated |
| `questionType` | ✅ | `mcq` | Easy, rarely stated |
| `questionCount` | ✅ | `10` | Easy — a number near "questions" |
| `grade` | optional | memory → `prefs.defaultGrade` | **Hard — canonicalization** |
| `subject` | optional | memory → `prefs.defaultSubject` | Medium |
| `language` | optional | `prefs.defaultLanguage` | **Trap — see 8.3** |

**Only `format` and `topic` genuinely require a human.** That makes the Phase 1 policy simple:

```
format + topic, high confidence → prefill Generator with all 8 fields
format, missing topic           → ask "What topic?"        (free text)
topic, missing format           → ask "Quiz or worksheet?" (2 chips)
missing both                    → prefill empty (today's behavior + a nudge)
low confidence / unknown        → passthrough to Coach
```

### 8.2 Grade canonicalization — deterministic, not the model's job

The vocabulary is *ranges* (`Class 3-5`); teachers say *"Class 5"*. Three outcomes:

- **Confident** → canonical value, provenance `utterance`.
- **Ambiguous** (`"class 5-6"`, `"primary"`) → prefill the teacher's **raw string** and flag the
  field low-confidence. Safe because the field is free text with a `datalist`, and more honest than
  a wrong guess.
- **Unmapped** → `prefs.defaultGrade`, provenance `profile`, visibly labelled.

### 8.3 The language trap

**The language a teacher types in is not necessarily the language they want output in.** A Hinglish
request very often wants an *English* worksheet, because the printed paper follows an
English-medium syllabus.

**Rule: set `language` only from an explicit statement** ("in Hindi", "हिंदी में", "Hindi mein").
Otherwise use the profile default. **Never infer output language from input script.** Getting this
wrong produces a wrong-language printed worksheet — the most visible possible failure.

### 8.4 Graduating to auto-generation

Only when **all** hold: field-edit rate < 15% sustained over 2 weeks across ≥500 real routings; a
per-teacher opt-in exists; one-tap "regenerate with different settings" exists; generation cost per
teacher per day is capped. Then flip `autoExecute: true` — **one field.** That is what the design is
for.

---

## 9. Failure handling

| Failure | Behavior | Teacher sees |
|---|---|---|
| Unknown intent | Passthrough | A normal coaching answer |
| Low confidence | Passthrough `[CHANGE-4]` | A normal coaching answer |
| Partial info | 1 gap → `ask`; 2+ → `prefill` | A chip question, or a mostly-filled form |
| **Contradictory** | `ask` with **both** readings | "Class 5 or Class 8?" — **never silently pick one** |
| Unknown action ID | Passthrough, logged | Nothing |
| Invalid params | Drop bad slots, downgrade to `prefill` | Form with fewer fields filled |
| Classifier timeout | **A decision, not an error** — passthrough | A normal answer, ~1 s later |
| Safety block | Passthrough | Existing Coach handling |
| Router 5xx | Passthrough; breaker opens 60 s | Normal app |
| Downstream failure (`/generate` 502) | **Untouched** — existing module handling | Existing generator error |
| Rate limit / budget | Passthrough | Normal app |
| **Upstream 429 storm** | `[CHANGE-8]` **Global breaker: router Gemini calls disable for M minutes; `/coach` unaffected** | Coaching keeps working |
| Emergency detected | **Bypass the router entirely** | The existing emergency response |

Three principles: every failure degrades to a working application; the router is never in the
critical path of an action that has begun; **contradiction is never resolved by guessing** — a wrong
guess produces a *plausible-looking wrong worksheet*, which may not be noticed until it is printed.

---

## 10. Security

### 10.1 Threat model

| # | Threat | Severity | Control |
|---|---|---|---|
| 1 | Prompt injection via stored resource content | **Critical** | Effect registry-declared; destructive structurally unreachable |
| 2 | Privilege escalation via action ID | **Critical** | Catalog role-filtered **before** prompt construction; re-checked after |
| 3 | Cross-tenant reference resolution | High | Model returns criteria, never IDs; existing `findOwned` 404s |
| 4 | Cost / DoS | High | Rate limits, per-user budget, `[CHANGE-8]` breaker |
| 5 | Data exfiltration via crafted utterance | Medium | Responses carry only IDs and validated params |
| 6 | Free text in logs/URLs | Medium | Draft handles; metadata-only telemetry |
| 7 | Confused deputy | Medium | No router endpoint mutates; it only resolves |

### 10.2 Destructive actions — structurally impossible

> **No LLM output, at any confidence, may cause deletion, overwrite, or irreversible state change.
> The router may navigate a human to the control. The human presses it.**

This matters concretely: the app already feeds saved resource content to Gemini in `ai-action`. If
effect class were ever model-decided, a resource containing an instruction would become a live
exploit. Registry-declared effect means that attack **has nowhere to land**, regardless of
classifier quality.

**Overwrite is worse than delete** because it is silent — a wrongly-overwritten resource looks fine
until opened. Router-driven `PATCH` is out of scope indefinitely.

### 10.3 Permissions

1. Catalog filtered by role **before** the prompt is built — defense in depth *and* a cheaper prompt.
2. Filtered again after classification.
3. Execution always goes through the **existing** route with its existing guards. **The router never
   re-implements an authorization check** — re-implementation is where the bypass eventually appears.

### 10.4 Rate limiting and budget

- `/api/assistant/interpret`: dedicated limiter + per-user daily budget.
- **Add a limiter to `/api/resources/generate` regardless of this project** — it currently has none,
  a pre-existing gap this feature would amplify.
- `[CHANGE-8]` Global router breaker on upstream 429s. **When the upstream is constrained, coaching
  wins.**

### 10.5 Audit

Reuse the existing `Event` model — no new table. Metadata only: request ID, action, decision,
confidence, latency. **Never the utterance text**, matching the existing logging discipline.

---

## 11. Roadmap

| Phase | Actions | New core work | Risk |
|---|---|---|---|
| 1 | `generate_assessment`, `open_generator` | Registry, classifier, resolver, policy, executor, prefill | Medium |
| 2 | Library / Workspace | **Reference resolution** — criteria → owned rows | Medium |
| 3 | Coach / lesson planning | Router+Coach merged into one turn endpoint | Medium |
| 4 | Multi-step | **Plan execution**, ≤3 steps, per-step confirm | **High** |
| 5 | Attendance / grading | **Idempotency, transactions, undo log** | **High** |

**Extends for free:** descriptors + schemas + handlers + evals. The prompt is generated from the
registry; the policy is effect-driven, so a new `read` action inherits correct behavior on day one.

**Does not extend for free:** reference resolution (Phase 2, ~1 week, slots in cleanly as a
post-classification step); multi-step plans (Phase 4, a different execution model — do not attempt
before Phase 3 is stable); true write actions (Phase 5, its own project that *uses* this
architecture rather than extending it).

**Sequencing rules:** never add an action while the previous phase's field-edit rate is above target;
every action ships with ≥10 eval cases including ≥3 Hinglish and ≥2 adversarial; every phase is
independently killable behind a flag.

---

## 12. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Registry becomes a second implementation of module rules | High | **Severe** | `paramSchema` by reference; enforce the four-artifact rule |
| 2 | Hinglish / multilingual classification quality | High | High | Ordinal confidence, low thresholds, Coach fallback, stratified evals |
| 3 | Latency makes it feel slower than clicking | High | High | `[CHANGE-2]` precision gate; fast model; 5 s cap → passthrough |
| 4 | Invisible product | High | High | Registry `examples` drive visible chips; provenance banner teaches the mapping |
| 5 | Cost blow-up | Medium | High | Budget, caching, gate, limiter on `/generate` |
| 6 | Data loss from AI navigation over unsaved edits | Medium | **Severe (trust)** | Route through the existing dirty guard; test first |
| 7 | Prompt injection via stored content | Medium | Critical | Registry-declared effect |
| 8 | **Demo-driven overconfidence** | **Very high** | High | Eval set built from real teacher language **before** the first demo |
| 9 | Wrong-but-plausible output | Medium | High | Never guess contradictions; provenance indicators |
| 10 | Router coupling creeps into modules | Medium | High | One-way dependency; deletability verified |

Risk 8 is the one that actually kills these projects.

---

## 13. Open question

Whether the intent gate can reach acceptable precision on code-mixed Hinglish without an
unacceptable latency cost or miss rate. `[CHANGE-2]` chooses precision and accepts the miss rate,
which is the right risk posture, but it is a bet.

**The eval corpus at M7 settles it, and that is the correct moment to reconsider whether Phase 2
should proceed at all.** If intent precision on Hinglish lands below ~85%, the honest response is to
keep Phase 1 narrow and invest in structured entry points — chips and a command palette — rather
than widening the classifier's remit.
