# `server/src/assistant/` — Intent Gateway

**Scaffolded in M0 (`contracts.js`). Populated in M4 (resolver, policy) and M5 (classifier,
pipeline, telemetry).**

This folder turns an utterance into a **ResolvedAction** — or, far more often, into a decision to
get out of the way and let the existing coach answer the question.

It depends on [`../actions/`](../actions/README.md). **`actions/` never depends on this.**

## Layout

| Path | Responsibility | Milestone |
|---|---|---|
| `contracts.js` | Frozen wire contracts — constants + typedefs. No logic | **M0** |
| `proposalSchema.js` | The untrusted-model boundary: zod for `IntentProposal` + the Gemini `responseSchema` | M5 |
| `classifier.js` | Prompt assembly from the registry, the `geminiFast` call, response parsing. **The only file here that talks to Gemini** | M5 |
| `resolver.js` | Canonicalization, slot merge, provenance, param validation. No I/O, no AI | M4 |
| `policy.js` | The decision rules. Pure — takes signals, returns a decision | M4 |
| `interpret.js` | Pipeline orchestration only. Thin, with no business rules of its own | M5 |
| `telemetry.js` | Structured decision logs + low-volume outcome events | M8 |

## The governing idea

> **The model proposes. The application disposes.**

Understanding is probabilistic and belongs to the LLM. Resolution and execution are deterministic
and belong to the application. Because those are separate, a misclassification can only ever produce
a **wrong suggestion**, never a **wrong effect**.

## Rules

1. **Never trust a model-supplied action id.** Re-verify membership in the *role-filtered* catalog
   after parsing, every request. The Gemini `responseSchema` enum is a strong hint, not a guarantee.
2. **The model returns raw strings; the application canonicalizes.** `"class 5"` becomes
   `"Class 3-5"` in `actions/vocab/`, in code that can be tested and fixed — never in a prompt.
3. **Confidence is ordinal**, never a float.
4. **Effect class is registry-declared and caps the policy** at any confidence. No model output can
   escalate its own consequences.
5. **`/api/assistant/interpret` returns non-2xx only for auth, malformed requests and rate limiting.**
   Everything else — classifier failure, timeout, safety block, invalid proposal, a bug — returns 200
   with `passthrough: true`. This endpoint sits in front of a text box; a 502 here would be an error
   toast on a feature the teacher did not knowingly invoke.
6. **Never log the utterance text or resolved slot values.** Metadata only, matching the existing
   `logAiEvent` discipline in `index.js`.
7. **Use `app.locals.geminiFast`, never `app.locals.gemini`.** The shared instance has a 30 s
   per-call timeout and a 60 s deadline, which would turn routing into a feature that appears to
   hang. Routing gets ~3.5 s / 5 s.
8. **Never modify `../gemini.js`.** It already supports per-instance tunables and structured
   `responseSchema` output, including correctly skipping the continuation loop for JSON responses.
   Needing to edit it means the design has drifted — escalate instead.

## Pipeline order (M5)

Kill switch → auth → rate limit → envelope validation → normalize → **emergency short-circuit** →
budget → catalog build → classify → proposal validation → canonicalize → slot merge → param
validation → decision → telemetry.

The emergency check is non-negotiable and precedes all router work: a teacher describing an active
emergency must reach the existing emergency coach prompt with zero added latency and zero chance of
being routed into a worksheet form.

See [`docs/ai-action-router-phase1-spec.md`](../../../docs/ai-action-router-phase1-spec.md) §4.
