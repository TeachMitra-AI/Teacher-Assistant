# `server/src/assistant/` — Intent Gateway

**Scaffolded in M0 (`contracts.js`). Resolver and policy delivered in M4. Classifier, pipeline and
endpoint delivered in M5. Telemetry transport arrives in M8.**

> ⚠️ **This folder became reachable from production at M5.** Until M4 it had no caller at all, which
> is what made M4 the plan's cleanest rollback point. `POST /api/assistant/interpret` now calls
> `interpret.js` on every request — **but only when `ASSISTANT_ENABLED` is on, which it is not by
> default.** With the flags at their defaults the endpoint returns an immediate inert passthrough and
> spends no model call.

This folder turns an utterance into a **ResolvedAction** — or, far more often, into a decision to
get out of the way and let the existing coach answer the question.

It depends on [`../actions/`](../actions/README.md). **`actions/` never depends on this.**

## Layout

| Path | Responsibility | Milestone |
|---|---|---|
| `contracts.js` | Frozen wire contracts — constants + typedefs. No logic | **M0** |
| `proposalSchema.js` | The untrusted-model boundary: the Gemini `responseSchema` built from the catalog, zod SHAPE validation, and the G4 authorization gate | **M5** ✅ |
| `classifier.js` | Prompt assembly from the registry, the `geminiFast` call, response parsing. **The only file here that talks to Gemini** | **M5** ✅ |
| `resolver.js` | Canonicalization, slot merge (`utterance > memory > profile > default`), provenance, memory TTL, contradiction detection, per-field param validation. No I/O, no AI, no clock | **M4** ✅ |
| `policy.js` | The decision rules. Pure — signals in, decision out. Rule 0 (effect ceiling) then the Phase 1 clamp | **M4** ✅ |
| `interpret.js` | Pipeline orchestration only. Thin, with no business rules of its own. Database-free via injected dependencies | **M5** ✅ |
| `telemetry.js` | Low-volume `Event` rows for prefill-delivered + outcome. **Not created at M5** (decision D2) — the per-decision log is a structured stdout line emitted by the route, which costs no database write | M8 |

## Gate 2 is two checks, not one — read this before touching `proposalSchema.js`

Spec §4.4 gate 2 reads *"zod shape **and** id membership in the role-filtered catalog"*. Those are
deliberately separate functions here, and collapsing them destroys the second:

An M5 draft built the zod `intent` field as an enum of the catalog ids **and** then looked the
descriptor up. Both came from the same list, so zod always rejected a bad id first and the
authorization check became unreachable dead code. Injecting the classic `|| descriptors[0]` fallback
defect into it changed nothing — 123 tests still passed. Splitting shape (`buildProposalSchema`,
which validates a bounded string) from permission (`parseProposal`, which is the only place an id is
authorized) is what gives G4 teeth; the same injected defect now fails 9 tests.

**A guard that cannot fail is not a guard.**

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

## Pipeline order (delivered M5)

Stages 1–4 belong to the HTTP shell (`../routes/assistant.js`); stages 5–12 to `interpret.js`.

Kill switch → auth → rate limit → envelope validation → normalize → **emergency short-circuit** →
budget → catalog build → classify → proposal validation → canonicalize → slot merge → param
validation → decision → decision log.

The emergency check is non-negotiable and precedes all router work: a teacher describing an active
emergency must reach the existing emergency coach prompt with zero added latency and zero chance of
being routed into a worksheet form. **Measured at M5: an emergency utterance returns in ~87 ms
against ~1.2 s for a routed one**, which is the visible proof that the classifier was never reached.

Stages 5–12 run inside a total catch. A defect in any of them costs a routing opportunity and
nothing else.

## Where the failure boundaries actually are

Two of them sit **outside** `interpret.js`'s catch, and both were found at M5 by deliberately
breaking that catch and noticing which tests did *not* care:

- **The rollout gate** (`isWithinRollout` in the route) does a Prisma lookup when a school allow-list
  is configured. It now fails **closed** — a database it cannot read is never treated as permission
  granted. Before that fix it returned a **500**, from both `/interpret` and `/catalog`.
- **The profile read** is wrapped at its own call site, so a database failure costs prefilled fields
  rather than the request.

## Known model-quality gaps — MEASURED at M7, and still open

Observed against live Gemini during M5 verification and recorded as eval seeds. The deterministic
half handles all three correctly once the model supplies the right slots; the gap is upstream:

1. The `language` slot is often **not populated even when a language is explicitly named** ("a
   Marathi quiz", "in Hindi"). Verified that `mapLanguage('Hindi') → 'hi'` and that the resolver
   fills it with provenance `utterance`, so this is a classifier recall problem, not a mapper one.
2. On one utterance the model crammed several slots into `topic` as a single string
   (`"fractions.5thsgrade.subject:maths.language:Hindi"`) instead of using the separate fields.
3. It sometimes reports a slot with provenance `utterance` that the teacher never said (inferring
   `format: worksheet` from "I need something on photosynthesis").

M7 measured all three against a 196-turn labelled corpus, and the outcome is recorded in
[`../../evals/golden_failures.md`](../../evals/golden_failures.md) and
[`../../evals/TUNING_LOG.md`](../../evals/TUNING_LOG.md):

- Gap 1 (`language` not populated) and gap 3 (slots reported that were never said) are part of the
  same finding: the model reliably fills `format` and `topic` and treats every other slot as
  optional. **Grade extraction is ~20% against a Definition-of-Done target of 85%** (GF-2).
- Gap 2 (slot-cramming) is rare in the corpus — 2 of 75 scored topics (GF-3).
- The related degeneration failure (GF-1) was reduced from 10/196 to 7/196 at M7b by bounding
  free-text slots in the response schema. It is **not closed**.

**STILL DO NOT TUNE THE PROMPT HERE.** That is not a scheduling note any more, it is a measured
result: M7b tried two independent prompt mechanisms aimed at slot recall (an explicit recall
instruction, and a few-shot worked example) and **both made extraction and routing worse**. The
preamble is not the lever. Changing it requires a full live re-baseline, and the evidence says it
will not help.

See [`docs/ai-action-router-phase1-spec.md`](../../../docs/ai-action-router-phase1-spec.md) §4.
