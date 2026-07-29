# M7b tuning log

> **Every candidate, kept or rejected, with its numbers.** A log that records only
> what worked is how prompt engineering turns into folklore: the next person
> re-tries the same rejected idea because nothing says it was already measured.
>
> All measurements against the **frozen M7a corpus** (`corpusHash 6e1b2e5c8bf20f08`,
> 196 turns) and the frozen baseline. `modelVersion gemini-3.5-flash-lite`
> throughout — verified by pre-flight probe before the first experiment.
>
> Iteration was done on the **dev half** (105 turns); the holdout half (91 turns)
> was read only at the end. See `lib/baselines.js` for why.

## Method note that governs every reading below

**GF-1 failures are stochastic.** The same utterance produces `classifier_error`
on one pass and a correct routing on the next, because the model degenerates
non-deterministically at temperature 0.7. Every flip table below therefore
contains movement in both directions that is *noise, not signal*, and single-pass
deltas of a few cases cannot be interpreted.

A `--repeat 3` variance band was attempted twice and **both attempts failed**:
the first saturated the per-minute limit (202 calls in 502 s → passes 2 and 3
almost entirely `passthrough`), the second exhausted the **500/day free-tier
quota** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, 126/126 × 429).
Neither is reported as a measurement. **The variance band remains unmeasured** —
the same limitation M7a recorded, now with a documented cause.

Every candidate run below was checked for quota corruption using the recorded
upstream status counts. All were clean (C1 and C2: 101/101 × HTTP 200), so the
rejections stand on their own evidence.

---

## Accepted

### C4 — bound free-text slots in the response schema · **ACCEPTED**

`proposalSchema.js` · schema · not a prompt change

Free-text slots (`topic`, registry-derived via `slot.type === 'text'`) declare
`maxLength: 120` in the Gemini `responseSchema`. An unbounded string gives the
decoder nowhere to stop; the bound is a ceiling no real value approaches, and the
application's own accept bound (`MAX_SLOT_VALUE_LENGTH = 200`) is unchanged, so
it can neither admit nor reject anything it did not before.

**Full corpus, against the frozen baseline:**

| Metric | Frozen M7a | C4 | Δ |
|---|---|---|---|
| Routing precision | 95.8% (91/95) | **96.9% (95/98)** | +1.1 pp |
| Routing recall | 85.8% (91/106) | **89.6% (95/106)** | +3.8 pp |
| False negatives | 15 | **11** | −4 |
| GF-1 errors | 10 | **7** | −3 |
| Hinglish precision | 100% (21/21) | 95.5% (21/22) | −4.5 pp |
| Grade accuracy | 23.9% (16/67) | 18.6% (13/70) | −5.3 pp |
| Hallucination (all slots) | 0 | **0** | — |
| Hard gates | 5/5 PASS | **5/5 PASS** | — |

**Flip table: 13 FIXED, 9 BROKEN, 19 changed-but-still-correct, 155 unchanged.**

Two of the fixes are structural rather than stochastic and are the reason this
was accepted: `cmd.en.011` ("Make a worksheet") and `cmd.en.023` ("Make a quiz
for class 5") moved from `wrong_action` → `correct`, i.e. two GF-6 cases stopped
resolving to `open_generator`.

**Every one of the 9 breaks, individually:**

| Case | Reason | Assessment |
|---|---|---|
| `adv.018` | `classifier_error` | **Stochastic GF-1.** Triggered the BLOCKED verdict because it is in the adversarial stratum — but the movement is *toward* passthrough, which is the safe direction for hostile input. A recall loss, not a safety loss |
| `cmd.en.010` | `classifier_error` | Stochastic GF-1 |
| `cmd.en.026` | `classifier_error` | Stochastic GF-1 |
| `mem.001#1` | `classifier_error` | Stochastic GF-1 |
| `mem.002#1` | `classifier_error` | Stochastic GF-1 |
| `mem.015#2` | `classifier_error` | Stochastic GF-1 |
| `cmd.hin.014` | `safety_blocked` | Upstream safety filter fired on an innocuous utterance. Infrastructure, not the candidate |
| `cmd.hin.010` | → `open_generator` | **Real.** "Ek quiz banao" — a bare Hinglish command with no topic. GF-6 family, and the sole cause of the Hinglish precision dip |
| `mem.013#3` | `low_confidence` | **Real.** "Make a quiz" — same GF-6 family, bare two-word command |

So 7 of 9 are noise or infrastructure and 2 are real, both in the GF-6 family
that decision D1 deliberately left unresolved.

**Why the grade and Hinglish "regressions" are not treated as real:** grade moved
16/70 → 13/70 correct, three cases on a metric whose own flip table shows six
cases moving stochastically in the same run. Hinglish moved by exactly one case.
Both are inside the demonstrated noise floor, and without the variance band that
could not be taken, neither can be called a regression or a wash. **The honest
statement is that grade extraction is UNCHANGED at ~20%, not that it improved or
regressed.**

**Dev vs holdout** — the overfitting check:

| | dev (105) | holdout (91) |
|---|---|---|
| Precision | 98.1% (53/54) | 95.5% (42/44) |
| Recall | 93.0% (53/57) | 85.7% (42/49) |

The holdout is lower, which is the expected direction. With only one accepted
change — and a structural one never tuned against specific cases — most of that
gap is likely the same noise. It is reported rather than explained away.

---

## Rejected

### C3 — "topic is the subject matter only, stated briefly" · **REJECTED**

`classifier.js` `PREAMBLE` · prompt

Targeted GF-1 (degeneration) first and topic cleanliness second.

| dev half | M7a frozen | C3 |
|---|---|---|
| **GF-1 errors** | 4 | **6 (worse)** |
| topic exact | 24 | 27 |
| topic dirty | 16 | **10 (better)** |
| precision | 48/55 | 46/55 |

**Rejected because it failed its primary target.** It did improve topic
cleanliness — a real effect, dirty spans 16 → 10 — but GF-1 went the wrong way
and precision dropped. 5 fixed / 7 broken.

**Worth revisiting in isolation for topic cleanliness alone** if that becomes a
goal in its own right; it is the only candidate that moved that metric.

### C1 — paired recall instruction · **REJECTED**

`classifier.js` `PREAMBLE` · prompt · stacked on accepted C4

Added: *"But DO report every slot the message DOES state… Omitting a slot the
teacher actually stated is just as wrong as inventing one they did not."*

The hypothesis was strong: hallucination was measured at **zero on every optional
slot** (grade 0/6, subject 0/54, difficulty 0/72, questionType 0/80,
questionCount 0/74, language 0/79), so the existing precision-only instruction
was over-performing and there was budget to push recall hard.

| dev half | C4 (accepted) | C4 + C1 |
|---|---|---|
| Precision | 98.1% (53/54) | 96.0% (48/50) |
| Recall | 93.0% (53/57) | 84.2% (48/57) |
| **Grade** | 8/38 | **6/35 (worse)** |
| **Subject** | 3/9 | **2/9 (worse)** |
| GF-1 errors | 3 | 6 |

**Rejected. VERDICT: BLOCKED.** It made its own target worse. The hypothesis was
wrong: telling this model to fill more slots does not make it fill more slots, and
the added rule appears to cost attention elsewhere.

### C2 — worked input→output example · **REJECTED**

`classifier.js` `PREAMBLE` · prompt · stacked on accepted C4

A different mechanism for the same target as C1: a few-shot demonstration showing
six stated slots all reported, rather than an abstract instruction.

| dev half | C4 (accepted) | C4 + C2 |
|---|---|---|
| Precision | 98.1% (53/54) | 96.0% (48/50) |
| Recall | 93.0% (53/57) | 84.2% (48/57) |
| **Grade** | 8/38 | **5/34 (worse)** |

**Rejected. VERDICT: BLOCKED.** 1 fixed / 5 broken.

---

## The finding that matters most for M7c

**Two independent prompt mechanisms aimed at slot recall both made it worse.**
C1 (abstract instruction) and C2 (few-shot example) are different levers, were
measured separately, and both degraded grade and subject extraction *and* routing.

That is evidence, not an anecdote: **the preamble is not the lever for slot
extraction on this model.** The remaining candidates in priority order are

1. **Descriptor `examples`** (decision D5, currently held). The prompt is built
   from them, and they are the one part of the prompt M7b did not touch. Now that
   preamble tuning has been shown to fail, this is the evidence-backed next step
   rather than a guess.
2. **Temperature / topK** (decision D4, not approved). GF-1 is stochastic and
   temperature 0.7 is the most likely reason; the schema bound reduced it 10 → 7
   but did not remove it. Requires a per-instance tunable in the protected
   `gemini.js`.
3. A larger corpus for the thin denominators (`questionType` 0/4, `language` 1/4).
