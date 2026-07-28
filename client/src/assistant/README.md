# `client/src/assistant/` — AI Action Router (client)

**Scaffolded in M0 (`types.ts`). Draft store, prefill and telemetry landed in M3. Provider, executor
and gate arrive in M6.**

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
| `api.ts` | Thin typed wrappers over the existing `api()` | M6 |
| `RouterProvider.tsx` | Session slot memory, pending clarification, circuit breaker, catalog cache | M6 |
| `ActionExecutor.ts` | Dispatch by action id; graceful unknown-id fallback | M6 |
| `handlers/` | One per action. **The only place AI-navigation route strings appear** | M6 |
| `sessionMemory.ts` | Typed slot store with per-slot TTL | M6 |
| `intentGate.ts` | Precision-first "does this look like a command?" filter. Pure, no network | M6 |
| `repeatCache.ts` | Normalized-utterance → resolved action cache | M6 |
| `catalog.ts` | Fetch, cache, version invalidation | M6 |

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
   Android on poor connections.

## Server counterpart

`types.ts` mirrors `server/src/assistant/contracts.js`. The duplication is deliberate and documented
(CommonJS server vs ESM client). **Change one, change the other in the same commit.**

See [`docs/ai-action-router-phase1-spec.md`](../../../docs/ai-action-router-phase1-spec.md) §5–§6.
