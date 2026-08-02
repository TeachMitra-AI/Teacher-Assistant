# Corpus label format

One JSON object per line (`.jsonl`). Blank lines and `//` lines are section
headings, not data. Every record is validated by `lib/caseSchema.js` at load
time; **a record that does not validate stops the run** rather than being
skipped.

Files named `sessions.*.jsonl` hold multi-turn sessions; everything else holds
single-turn cases.

## Single-turn case

```json
{
  "id": "cmd.en.001",
  "stratum": "commands",
  "language": "en",
  "utterance": "Generate a Class 5 fractions worksheet",
  "notes": "why this case exists — optional, but read during corpus review",
  "profile": { "defaultGrade": "Class 6-8" },
  "expected": {
    "decision": "prefill",
    "actionId": "generate_assessment",
    "askSlot": "format",
    "passthroughReason": "emergency_detected",
    "acceptable": ["ask", "passthrough"],
    "slots": {
      "stated":         { "format": "worksheet", "grade": "Class 3-5" },
      "inherited":      { "subject": "Mathematics" },
      "notStated":      ["language", "difficulty"],
      "mustNotInherit": ["topic"]
    }
  }
}
```

| Field | Meaning |
|---|---|
| `id` | Dot-separated lowercase. Appears in every report — keep it stable |
| `stratum` | `commands` · `coaching` · `ambiguous` · `emergency` · `adversarial` · `memory` |
| `language` | `en` · `hinglish` (romanized) · `hi` (Devanagari) |
| `profile` | The teacher's saved preferences. **Omit for an empty profile** |
| `expected.decision` | The single outcome the labeller considers correct |
| `expected.acceptable` | **Ambiguous cases only.** Its presence quarantines the case |
| `expected.askSlot` | Required when `decision` is `ask` |
| `expected.passthroughReason` | Asserted only where the label genuinely determines it |

## The four slot lists

This is the part that does the work. Each answers a different question, and
collapsing any two of them loses a metric:

| List | Means | Scored as |
|---|---|---|
| `stated` | The teacher said it **in this turn** | Must arrive with provenance `utterance` and the right value → extraction recall, value accuracy |
| `inherited` | Should carry from a previous turn | Must arrive with provenance `memory` → inheritance correctness |
| `notStated` | The teacher did **not** say it | Provenance `utterance` here is a **hallucination** |
| `mustNotInherit` | Memory holds it, but it expired or was overridden | Provenance `memory` here is **staleness** |

**`notStated` is the load-bearing one.** Without an explicit "the teacher did not
say this" list, hallucination is unmeasurable: there is no way to tell a correct
extraction from a plausible guess that happened to look right. That distinction
is exactly the gap recorded live at M5 and again at M6.

A slot in **neither** `stated` nor `notStated` is deliberately **unscored** — used
where the teacher did state something but the correct outcome is that it does not
survive (`cmd.en.034`: "50 questions" is above the maximum and must be dropped,
not clamped).

## Multi-turn session

```json
{
  "id": "mem.001",
  "stratum": "memory",
  "language": "en",
  "notes": "…",
  "turns": [
    { "utterance": "…", "expected": { … } },
    { "utterance": "…", "expected": { … } }
  ]
}
```

Turn numbers are **positional and 1-based**, which is what the resolver's TTL
arithmetic is written against. The harness threads memory forward by applying
each response's `memoryUpdates` verbatim and by nothing else — the same thing the
client does, so no TTL rule is duplicated here.

## Rules for authoring

1. **Authored text only, never harvested.** Real teacher utterances carry PII,
   would make the corpus uncommittable, and would turn every report and CSV into
   a G11 problem ("never log or transmit utterance text"). Findings from live
   sessions enter as *paraphrased* seeds.
2. **The corpus author should not be the person who wrote the prompt.** M4
   recorded the cost of skipping this: exploratory testing found six vocabulary
   gaps the test table missed, because the table and the implementation had the
   same author.
3. **Label to the correct answer, not to current behaviour.** Two Hinglish cases
   are labelled to an answer the vocabulary does not currently produce, so they
   surface as measured failures. Labelling them to current behaviour would bake a
   gap into the baseline as though it were correct.
4. **Never move a case into `ambiguous` after seeing a score.** If ambiguous
   cases could absorb inconvenient results, a threshold could be met by
   relabelling instead of by changing behaviour. Corpus review happens *before*
   any run.
5. **Utterances must be unique across the whole corpus.** A duplicate would be
   scored twice and silently weight one phrasing double. The loader rejects it.

## Integrity checks that run automatically

`test/evals/corpus.test.js` asserts, against the **real** registry and the
**real** safety guard:

- every `actionId` is a registered capability, every named slot is a real slot
- every `stated` value would be accepted by the action's own `paramSchema`
- every `askSlot` is required and has an `ask` string
- emergency labels match `detectEmergency` **in both directions** — a case
  claiming `emergency_detected` must trip the guard, and one not claiming it must
  not
- `hi` cases contain Devanagari; `hinglish` cases do not
- only `ambiguous` cases carry an `acceptable` set
- every Devanagari command that names no language lists `language` in `notStated`,
  so it cannot silently opt out of the language-trap hard gate
