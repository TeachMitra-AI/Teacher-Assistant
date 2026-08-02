# AI Action Router — Implementation Guardrails & Impact Analysis

**Status:** Approved · **Type:** Implementation contract, binding on all Phase 1 development
**Created:** 2026-07-27 · **Last amended:** 2026-07-28 (M0)

> **Companion documents**
> - [`ai-action-router-architecture.md`](./ai-action-router-architecture.md) — *why*
> - [`ai-action-router-phase1-spec.md`](./ai-action-router-phase1-spec.md) — *what to build*
> - [`AI_ACTION_ROUTER_README.md`](./AI_ACTION_ROUTER_README.md) — **living project state**
> - [`ai-action-router-security-review.md`](./ai-action-router-security-review.md) — **the M9 review that executes Parts 3, 4 and 6 of this document as an attack**

This document identifies everything developers must **not** break. Where it conflicts with the other
two documents, **this one wins** — and the other document should be corrected.

---

## Part 1 — Impact analysis

**Legend:** *None* — file not opened · *Consumed* — used as-is · *Additive* — new code alongside ·
*Modified* — existing lines change · *Refactor* — code moves, behavior identical.

| # | Module | Impact | Files | Why | Size | Risk |
|---|---|---|---|---|---|---|
| 1 | **Authentication** | Consumed | `middleware/auth.js`, `routes/auth.js`, `auth.tsx` | New endpoints use `authRequired`; client uses the existing `api()` wrapper, inheriting 401 refresh | 0 | **Low** |
| 2 | **Authorization / RBAC** | Consumed + new read | `middleware/auth.js`, descriptors | Registry filters by `requiredRoles`; execution still uses existing guards | 0 changed | **Medium** — role constants now in a third place |
| 3 | **Coach (backend)** | None | `POST /api/coach` | Router never calls it; the client calls it directly on passthrough | 0 | **Low** |
| 4 | **Coach (frontend)** | Modified | `pages/CoachPage.tsx` | Submission pre-pass; clarify chips | ~40 lines | **High** |
| 5 | **Generator (frontend)** | Modified | `pages/GeneratorPage.tsx` | Mount-time seeding, banner, provenance, undo | ~60 lines | **Medium-High** |
| 6 | **Generator (backend)** | Refactor | `routes/resources.js` | `generateSchema` moves out | ~15 lines | **Medium** — *the* generation contract |
| 7 | **Library** | None | `LibraryPage`, `ResourceView`, CRUD | Out of scope | 0 | **Low** |
| 8 | **Workspace** | None | `ResourceWorkspace` | Out of scope; dirty guard never reached in Phase 1 | 0 | **Low** |
| 9 | **AI Assist** | None | `/resources/:id/ai-action` | Untouched; shares `app.locals.gemini` with the new instance | 0 | **Low-Medium** |
| 10 | **Resource APIs** | Refactor + 1 limiter | `routes/resources.js`, `index.js` | Schema import; limiter on `/generate` only | ~3 lines | **Medium** |
| 11 | **Gemini integration** | None (file) / Additive (usage) | `gemini.js` unchanged; new `geminiFast` | Routing needs 5 s, not 60 s | 0 in `gemini.js` | **Medium** — shared quota |
| 12 | **Prisma** | None | `schema.prisma`, `migrations/` | **Zero migrations** | 0 | **Low** |
| 13 | **Database** | New rows, existing table | `Event` | Telemetry — volume is the concern, not schema | 0 schema | **Medium-High** |
| 14 | **Routing (client)** | None (routes) / Additive (providers) | `App.tsx` | No new routes; one provider added | ~2 lines | **Low** |
| 15 | **Admin** | None | `AdminPage`, `ManagePage`, `routes/admin.js` | No admin action in Phase 1 | 0 | **Low** |
| 16 | **Onboarding** | None (code) / Collides (UI) | `OnboardingTip`, `useOnboardingTip` | `generator-intro` tip occupies the banner's region | 0 code | **Medium** |
| 17 | **Existing React state** | Additive | new `RouterProvider` | No state manager introduced | 1 provider | **Low-Medium** |
| 18 | **Safety guards** | Consumed | `safety/*` | `normalizeQuery`, `detectEmergency` reused verbatim | 0 | **Low** — must not be edited |
| 19 | **Rate limiting** | Additive + 1 new application | `index.js` | New assistant limiter; existing limiter now also on `/generate` | ~10 lines | **Medium** |
| 20 | **Teacher preferences** | Read-only (server) | `User.preferences` | Resolver reads defaults server-side | 0 | **Low** |
| 21 | **Backend services** | None | `lib/*`, `seed.js` | No reason to touch | 0 | **Low** |
| 22 | **CI/CD** | Modified (conditional) | `.github/workflows/ci.yml` | Only if a client test runner is added | ~6 lines | **Low** |
| 23 | **PWA / service worker** | None (config) / Impacts rollback | `vite.config.ts` | App-shell caching delays client-side flag changes | 0 | **Medium-High** |
| 24 | **Print flow** | None | `ExamHeader`, print modes | Downstream of generation | 0 | **Low** |

### The four highest-risk entries

**#4 Coach frontend (High).** The most-used code path in the product, and the change sits in the
submit handler. A bug here does not degrade the router — it breaks the *app*. Every failure mode must
terminate in "call `/coach` exactly as today." **Treat this diff as the most scrutinized in the
project.**

**#13 Database (Medium-High).** Schema untouched, so the naive reading is "no risk." The real risk is
write volume: `Event` receives rows only for safety flags and notable incidents today — rare by
design. One row per interpret call converts it into a sustained stream on **single-writer SQLite**
serving every authenticated request. The failure appears later as intermittent contention that looks
like general slowness. → CHANGE-6.

**#23 PWA (Medium-High).** `registerType: 'autoUpdate'` means an updated bundle activates on a
*subsequent* load. Installed-PWA users may hold a stale client for an unpredictable interval.
Consequences: client-side flags are **not** an incident control; stale clients seeing a newer catalog
is an everyday occurrence, retroactively justifying `catalogVersion` and unknown-ID tolerance.

**#6/#10 Resource APIs (Medium).** `generateSchema` is `.strict()` and is the contract for the app's
most valuable endpoint. Moving it is low-risk *if* it is moved. Copied, drift begins immediately.

---

## Part 2 — Protected areas

| # | Area | Why | Detection |
|---|---|---|---|
| 1 | **Generator generation flow** — `handleGenerate`, `generateAssessment()`, `POST /resources/generate` | This is the product. A routing bug must not become a generation bug for teachers who never use AI | `lib/resources.ts` diff empty; `resources.test.js` unmodified |
| 2 | **Deterministic rendering** — `renderAssessmentMarkdown`, `renderAssessmentBody`, `assessmentSchema.js` | The strongest AI-safety property: model supplies content, app supplies structure | Diff empty |
| 3 | **Resource saving** — `POST /api/resources`, `handleSave` | The router must never write to a library | Diff empty; no router code references `createResource` |
| 4 | **Library** | Out of scope | Diff empty |
| 5 | **Workspace editing** + dirty guard | Out of scope; the guard protects unsaved teacher work | Diff empty |
| 6 | **Authentication** | Correctness is binary and unrelated to this feature | Diff empty; 4 auth suites unmodified |
| 7 | **Authorization** — `requireRole`, `findOwned`, school scoping | Re-implementing a check is where a bypass appears | `rbac.test.js`, `tenant-isolation.test.js` unmodified |
| 8 | **Coach API** | Every router failure terminates here | Diff empty; `coach.reliability.test.js` unmodified |
| 9 | **Database schema** | A migration turns a reversible feature irreversible | Zero migration folders |
| 10 | **`gemini.js`** | Editing a service shared by three consumers risks all three | Diff empty; both gemini suites unmodified |
| 11 | **Safety guards + `prompts.js`** | Consumed, never adjusted. The emergency path must not gain latency | Diff empty; `ai-safety.test.js`, `prompts.test.js` unmodified |
| 12 | **Existing test files** | They are the proof that protected areas stayed protected | `git diff --stat server/test/` shows only additions |
| 13 | **Provider stack order in `App.tsx`** | Ordering is load-bearing for existing behavior | Diff shows insertion only |
| 14 | **Every page except Coach and Generator** | Nine pages have no business changing | `git diff --stat client/src/pages/` lists exactly two |

---

## Part 3 — Implementation guardrails

Mandatory. Numbered for citation in review. A PR violating any of these does not merge.

### Schema and validation

- **G1.** Never duplicate a validation schema. `generateSchema` has exactly one definition.
- **G2.** Never validate router params with anything other than the schema the endpoint uses.
- **G3.** Never place router metadata (`provenance`, `confidence`, `requestId`) inside `params` — the
  schema is `.strict()`.
- **G4.** Never trust a model-supplied action ID. Re-verify catalog membership after parsing, every
  request, regardless of `responseSchema` constraints.
- **G5.** Never canonicalize a controlled vocabulary in a prompt.

### Authorization and safety

- **G6.** Never bypass, wrap, or re-implement an existing authorization check.
- **G7.** Never expose `paramSchema`, `requiredRoles`, or `featureFlag` in a catalog response.
- **G8.** Never allow AI output to trigger a write, update, or delete.
- **G9.** Never register an action with `effect` above `draft` or `autoExecute: true`. Enforced at
  startup, not by convention.
- **G10.** Never run the classifier on an emergency-flagged utterance.
- **G11.** Never log, persist, or transmit utterance text or resolved slot values.
- **G12.** Never place teacher-authored text in a URL, query string, or route parameter.

### Coupling and structure

- **G13.** Never import feature-module code into `assistant/` or `actions/`.
- **G14.** Never make a page component consume `RouterProvider`. `GeneratorPage` imports exactly one
  function and must render correctly with the provider absent.
- **G15.** Never let `actions/` import from `assistant/`.
- **G16.** Never allow an AI-navigation route string outside `assistant/handlers/`.
- **G17.** Never add a client runtime dependency without a budget justification.

### Data and infrastructure

- **G18.** Never create a database migration in Phase 1.
- **G19.** Never write telemetry on the hot path without a volume analysis.
- **G20.** Never reuse `app.locals.gemini` for classification.
- **G21.** Never modify `gemini.js`. If a change seems necessary, the design has drifted — escalate.

### Behavior and compatibility

- **G22.** Never return a 5xx from `/api/assistant/interpret`.
- **G23.** Never introduce a breaking change to an existing API contract.
- **G24.** Never make an existing capability reachable *only* through the router.
- **G25.** Never generate, save, or navigate destructively without an explicit human click.
- **G26.** Never modify an existing test to make new code pass.
- **G27.** Never ship a milestone with a feature flag defaulting to on.
- **G28.** Never leave the client as the only control for disabling the feature — the service worker
  makes it unreliable.

---

## Part 4 — Architectural invariants

| # | Invariant | Verification |
|---|---|---|
| I1 | The router is **additive** | Flags off ⇒ zero assistant requests; behavior identical |
| I2 | Every capability remains reachable **without AI** | Manual script with flags off, green |
| I3 | AI **never executes an effect** | No router path reaches a POST/PATCH/DELETE except telemetry |
| I4 | The application owns the catalog; the model owns nothing | Fabricated-ID test yields passthrough |
| I5 | **Effect class is registry-declared** | Startup validation; policy tests at all confidences |
| I6 | The Coach is the **universal fallback** | All passthrough reasons produce a Coach answer |
| I7 | Existing API contracts are **backward compatible** | Existing suites unmodified and green |
| I8 | The feature is **deletable** | ✅ **Performed at M9** (2026-07-29), in a throwaway worktree with nothing committed. The deleted build boots, both assistant endpoints 404, the server suite returns **18 files / 413 tests** and the client bundle returns **`index-B4SBMDAV.js` at 276.32 kB gzip** — the exact pre-feature test count and bundle *hash* recorded at M0. See [`ai-action-router-security-review.md`](./ai-action-router-security-review.md) §5 |
| I9 | **Zero persistent state depends on the router** | Rollback creates no orphans |
| I10 | **One definition per contract** | Grep audit at each merge checkpoint |
| I11 | **Failure is invisible** | Failure matrix fully covered |
| I12 | The router **yields to the Coach** under pressure | Global 429 breaker (CHANGE-8) |

---

## Part 5 — Regression checklist

Run after **every** milestone, including server-only ones.

**Automated:** server suite green with **zero modifications to existing test files** · suite run 3×
with no intermittent failures · both packages lint · client builds · bundle size within budget · CI
green including the gitleaks scan.

**Coach:** sign in, ask, receive · language selector · context bar · follow-up chips (suffix +
translate) · thumbs up/down · history load/select/delete/clear · new chat resets · voice input · with
flags off, **no** assistant request in a network trace.

**Generator (manual flow):** `/generator` direct with no parameter · defaults are Quiz/medium/MCQ/10/
English · generate with topic only · preview + math rendering · edit tab · regenerate warning · exam
header editor · Save → Workspace · **both** quiz and worksheet produce a correct answer key.

**Library & Workspace:** list, filter, search, delete with confirm · resource view · workspace load/
edit/save · AI Assist suggest + apply · unsaved-changes guard on navigate and tab close · print in
all three modes.

**Auth & RBAC:** email+password · Google (if configured) · registration → pending cannot sign in ·
password reset · token refresh after idle · teacher blocked from `/admin` · admin approve/reject ·
cross-teacher resource returns 404.

**Cross-cutting:** theme toggle · font scaling · mobile viewport · onboarding intro and tips · PWA
install and service-worker update after redeploy.

**Router-specific (M3+):** flags off ⇒ no behavioral difference · prefill values and markers correct
· refresh re-applies · undo restores defaults and cleans the URL · manual edit clears its marker ·
**second routing while already on `/generator` applies the new draft (CHANGE-7)** · stale response
does not navigate (CHANGE-9) · sessionStorage disabled ⇒ empty form, no crash · backend down ⇒ Coach
still works · kill switch mid-session.

---

## Part 6 — Code review checklist

### Blocking

1. Does this PR touch a Part 2 protected file? Why, and who approved it?
2. Does it modify an existing test file? (G26)
3. Does it add a Prisma migration? (G18)
4. Does it edit `gemini.js`, `prompts.js`, or a safety guard? (G21)
5. Does it introduce a second definition of a schema, vocabulary, or role list? (G1)
6. Can any path return a 5xx from `/interpret`? (G22)
7. Does a catalog response include `paramSchema` / `requiredRoles` / `featureFlag`? (G7)
8. Does any log, `Event`, or URL contain teacher text? (G11, G12)
9. Does any flag default to on? (G27)
10. Does any descriptor have `autoExecute: true` or `effect` above `draft`? (G9)

### Structural

11. Does `assistant/` import a feature module, or `actions/` import `assistant/`? (G13, G15)
12. Does a page component consume `RouterProvider`? (G14)
13. Do AI route strings appear outside `assistant/handlers/`? (G16)
14. Does the classifier use `geminiFast`? (G20)
15. Is router metadata inside `params`? (G3)
16. Is a model-supplied identifier used without catalog re-verification? (G4)

### Behavioral

17. With flags off, is this path provably unreachable?
18. If this fails at runtime, does the teacher get a normal Coach answer — or an error?
19. Does deleting `assistant/` + `actions/` still restore previous behavior?
20. Is every new failure mode covered by a test asserting the *degraded* outcome?
21. Does this alter perceived latency for teachers not using the router?

### Quality

22. Is there a test for the failure case, not only the happy path?
23. Are new client modules pure enough to test without a DOM?
24. Does new UI match existing accessibility conventions? (CHANGE-12)
25. Does the client bundle grow? By how much?
26. If this adds an action, did it touch **only** the four permitted artifacts?

---

## Part 7 — Rollback plan (failure after M4)

### State after M4

Merged: M0 contracts · M1 schema extraction · M2 registry + catalog · M3 client prefill · M4 pure
modules. **Not built:** classifier, `/interpret`, client wiring, telemetry writes.

| Surface | Reachable? | Behavior |
|---|---|---|
| `GET /catalog` | Yes | Empty catalog (flags off) |
| Generator prefill code | Yes, inert | No handle can exist — nothing writes drafts |
| `/interpret` | Does not exist | — |
| Telemetry | None | No `Event` rows created |
| Database | Unchanged | No migrations, no rows |

**This is the cleanest possible failure point** — which is why M4 sits where it does.

### Containment (<60 s)

Confirm `ASSISTANT_ENABLED=false` and restart. **No user is affected because no user-visible behavior
was enabled.**

### Git revert sequence

Revert M4 → M3 → M2. **Do not revert M1** unless you want to — the schema extraction is a standalone
improvement with no dependencies.

### Partial-keep option (recommended over full revert)

If the project is dropped for priority reasons rather than defectiveness, keep **M1 and M2**: M1 is a
pure improvement; M2 is an inert, flag-gated registry that is the foundation for a non-AI command
palette. Revert only M3 and M4. This preserves the durable asset and discards the speculative part.

### Database

**No action required.** No migrations, no rows, no schema change. At every milestone the database
rollback plan is "there isn't one, and that is correct."

### Data loss

**None possible.** The router creates no data anything else reads. Drafts die with the tab.

### Deployment and the PWA caveat

| Layer | Mechanism | Realistic time |
|---|---|---|
| Server flag | Env + restart | **< 60 s** |
| Server code | Redeploy | ~5–10 min |
| Client build | Static redeploy | **Propagation not deterministic** |

**Consequences, to be internalized before coding:**

1. **The server kill switch is the only real incident control.**
2. Any rollback plan starting with "redeploy the client" is not a rollback plan.
3. Every server change must stay compatible with the previously deployed client for ≥1 release.
4. **Remove `/interpret` from the client before removing it from the server, never the reverse** —
   and leave the server endpoint returning inert passthrough for one release after.

---

## Part 8 — Technical debt prevention

| # | Shortcut | Why tempting | Why it must not happen |
|---|---|---|---|
| 1 | **Copy the schema instead of moving it** | Moving touches a working file | Two definitions drift within weeks. *The* debt of this project |
| 2 | **Reuse `app.locals.gemini`** | Already constructed and works | 30 s timeout turns routing into a feature that appears to hang |
| 3 | **Hardcode grade mappings in the prompt** | One sentence vs a module and 40 tests | Untestable, unfixable without a prompt change, regresses silently on model updates |
| 4 | **Skip provenance, add later** | Looks like UI polish | It drives the policy, undo and the correction metric. Infrastructure, not polish |
| 5 | **Skip the eval corpus** | The demo works; deadlines are real | Every threshold set by anecdote; no way to tell if a change helped |
| 6 | **Log the utterance for debugging** | Much easier diagnosis | Privacy regression against an established discipline. "Temporarily" becomes permanent |
| 7 | **Put params in the URL** | Simpler; survives refresh free | Teacher content in history, referrer headers, access logs |
| 8 | **Auto-generate** | Demos beautifully | Spends money on unreviewed content; removes the review step that makes prefill safe |
| 9 | **`useRouter()` in `GeneratorPage`** | Looks cleaner | Breaks deletability; page unrenderable without the provider |
| 10 | **One `Event` row per interpret** | Simplest implementation | Sustained writes on single-writer SQLite (CHANGE-6) |
| 11 | **Skip client tests — no runner** | "Out of scope" | Draft store has quota, corrupt-JSON, TTL and eviction cases guaranteed to occur |
| 12 | **Widen the gate for more phrasings** | Feels like progress | Adds latency to the common path (CHANGE-2) |
| 13 | **Add a feature "while we're in here"** | The file is open | Harder review, harder revert |
| 14 | **Throw on unknown action IDs** | "Can't happen" | It happens constantly with stale PWA clients. A throw is a blank screen |
| 15 | **Modify a fragile existing test** | It blocks the merge | Existing tests are the only proof protected areas held |
| 16 | **Inline `requiredRoles: ['teacher']`** | Readable | A fourth copy of role knowledge |

---

## Part 9 — Readiness review outcome

The final review re-examined the code and produced **four factual findings** and **12 binding
amendments**.

### Findings

| ID | Finding | Amendment |
|---|---|---|
| **A** | `preferencesSchema` (`routes/auth.js`) is `.strict()` — a persisted opt-out would require editing a protected file | CHANGE-1 |
| **B** | The client is a **PWA** with service-worker caching — client rollback is not deterministic in time | Rollback plan rewritten |
| **C** | React Router does **not** remount on search-param change — a mount-only draft read is a silent no-op | CHANGE-7 |
| **D** | `Event` is a rare-incident table; per-interpret writes add pressure to single-writer SQLite | CHANGE-6 |

### The 12 amendments

CHANGE-1 drop the persisted opt-out · CHANGE-2 gate for precision · CHANGE-3 chip answers resolve
client-side · CHANGE-4 defer `suggest` · CHANGE-5 defer the server cache · CHANGE-6 split telemetry ·
CHANGE-7 Generator reacts to param change · CHANGE-8 router yields to Coach · CHANGE-9 stale-response
guard · CHANGE-10 banner/tip stacking · CHANGE-11 document vocabulary duplication · CHANGE-12
accessibility.

**Two — CHANGE-7 and CHANGE-9 — are latent functional bugs**, not preferences. They would have
shipped, reached teachers, and been difficult to diagnose from a bug report.

**Net timeline effect: approximately neutral.** CHANGE-4 and CHANGE-5 remove about as much work as
the rest add.

### What survived review unchanged

Registry-before-router sequencing · effect class dominating confidence · prefill over conversational
slot-filling · passthrough-on-any-failure · zero migrations · M3 before M5 · the catalog endpoint
(seriously considered for cutting; the PWA finding reversed that — stale clients need a version
signal).

### Remaining weaknesses, stated honestly

**Scalability** — prompt size grows linearly with the catalog (negligible at 2 actions, ~2–3k tokens
at 20; cheap fix: cap examples per action). SQLite's single writer is the other ceiling; CHANGE-6
defers it without removing it.

**Maintainability** — role knowledge now sits in four places. CHANGE-11's cross-referencing helps but
does not solve it. **If a fifth appears, stop and consolidate.**

**Least confident** — whether the intent gate can reach acceptable precision on code-mixed Hinglish
without unacceptable latency or miss rate. CHANGE-2 chooses precision, which is the right risk
posture, but it is a bet. **The eval corpus at M7 settles it, and that is the correct moment to
reconsider whether Phase 2 proceeds.** If Hinglish intent precision lands below ~85%, keep Phase 1
narrow and invest in structured entry points instead of widening the classifier's remit.

---

## Things that absolutely must not change

**Backend** — `POST /api/resources/generate` contract · `renderAssessmentMarkdown` /
`renderAssessmentBody` · `gemini.js` · `prompts.js` and both safety guards · `middleware/auth.js` and
every existing authz check · `prisma/schema.prisma` (**zero migrations**) · `/api/coach` ·
ownership semantics (`findOwned`, 404-for-not-yours).

**Frontend** — `lib/resources.ts` (especially `generateAssessment()`) · the Generator's
generate/preview/save flow · `api.ts` · `auth.tsx` · `App.tsx` route table and provider order · every
page except Coach and Generator.

**Behavioral** — every action reachable without the router, forever · nothing generates or saves
without an explicit human click · the Coach is always the fallback · flags off ⇒ zero behavioral
difference, verifiable by network trace.

> If any of these turns out to be genuinely blocking during implementation, that is a signal to stop
> and revisit the architecture — **not** to make the change. Each is load-bearing for safety,
> rollback, or the ability to add Phase 2 without a rewrite.
