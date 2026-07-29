# AI Action Router — recorded evaluation baseline

> ⚠️ **This document records the FROZEN M7a baseline and is never revised.** Every
> number below is the measurement the project's regression references were frozen
> at. M7b has since run: it accepted one change (a response-schema bound) and
> rejected three prompt candidates. For what happened next see
> [`../TUNING_LOG.md`](../TUNING_LOG.md), [`../golden_failures.md`](../golden_failures.md)
> and the active baseline `m7b.json`. **Nothing in this file was edited to reflect
> those results** — that is the point of a frozen reference.
>
> **This is the tracked baseline record the specification's §10.5 requires**
> ("manual live runs … with results recorded in a tracked file").
> `baseline.json` beside it is the machine-readable half that the replay CI gate
> asserts against.

## Provenance

| Field | Value |
|---|---|
| Recorded | 2026-07-29 |
| Milestone | **M7a — measurement only. No prompt, model or vocabulary was tuned** |
| `modelVersion` | `gemini-3.5-flash-lite` |
| Endpoint | `gemini-flash-lite-latest` (floating alias) |
| `promptHash` | `6fbcd46dd0cede51` |
| `descriptorHash` | `6b16a2ee8d69d4dc` |
| `registryHash` | `d30e5c38f928d4fe` |
| `corpusHash` | `6e1b2e5c8bf20f08` |
| Corpus | 157 single-turn cases + 15 sessions = **196 scored turns** |

**The alias moved before this baseline was taken.** M5 selected
`gemini-flash-lite-latest` over a pinned model, accepting reproducibility loss.
At M5 it resolved to a 2.x model; the M7a pre-flight probe found it now resolves
to **`gemini-3.5-flash-lite`**. This is precisely why `modelVersion` is recorded
per run and why a run whose observed version differs from this one is stamped
**MODEL DRIFT** in its summary.

### How this baseline was recorded

Recorded **live, stratum by stratum**, then scored by a single deterministic
replay over the complete corpus. Two reasons, both worth stating because a
baseline whose provenance is vague is not evidence:

1. **Rate limiting.** The upstream key allows roughly 15 requests/minute. The
   first unpaced run fired 64 calls in 34 seconds and produced 22 consecutive
   `classifier_error` turns — infrastructure failure that would have entered this
   file as a model-quality result. Live runs are now paced at 4.2 s/turn, making
   a full pass ~14 minutes.
2. **Chunking.** `--record` merges rather than overwrites, so the corpus could be
   recorded in stratum-sized pieces.

The metrics below therefore come from replaying the recorded live responses, not
from a separate live pass. That is the same arithmetic over the same model
outputs — which is the whole point of recording at the socket.

**Repeat count: 1.** A variance band across repeated passes was NOT taken. This
is a stated limitation, not an omission: at 4.2 s/turn a three-pass baseline is
~42 minutes of upstream time, and the value of a variance band is lower than the
value of the findings already visible. **A `--repeat 3` run over the Hinglish
stratum is the recommended first addition** — it is the go/no-go stratum.

### Cassette hygiene

- 188 cassettes, all HTTP 200, all carrying a `modelVersion`.
- One recorded 503 (`coach.en.023`) was **purged and re-recorded**. A recorded
  non-2xx replays forever as a deterministic "model failure"; `saveCassettes` now
  refuses to persist one.
- One case (`cmd.hin.014`) had no cassette because its fetch rejected outright.
  It was re-recorded. **The run that first hid this is the reason the runner now
  invalidates any run with a cassette miss** — see the harness note below.
- Two cases (`coach.en.025`, `coach.hin.012`) were added late in M7a after an
  injected-defect proof showed the corpus could not detect the gate's
  question-opener guard being deleted, and the baseline was re-promoted at 196
  turns. **The corpus, hash and cassette counts above are the post-addition,
  frozen values** — three of them were briefly recorded here at their
  pre-addition figures and are corrected, because a record that contradicts the
  artifact it documents is worse than no record.

---

## Headline

> **Thresholds are INFORMATIONAL.** Per the M7a authorization they are reported
> and compared but produce no verdict until this baseline has been reviewed. The
> hard gates are safety properties and do block.

| Metric | Measured | Reference | Source |
|---|---|---|---|
| Routing precision | **95.8%** (91/95) | ≥90% | DoD |
| Routing recall | **85.8%** (91/106) | ≥75% | DoD |
| **Hinglish precision** | **100.0%** (21/21) | ≥85% | **Phase 2 go/no-go** |
| Grade slot accuracy | **23.9%** (16/67) | ≥85% | DoD |
| Exact decision accuracy | 82.9% (150/181) | — | — |
| False positives | **1** | — | — |
| False negatives | 15 | — | — |

## Hard gates — all pass

| Gate | Result |
|---|---|
| Emergency routed | **PASS** — 0/10 |
| Classifier calls on guard-tripping emergencies | **PASS** — 0 calls across all 7 |
| Language trap | **PASS** — 0 violations |
| Out-of-catalog action accepted | **PASS** — 0 |
| Ask-turn memory isolation | **PASS** — 0 leaks |

## By language

| Language | Turns | Precision | Recall |
|---|---|---|---|
| en | 122 | 93.2% (55/59) | 80.9% (55/68) |
| hinglish | 37 | **100.0%** (21/21) | 91.3% (21/23) |
| hi | 22 | **100.0%** (15/15) | 100.0% (15/15) |

## By action

| Action | Precision | Recall |
|---|---|---|
| `generate_assessment` | 100.0% (84/84) | 84.8% (84/99) |
| `open_generator` | **63.6%** (7/11) | 100.0% (7/7) |

## Slots

| Slot | Extraction recall | Value accuracy | Hallucination |
|---|---|---|---|
| format | 88.5% (69/78) | 88.5% (69/78) | 100.0% (2/2) |
| topic | 94.7% (71/75) | 53.3% (40/75) | 100.0% (2/2) |
| grade | 23.9% (16/67) | 23.9% (16/67) | 0.0% (0/6) |
| subject | 22.7% (5/22) | 18.2% (4/22) | 0.0% (0/54) |
| difficulty | 16.7% (2/12) | 16.7% (2/12) | 0.0% (0/72) |
| questionType | 0.0% (0/4) | 0.0% (0/4) | 0.0% (0/80) |
| questionCount | 11.1% (1/9) | 11.1% (1/9) | 0.0% (0/74) |
| language | 25.0% (1/4) | 25.0% (1/4) | 0.0% (0/79) |

**The two 100% hallucination figures have a denominator of 2.** They are not a
finding; `format` and `topic` are almost never in a `notStated` list, because an
utterance that states neither is rarely a command at all. Read the counts, not
the percentages.

**Topic cleanliness 53.3% overstates the problem.** Of the 29 non-exact topics,
roughly 22 are *over-inclusive spans* ("fire safety for class 5" for "fire
safety") that would still produce a sensible worksheet, and roughly 7 are genuine
corruption. See golden_failures GF-1 and GF-4.

## Clarification

- Rate: 18.9% (18/95) — **report-only, no threshold in Phase 1.** This baseline
  establishes the number; a threshold is a Phase 2 decision.
- Correct slot asked: 85.7% (6/7)
- Over-asking 12 · Under-asking 6

## Memory (15 sessions, 39 turns)

| Metric | Measured |
|---|---|
| Inheritance correctness | 25.0% (5/20) |
| **Staleness (lower is better)** | **0.0% (0/7)** |
| Override correctness | 25.0% (1/4) |

**Read these together with GF-2, not on their own.** Inheritance and override
both look terrible, and both are *downstream of the same cause*: a slot the model
never extracted on turn 1 is never written to memory, so turn 2 has nothing to
inherit and scores a miss. The TTL machinery itself is behaving — **staleness is
0/7**, meaning nothing expired was ever reused, which is the property the short
`topic` TTL exists to guarantee.

## Client intent gate

Measured separately (`client/src/assistant/intentGate.eval.test.ts`) over the
same corpus:

- Gate precision **96.1%** (98/102)
- Gate recall **92.5%** (98/106)
- Declined but labelled as actions: **8**

**CHANGE-2's precision-first bet looks considerably better than its own comment
feared.** The measured recall cost is 8 utterances out of 106. Notable members:
`जनरेटर खोलो` (Devanagari "open the generator" — `जनरेटर` is not in the domain-noun
list), "Take me to the generator" ("take" is deliberately excluded), and three
"I need / I want" phrasings.

## Passthrough reason distribution

`not_an_action` 73 · `classifier_error` 10 · `emergency_detected` 7 ·
`low_confidence` 2

---

## What this baseline says

**The routing decision is in good shape; slot extraction is not.**

Precision, recall and — decisively — Hinglish precision all clear their reference
points, with Hinglish and Hindi at 100%. **The architecture document named
Hinglish precision below ~85% as the trigger to reconsider whether Phase 2 should
proceed at all; the measured value is 100% (21/21).** That question is answered,
subject to the caveat that 21 cases is a small denominator and repeat passes were
not taken.

Against that, `grade` accuracy is 23.9% where the Definition of Done asks for
85%, and every other optional slot is worse. The model reliably identifies *what
the teacher wants* and unreliably identifies *the details*. A teacher would
experience this as: the right form opens, with the right format and topic, and
the class and subject wrong or defaulted.

**Two of the seven findings are code defects, not model quality** (GF-5's
English-only emergency guard, GF-7's vocabulary gaps) and one is partly a corpus
defect (GF-6). Those were separated by the attribution column rather than
guessed at.

## Limitations, stated

1. **Single pass.** No variance band. A model at temperature 0.7 behind a
   floating alias will not reproduce this exactly.
2. **21 Hinglish command cases** carry the Phase 2 go/no-go. That is a thin
   denominator for a decision that size.
3. **The gate and the server are measured separately**, so "the gate declined it
   AND the server would have got it right" is available by hand but is not a
   joined metric.
4. **The 500-character envelope limit is not exercised** — the harness calls
   `interpret()` directly, below the HTTP shell.
5. **GF-6 means `open_generator`'s 63.6% precision is partly measuring the
   corpus**, not the model.

## Recommended next steps (written before M7b ran — see TUNING_LOG.md for outcomes)

1. **Owner review of GF-6** — relabel, quarantine, or change the descriptor
   examples. The corpus cannot be corrected by whoever ran it.
2. **Freeze thresholds** now that a baseline exists (the M7a authorization
   deferred this deliberately).
3. **M7b tuning order**, by expected value: GF-1 (temperature / schema bound),
   then GF-2 (prompt recall instruction + descriptor examples).
4. **A `--repeat 3` Hinglish run** to put a variance band on the go/no-go number.
