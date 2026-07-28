# `server/src/actions/` — Capability Registry

**Scaffolded in M0. Populated in M1 (schemas), M2 (registry + descriptors), M4 (vocab) — all complete.**

This folder answers one question: **what can this application do, with what parameters, under what
permissions?**

It contains **no AI, no HTTP, no Express**. It is plain data plus pure functions, importable and
testable in isolation — which is the point. The registry is the durable asset of the AI Action
Router project; the AI layer is a swappable front end onto it. A command palette, an onboarding
chip generator, a permission matrix, or a docs generator could all consume this folder without the
assistant existing at all.

## Layout

| Path | Contents | Milestone |
|---|---|---|
| `registry.js` | Explicit descriptor list, lookup by id, role/flag/status filtering, public catalog projection, `catalogVersion` | M2 |
| `descriptors/` | One file per action. Pure data + a schema reference | M2 |
| `schemas/` | Zod param schemas — **the** definition, shared with the real route | M1 |
| `vocab/` | Controlled-vocabulary mappers (grade, subject, language) + `shared.js` (normalization and the result contract) and `index.js` (id → mapper). Pure, heavily unit-tested | M4 |

## The vocabulary result contract

A mapper never returns a bare string. It returns one of four statuses, and the difference between
them is what stops the router printing a confident, plausible, wrong worksheet:

| Status | Meaning | What the resolver does |
|---|---|---|
| `mapped` | One canonical value | Uses it, provenance `utterance` |
| `ambiguous` | Understood, but spans canonical values (`"class 5-6"`, `"primary"`) | Prefills the teacher's **raw phrase** and flags the field low-confidence |
| `contradiction` | Two distinct readings were stated (`"class 5 or 8"`) | Leaves the slot empty and reports it; the policy asks, showing **both** readings |
| `unmapped` | Nothing recognisable | Falls through to memory → profile → default. **Not a failure** |

Two rules that are easy to get wrong:

1. **Language never returns `ambiguous`.** A document has one language, and the ambiguous path
   prefills raw words — which in a `<select>` silently shows nothing selected. Two languages is a
   contradiction.
2. **Cardinal number words and roman numerals are gated on class context.** Ungated, `"ten questions
   on fractions"` reads as Class 9-10 and `"i want a worksheet"` as Class 1-2.

## Rules

1. **`actions/` must never import from `assistant/`.** Dependency flows one way. The registry has to
   stay usable by a consumer that has nothing to do with AI.
2. **Schemas are referenced, never copied.** `schemas/generateAssessment.js` is imported by both the
   descriptor and `routes/resources.js`. Two definitions would drift within weeks, and the router
   would start producing parameters the endpoint rejects — the exact failure this design exists to
   prevent.
3. **Registration is an explicit import list**, not filesystem auto-discovery. The live capability
   set must be visible in one file, in a diff, in a code review.
4. **No routes, paths, or URLs in a descriptor.** The server never tells the client where to
   navigate; the client owns its handler map, keyed by action id.
5. **`paramSchema`, `requiredRoles`, `featureFlag` and `autoExecute` are never projected** into a
   catalog response.
6. **Every Phase 1 action has `autoExecute: false` and `effect` no higher than `draft`.** Validated
   at startup, not by convention.

## Adding an action (from Phase 2 onward)

Exactly four artifacts, plus a `catalogVersion` bump:

1. A descriptor file here, and one line in the registry's import list
2. A zod schema (or a reference to an existing route schema)
3. A client handler in `client/src/assistant/handlers/`, and one line in the handler map
4. ≥10 evaluation cases, including ≥3 Hinglish and ≥2 adversarial

> If adding an action requires editing `assistant/classifier.js`, `assistant/resolver.js`,
> `assistant/policy.js`, `assistant/interpret.js` or the client's `ActionExecutor`, **the
> abstraction has failed — stop and fix the core before adding the action.** Make this an explicit
> review question on every future action PR: *which core files did this touch?* The correct answer
> is none.

See [`docs/ai-action-router-phase1-spec.md`](../../../docs/ai-action-router-phase1-spec.md) §8.
