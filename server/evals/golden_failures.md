# Golden failures — recurring failure classes

> **Tracked, append-mostly.** One entry per recurring failure CLASS, with the date
> it was first seen and where. A class is retired only when a measured baseline
> shows it gone — never because it was fixed in principle.
>
> This file exists because the same three defects were re-discovered by hand at
> M5 and again at M6, each time as a fresh surprise, each time recorded in a
> different document. A failure class that has been seen twice and written down
> twice in two places has not really been recorded at all.
>
> **Status after M7b.** GF-1 is partially mitigated and GF-2's obvious fix was
> measured and rejected — see the per-entry "M7b outcome" rows and
> [`TUNING_LOG.md`](./TUNING_LOG.md). Everything else stands unchanged.

**Frozen M7a reference** (never rewritten): `modelVersion gemini-3.5-flash-lite`,
`promptHash 6fbcd46dd0cede51`, `descriptorHash 6b16a2ee8d69d4dc`,
`corpusHash 6e1b2e5c8bf20f08`, 196 turns.

**After M7b**: `descriptorHash ef2c4fa35e4e8332` (candidate C4). The prompt and
the corpus are byte-identical to M7a — no preamble change survived measurement.

---

## GF-1 · Output degeneration blows the token budget and truncates the JSON

| Field | Value |
|---|---|
| **First seen** | 2026-07-28 (M5 live verification, as "topic garbling": `fractionsnsibs`) |
| **Seen again** | 2026-07-29 (M6 live verification: `photosynthesishippo`, `photosynthesischain photosynthesis photosynthesis`) |
| **Mechanism identified** | 2026-07-29 (M7a baseline — the first time the cause was visible) |
| **Frequency at baseline** | 10/194 turns (5.2%), reported as `classifier_error` |
| **Severity** | **Highest open finding.** A clear, well-formed command produces a coaching answer |
| **M7b outcome** | **PARTIALLY MITIGATED** — 10/196 → **7/196** via candidate C4 (free-text slots bounded in the response schema). Not closed, and still stochastic |

**What actually happens.** The model gets the intent and the slots right, then
degenerates inside the `topic` string — repeating fragments, or bleeding in
unrelated tokens — until it hits `maxOutputTokens` (512). `finishReason` is
`MAX_TOKENS`, the JSON is truncated mid-string, `JSON.parse` fails, and
`classifier.js` correctly reports `classifier_error` → passthrough.

Every affected cassette shows `candidatesTokenCount` between 495 and 498 against
a 512 cap. Example (`cmd.en.008`):

```
{"intent":"generate_assessment","confidence":"high","slots":{"format":"worksheet",
 "topic":"Indian freedom fighters grs0o08o1080808080808080808080808080808080…
```

**Why M5 and M6 saw only the symptom.** By hand, a teacher sees a topic with junk
on the end when the degeneration is short enough to still parse. When it is long
enough to hit the cap, the request just passes through and looks like a
"the model didn't understand it" miss. They are the same defect at two lengths.

**Attribution.** Not a pipeline defect. `classifier.js` handles unparseable
output exactly as designed (G22 — a timeout or a parse failure is a decision, not
an error). The deterministic half never sees these.

**M7b result.** Fix 2 below was implemented and accepted as candidate C4: free-text
slots now declare `maxLength: 120` in the response schema, derived from the
registry's own `slot.type === 'text'` rather than hardcoding `topic`. GF-1 errors
fell from 10 to 7 across the corpus.

**It is NOT closed.** Seven turns still lose a clear command to a coaching answer,
and the failure remains non-deterministic — the same utterance degenerates on one
pass and succeeds on the next. Two attempts to measure the variance band failed
on upstream quota (see TUNING_LOG.md), so the true rate is known only to be
"around 3-5%".

**Remaining candidate, in priority order:**

1. **Lower the sampling temperature for routing.** `GENERATION_CONFIG` in
   `gemini.js` is `temperature: 0.7, topK: 40, topP: 0.95` — module constants
   SHARED with the Coach, with only `maxOutputTokens` overridable per instance.
   A routing classifier is a near-deterministic labelling task and does not want
   0.7. **Requires editing `gemini.js` (protected area 10); decision D4 was not
   approved at M7b and this needs evidence and a review before it is revisited.**
   The evidence now exists: a schema bound alone did not close it.
2. **Raise `ASSISTANT_LLM_MAX_OUTPUT_TOKENS`** — still the weakest option, still
   recommended against. It converts a truncation into a longer piece of garbage
   that parses, so the junk would reach the teacher's form instead of failing
   safe to the coach.

---

## GF-2 · `grade` is very often not extracted, even when explicitly stated

| Field | Value |
|---|---|
| **First seen** | 2026-07-29 (M6 live verification — "for class 6", "Class 4") |
| **Frequency at baseline** | **Value accuracy 23.9% (16/67)** |
| **Severity** | High. The Definition of Done asks for ≥85%; this is the largest gap in the project |

The teacher says "for class 5" and no `grade` slot comes back. The deterministic
half is not implicated and this was verified rather than assumed: `mapGrade`
handles 79 tabulated phrases across English, Hindi, Hinglish, ordinals, cardinals
and roman numerals (87 tests at M4), and every corpus label was checked against
the real `paramSchema` before the run. When the model supplies the phrase, the
mapper canonicalizes it correctly.

**Consequence, and why it is worse than the number looks.** An unextracted
`grade` does not leave the field empty — it falls through to session memory or to
the profile default. The teacher gets a *confident, plausible, wrong* grade,
which the `REMEMBERED` provenance marker makes visible but does not prevent. This
is the mechanism behind the M6 observation of a water-cycle worksheet inheriting
`Subject: Mathematics`.

**Related, same shape, same likely cause:** `subject` 18.2% (4/22),
`difficulty` 16.7% (2/12), `questionCount` 11.1% (1/9), `questionType` 0% (0/4),
`language` 25% (1/4). The pattern is that the model reliably fills `format` and
`topic` and treats everything else as optional.

**M7b outcome: NOT FIXED, and the obvious fix was measured and REJECTED.**

The hypothesis was that the prompt's precision-only instruction ("Only report a
slot you can actually see") was over-performing — hallucination measured **zero
on every optional slot** — and that a paired recall instruction would recover
extraction at no cost. It was tested twice, by two different mechanisms:

- **C1**, an explicit recall instruction: grade 8/38 → 6/35, subject 3/9 → 2/9,
  routing recall 93.0% → 84.2%. **Worse.**
- **C2**, a few-shot worked example showing six stated slots all reported:
  grade 8/38 → 5/34. **Worse.**

Both were rejected with BLOCKED verdicts. Grade accuracy across the full corpus is
**unchanged at ~20%** (16/67 frozen → 13/70 after C4, a three-case difference
inside the demonstrated noise floor).

**This is the most useful negative result of M7b: the preamble is not the lever
for slot extraction on this model.** The untried lever is the descriptor
`examples`, which the prompt is generated from and which decision D5 deliberately
held back. That is now the evidence-backed next step rather than a guess.

---

## GF-3 · Slot-cramming into `topic`

| Field | Value |
|---|---|
| **First seen** | 2026-07-28 (M5: `"fractions.5thsgrade.subject:maths.language:Hindi"`) |
| **Seen again** | 2026-07-29 (M6: `"photosynthesis.grade 6.questionCount 10"`) |
| **Frequency at baseline** | 2/75 scored topics (2.7%) |
| **Severity** | Low frequency, but it is GF-2 wearing a different hat |

Several slots stuffed into `topic` as one string instead of using the separate
fields. Measured separately from GF-1 because the fix is different: this is the
model not using the schema it was given, not the decoder failing to stop.

---

## GF-4 · Over-inclusive topic spans

| Field | Value |
|---|---|
| **First seen** | 2026-07-29 (M7a baseline — not visible before a corpus existed) |
| **Frequency at baseline** | 22/75 scored topics (29%) |
| **Severity** | **Low. Arguably not a defect at all** |

`topic` comes back as `"counting for pre primary"` instead of `"counting"`, or
`"fire safety for class 5"` instead of `"fire safety"`, or `"हिंदी व्याकरण"`
instead of `"व्याकरण"` — the topic plus a qualifier the teacher did state.

**Recorded mainly to stop it being misread.** The baseline's headline "topic
cleanliness 53.3%" lumps these in with GF-1's corruption, and the two are not the
same thing: about 22 of the 29 non-exact topics are over-inclusive spans that
would produce a perfectly reasonable worksheet, and about 7 are genuine
corruption. **Reporting 53.3% without this split overstates the problem.**

Splitting `dirty` into `over_inclusive` and `corrupted` in `score.js` is the
honest fix and is deliberately NOT done in M7a: changing the scorer after seeing
the scores is how a metric quietly becomes whatever its author wanted.

---

## GF-5 · The emergency short-circuit is English-only

| Field | Value |
|---|---|
| **First seen** | 2026-07-29 (M7a corpus authoring, before any run) |
| **Frequency at baseline** | 3/10 emergency cases do not trip the guard |
| **Severity** | **Medium, and it is NOT a router defect** |

`EMERGENCY_SITUATION_PATTERNS` in `safety/inputGuard.js` matches English only, so
"Ek bachcha behosh ho gaya hai", "Class mein aag lag gayi hai" and
"मेरी कक्षा में एक बच्चा बेहोश हो गया है" do not short-circuit at stage 6. The
classifier runs on them.

**What still holds:** all ten emergency cases pass through — none is routed into
a worksheet form — so the router-safety property is intact and the hard gate
passes. What does NOT hold for the non-English three is the *zero-latency*
guarantee and the "classifier never called" property.

`inputGuard.js` is a **protected area** (11): consumed, never adjusted. This is
recorded for the owner as a product decision, not fixed here. It predates the
router entirely — the same gap exists on `/api/coach` today.

---

## GF-6 · `open_generator` over-claims against `generate_assessment`

| Field | Value |
|---|---|
| **First seen** | 2026-07-29 (M7a baseline) |
| **Frequency at baseline** | `open_generator` precision **63.6% (7/11)** against `generate_assessment` 100% |
| **Severity** | Medium — and partly a CORPUS finding, not only a model one |

Four utterances resolved to `open_generator` that were labelled
`generate_assessment`: `cmd.en.011` ("Make a worksheet"), `cmd.en.023` ("Make a
quiz for class 5"), `amb.007` ("Worksheet"), `mem.005#1` ("I need a quiz").

**This is at least half a labelling problem, and it is recorded rather than
silently corrected.** `open_generator`'s own descriptor lists *"I want to make a
worksheet"* as an example, which is nearly indistinguishable from "Make a
worksheet". The model is being consistent with the registry it was given; the
corpus labels assume a distinction the descriptors do not actually draw.

**Deliberately NOT relabelled.** Moving these cases after seeing the score is
exactly the manipulation the ambiguous-quarantine rule exists to prevent. They
go to the corpus review in the manual procedure, where the honest options are:
relabel them, move them to `ambiguous`, or change `open_generator`'s examples so
the boundary is real. That is an owner decision.

**M7b update — partially and accidentally improved, and it is now the dominant
real failure.** Candidate C4 moved `cmd.en.011` and `cmd.en.023` from
`wrong_action` to `correct` with no change aimed at them. But the family is not
resolved: `cmd.hin.010` ("Ek quiz banao") and `mem.013#3` ("Make a quiz") are the
only two REAL breaks C4 caused — the other seven were stochastic or upstream —
and both are bare, topic-less commands of exactly this shape.

Decision D1 froze the corpus and left GF-6 open, which was the right call. But
after M7b it is worth stating plainly: **every remaining non-noise failure in the
corpus is a bare command with no topic**, and the boundary between "open the
generator" and "generate an assessment with nothing filled in" is genuinely
undrawn in the descriptors. That is a product decision, not a tuning problem.

---

## GF-7 · Hinglish subject vocabulary gaps

| Field | Value |
|---|---|
| **First seen** | 2026-07-29 (M7a corpus authoring, by probing the mappers) |
| **Frequency at baseline** | 2 cases, deliberately included |
| **Severity** | Low, and it is a DETERMINISTIC defect — the only one found |

- `angreji` maps to `en` in the LANGUAGES table but is **absent from SUBJECTS**,
  so "Angreji grammar ka worksheet" yields no subject (`cmd.hin.007`).
- `samajik vigyan` (social science) maps to **Science**, because the token scan
  hits `vigyan`. `samajik adhyayan` maps correctly (`cmd.hin.012`).

Both are in `actions/vocab/`, both are one-line table entries, and both are
**deliberately unfixed in M7a** — the corpus labels them to the correct answer so
they appear as measured failures rather than being baked into the baseline as
correct. Fixing a mapper is a code change with its own milestone gate.

---

## Retired

_None yet._
