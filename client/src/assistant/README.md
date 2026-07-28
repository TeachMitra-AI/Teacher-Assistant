# `client/src/assistant/` — AI Action Router (client)

**Scaffolded in M0 (`types.ts`). Draft store, prefill and telemetry landed in M3. Gate, cache,
memory, breaker, catalog, provider, executor and handlers landed in M6.**

> ⚠️ **This folder became reachable from production at M6** — but only when `VITE_ASSISTANT_ENABLED`
> is `true`, which it is not by default. With the flag unset, `submit()` returns a passthrough before
> touching the gate, storage or the network, and the composer behaves exactly as it did before the
> feature existed.

Everything the AI Action Router does on the client lives here. The folder is designed to be a
**deletable unit**: removing it, the two `Ai*` components, and reverting a handful of small edits
must return the application to exactly its previous behaviour. That is verified as a merge
checkpoint, not assumed.

## Layout

| Path | Responsibility | Milestone |
|---|---|---|
| `types.ts` | Frozen wire contracts. Types only — compiles away, zero bundle cost | **M0** |
| `draftStore.ts` | sessionStorage-backed prefill drafts: TTL, eviction, **fail-soft** | **M3** |
| `generatorPrefill.ts` | The Generator's single seam into the router: coerce a draft into typed form values, record what the teacher does with them | **M3** |
| `telemetry.ts` | Correction signal — field name + provenance, **never values**. Buffered until M8 adds transport | **M3** |
| `api.ts` | Thin typed wrappers over the existing `api()`, plus the 6 s client deadline | **M6** ✅ |
| `RouterProvider.tsx` | Session memory, pending clarification, circuit breaker, catalog version, sequence counter. **The only stateful module here** | **M6** ✅ |
| `ActionExecutor.ts` | Dispatch by action id; `execute`→`prefill` downgrade; graceful unknown-id fallback. **Contains no action-specific branching** | **M6** ✅ |
| `handlers/` | One per action, plus `index.ts` (the registration point), `routes.ts` and `types.ts`. **The only place AI-navigation route strings appear** | **M6** ✅ |
| `sessionMemory.ts` | Typed slot store. **Applies no TTL** — see rule 9 | **M6** ✅ |
| `intentGate.ts` | Precision-first "does this look like a command?" filter. Pure, no network | **M6** ✅ |
| `repeatCache.ts` | Normalized-utterance → resolved action cache, keyed by catalog version | **M6** ✅ |
| `circuitBreaker.ts` | 60 s open/closed state machine, injectable clock | **M6** ✅ |
| `pendingAsk.ts` | Client-side completion of a clarifying question (CHANGE-3). Synchronous by construction | **M6** ✅ |
| `catalog.ts` | Lazy fetch, cache, version invalidation, `domain` lookup for the unknown-id fallback | **M6** ✅ |

## Tests

`*.test.ts` beside each module, run by `npm test` in `client/` (vitest + jsdom, added in M3).
**Pure-logic modules only — no component rendering.** The draft store's quota, corrupt-JSON, TTL and
eviction paths are all guaranteed to occur on the target devices and all cheap to test; component
behaviour is covered by the manual script instead. See the spec §10.3.

## Rules

1. **Pages must not consume `RouterProvider`.** `GeneratorPage` must render correctly with the
   provider absent. Wiring `useRouter()` into a page breaks the deletability property and couples a
   working page to new code.

   Its whole coupling to this folder is **one import line, from `generatorPrefill.ts`**. The earlier
   phrasing of this rule said "exactly one function"; the spec (§6.4, §6.5) also requires the page to
   mark a draft consumed and to emit correction telemetry, which one function cannot cover. The
   requirement that matters is a **single seam**, so `generatorPrefill.ts` is that seam and the page
   imports three functions from it rather than reaching into four modules. Keep it that way: new
   router behaviour on the Generator belongs behind this module, not in another page import.
2. **Route strings for AI navigation appear only in `handlers/`.** The server never sends a path.
3. **The teacher's text never enters a URL.** Prefill travels as an opaque `?ai=<draftId>` handle
   backed by sessionStorage; a topic in a query string would land in browser history, referrer
   headers, and every access log in between.
4. **The draft store fails soft, always.** Quota exceeded, storage disabled (private browsing),
   corrupt JSON → return nothing and let the Generator open empty, which is exactly today's
   behaviour. Never a crash, never an error screen. These cases are real on the target devices.
5. **Downgrade `decision: 'execute'` to `'prefill'`, and ignore `'suggest'`.** Neither is emitted in
   Phase 1; handling them defensively means a future server rollout cannot surprise a
   service-worker-cached client into generating without teacher review.
6. **An unknown action id must never throw.** Stale PWA clients are routine, not theoretical — log,
   fall back, carry on.
7. **Every failure ends at the coach.** A broken router produces a normal coaching answer, never an
   error surface.
8. **No new runtime dependencies without a budget justification.** Target devices are low-end
   Android on poor connections. M6 added none; the bundle grew **5.2 kB gzip** against a 15 kB budget.
9. **Never re-declare a server rule here.** The memory TTL table is the standing example: `sessionMemory.ts`
   applies no expiry because `resolver.js` already re-applies it to whatever the client sends,
   *explicitly so the pipeline does not depend on the client having done it*. A second copy would be
   a fourth home for one rule. The same applies to confidence thresholds, slot completeness and the
   effect ceiling — the client may **downgrade** a decision defensively, never re-derive one.
10. **`ActionExecutor.ts` must never branch on a specific action.** Adding an action is one handler
   file and one line in `handlers/index.ts`, with **zero** edits to the executor. This is asserted by
   a source guard in `ActionExecutor.test.ts`, and the guard is proven to fail when the branching is
   injected. If a new action forces a change there, the abstraction has failed — stop and fix the
   core rather than adding a branch.

## Why `CoachPage` consumes the provider when `GeneratorPage` may not

Guardrail G14 ("never make a page component consume `RouterProvider`") names `GeneratorPage`, and the
spec (§5.5) names it too. The Coach composer is different in kind: it **is** the entry point, and the
pending clarification is rendered there, so it cannot be reached through a pure function the way the
Generator's prefill is.

What G14 actually protects — a single seam, no scattered coupling, and a page that still renders with
the router absent — is met the same way M3 met it:

- `CoachPage` has **one** import line from `assistant/`.
- The context has an **inert default**, so the page renders and behaves normally with no provider.
- With the flag off, `submit()` is not even awaited: the page takes its original synchronous path.

Reconciliation approved at M6. Do not widen it: new router behaviour on the Coach page belongs behind
`useAssistantRouting`, not in a second page import.

## Server counterpart

`types.ts` mirrors `server/src/assistant/contracts.js`. The duplication is deliberate and documented
(CommonJS server vs ESM client). **Change one, change the other in the same commit.**

See [`docs/ai-action-router-phase1-spec.md`](../../../docs/ai-action-router-phase1-spec.md) §5–§6.
