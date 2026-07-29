# `server/evals/` — classification quality corpus and harness

**Milestone M7a (harness + frozen baseline) and M7b (tuning).**

> **Outside `test/` on purpose** (spec §10.5). The live corpus is
> non-deterministic, costs money and needs a real key. A flaky paid gate gets
> disabled within a month, leaving no evals at all.
>
> What *is* in `test/` is a thin **pipeline-regression** gate
> (`test/evals/replay.test.js`) that replays recorded responses. It measures the
> CODE, never the model.

## The two modes, and why the difference matters

| Mode | Deterministic | Needs a key | Measures |
|---|---|---|---|
| `live` | **No** — temperature 0.7, floating model alias | Yes | **Model quality.** The mode that produces a baseline |
| `replay` | **Yes**, bit-for-bit | No | **Pipeline regressions.** Free, offline, CI-safe |

**A green replay run is not evidence that the router is good.** It is evidence
that the code still turns the same model output into the same decisions.
Conflating the two is how a team concludes quality is monitored when it is
frozen.

## Running it

```bash
npm run eval:replay                 # offline, free, deterministic. Start here.
npm run eval -- --half dev          # iterate on half the corpus (live only)
node evals/compare.js --frozen runs/<dir> --half dev   # flip table vs frozen M7a
npm run eval -- --record            # live baseline pass, writes cassettes
npm run eval -- --filter stratum=commands,language=hinglish
npm run eval -- --max-calls 200     # cost circuit breaker
node evals/run.js --mode replay --promote evals/baselines/<name>.json
node evals/compare.js runs/<before> runs/<after> # flip table
```

Exit codes: `0` hard gates pass · `1` a hard gate failed · `2` the run could not
complete (invalid corpus, cassette miss, no key). **Quality thresholds never
affect the exit code**. The frozen M7a routing numbers are **regression
references governed by the flip table**, not pass/fail gates (M7b decision D2):
fixing a degeneration bug legitimately enlarges the `routed` denominator and can
lower precision while improving the router. The five safety gates are absolute.

### Quota, and why a variance band is hard here

The free tier allows **500 requests/day** for this model
(`GenerateRequestsPerDayPerProjectPerModel-FreeTier`) on top of the per-minute
limit. A single full-corpus pass costs ~200. M7b exhausted the daily quota and
**could not take a `--repeat 3` variance band** — the second attempt returned
126/126 × HTTP 429. Budget the day before planning repeats, and check
`upstreamStatuses` in `run.json` on every run: a wall of 429s scores as model
failure unless you look.

### Live runs are paced, and lowering that is a trap

Default `--pace-ms 4200` (~14 requests/minute). The first unpaced run of this
harness fired 64 calls in 34 seconds, tripped the upstream limit, and scored 22
consecutive rate-limit failures as model false negatives. **An eval runner that
saturates the rate limiter measures the rate limiter.** A full 194-turn pass
takes ~14 minutes.

Note the interaction with `--repeat`: pacing is per TURN, and gemini.js may retry
inside one turn, so N passes cost more than N x the per-turn rate. Raise
`--pace-ms` for repeat runs or they trip the limiter — M7b's first variance
attempt did exactly that and had to be discarded.

## Running evals while the feature is rolled out (M10)

**The corpus and the teachers draw on the same Gemini quota.** A full live pass
costs ~200 requests against a 500/day free-tier ceiling, and an unpaced pass will
trip the CHANGE-8 breaker — which pauses routing **for every tenant** until the
cooldown elapses (the breaker is global by design; security review F7).

**Never start a live run during a rollout stage's teaching hours.**

| Gate | Run |
|---|---|
| Before any deploy | `npm run eval:replay` — offline, free, deterministic. Must be green |
| Before Stage 1 (team) | `npm run eval -- --half dev` — live, ~100 calls, outside teaching hours |
| Before Stage 2 (pilot) | replay only, unless something changed |
| Before Stage 3 (all teachers) | one full live pass, recorded, compared via `compare.js --frozen` |

The corpus, the cassettes and both baselines are **frozen for the whole rollout**
— M10 changes no prompt, descriptor, vocabulary or threshold, so a live run
during it is a *measurement*, never an input to a change. Tuning resumes only in
the post-rollout tuning milestone.

## Layout

| Path | What it is |
|---|---|
| `corpus/*.jsonl` | The labelled corpus. **Tracked.** See `corpus/SCHEMA.md` |
| `cassettes/*.json` | Recorded upstream responses. **Tracked** — replay must work on a fresh clone with no key. Every file in the directory is loaded and merged; keys are prompt-derived so recordings from different prompts cannot collide. **`classifier.json` is the FROZEN M7a recording and cannot be rewritten** |
| `baselines/baseline.json` | The **frozen M7a reference**, never overwritten. `compare.js --frozen` reads it |
| `baselines/m7b.json` | The **active** baseline after M7b. Baselines are resolved BY HASH, not by filename — see `lib/baselines.js` |
| `baselines/BASELINE.md` | The human-readable M7a baseline record (spec §10.5) |
| `golden_failures.md` | Recurring failure classes, when each was first seen, and its M7b outcome |
| `TUNING_LOG.md` | Every M7b candidate, **accepted and rejected**, with its numbers |
| `runs/` | Per-run artifacts. **Gitignored** |
| `lib/` | Loader, case schema, cassette seam, runner, scorer, reporters, compare |

## How it hooks into the app

The runner calls **`interpret()` directly** — no Express, no auth, no rate
limiter, no database. `interpret.js` was built database-free via injected
dependencies precisely so this is possible. Consequence: the 500-character
envelope limit is a route-level check and is **not** exercised here.

Recording and replay happen at **`GeminiService`'s existing `fetchImpl` seam**,
so no production file was modified — including `gemini.js`, which is protected.
Three things follow:

1. Replay exercises `gemini.js`, `classifier.js`, `proposalSchema.js`,
   `resolver.js` and `policy.js` **for real**. Only the socket is substituted.
2. `modelVersion` is capturable — it is in the response body, not in `metrics`.
3. The interception is one condition, named.

## Provenance recorded on every run

| Hash | Changes when |
|---|---|
| `modelVersion` | The floating alias resolves to a different model |
| `promptHash` | The system instruction changes (preamble **or** any descriptor) |
| `descriptorHash` | What the classifier is told the app can do changes |
| `registryHash` | The **authorization** surface changes — ids, effects, roles, flags, `autoExecute` |

A run whose `modelVersion` differs from the baseline's is stamped **MODEL DRIFT**
in its summary, so a score change is not misattributed to the last prompt edit.

## Failure modes this harness refuses to have

These are guarantees, each with a test, each proven to fail on an injected
defect:

- **An empty or shrunken corpus throws.** A harness reporting 100% over zero
  cases is indistinguishable from a working one in every artifact it produces.
- **A cassette miss invalidates the entire run.** The throw alone is not enough:
  `interpret.js` runs inside a total catch and maps any error to a passthrough
  reason, so a miss was originally scored as `classifier_error`. The runner
  therefore checks for recorded misses after the run and refuses to report.
- **A non-2xx response is never recorded.** A stored 503 replays forever as a
  deterministic model failure.
- **Replay cannot be filtered.** A gate that can be narrowed will be narrowed.
- **Stale cassettes cannot be replayed silently.** The key is derived from the
  prompt and the response schema, both registry-derived, so any descriptor change
  invalidates every key at once.

## Re-baselining

1. Change the code / prompt / registry.
2. `npm run eval -- --record --cassette-file evals/cassettes/<name>.json`
   (live, paced). **Review every failure by hand** — and check `upstreamStatuses`
   before believing any of them.
3. `node evals/run.js --mode replay --promote evals/baselines/<name>.json`.
   The frozen `baseline.json` is refused as a target.
4. `node evals/compare.js --frozen runs/<dir>` and account for **every** BROKEN
   case individually.
5. Commit the new cassettes, the new baseline and the `TUNING_LOG.md` entry **in
   the same pull request as the change**, so a reviewer sees the code change and
   the number change together.

**Never hand-edit a cassette.** It would let someone improve the model's answer.

## What this harness does NOT cover

Repeat cache · circuit breaker · stale-response guard · draft store · Generator
prefill · chip-answer completion — all client runtime, covered by the 312 client
tests and the M6 manual script. Rate limits, budget, auth and the rollout gate
are M9's surface and are covered by the server suite.
