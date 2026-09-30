// The CI gate. It replays the complete corpus against recorded upstream responses and asserts the promoted baseline
// exactly: free, offline, deterministic, no API key.
// It measures the pipeline (the code still turns the same model output into the same decisions, slots, provenance and
// policy outcomes), not the model, and a green run isn't evidence the router is good. A flaky paid gate gets disabled
// within a month, so this is the deterministic half, and the corpus and runner live outside test/ so the paid half never blocks a PR.
// Exact match, no tolerance band: replay is deterministic, so any drift is a real change, and a band only hides
// regressions. When a change is intended, the same pull request re-promotes the baseline so a reviewer sees both together.
// Always the complete corpus: `runCorpus` refuses `--filter` in replay mode, since a gate that can be narrowed will
// be, and a partial run reports metrics whose denominators silently changed.

const fs = require('fs');
const path = require('path');

const { runCorpus } = require('../../evals/lib/runner');
const { loadCorpus } = require('../../evals/lib/loadCorpus');

const { resolveActiveBaseline } = require('../../evals/lib/baselines');

// 194 turns of arithmetic and in-memory lookups. It has its own timeout rather than relying on the 15 s default, so a slow machine fails honestly instead of flakily.
const TIMEOUT_MS = 60000;

describe('replay CI gate', () => {
  let run;
  let corpus;

  beforeAll(async () => {
    corpus = loadCorpus();
    run = await runCorpus({ mode: 'replay' });
  }, TIMEOUT_MS);

  test('executes the COMPLETE corpus — every case, every turn', () => {
    const expectedTurns =
      corpus.cases.length + corpus.sessions.reduce((sum, session) => sum + session.turns.length, 0);
    expect(run.scored).toHaveLength(expectedTurns);
    expect(run.metrics.totals.turns).toBe(expectedTurns);
    expect(run.meta.filtered).toBe(false);
  });

  test('refuses to run a filtered replay', async () => {
    await expect(runCorpus({ mode: 'replay', filter: 'stratum=commands' })).rejects.toThrow(
      /complete corpus/
    );
  });

  test('refuses to record in replay mode', async () => {
    await expect(runCorpus({ mode: 'replay', record: true })).rejects.toThrow(/cannot record/);
  });

  test('is deterministic — a second run produces identical verdicts', async () => {
    const again = await runCorpus({ mode: 'replay' });
    const verdicts = (r) => r.scored.map((entry) => `${entry.caseId}#${entry.turn}:${entry.verdict}`);
    expect(verdicts(again)).toEqual(verdicts(run));
  }, TIMEOUT_MS);

  test('every hard gate passes', () => {
    for (const [name, gate] of Object.entries(run.metrics.hardGates)) {
      expect(gate.pass, `${name}: ${gate.offenders.join(', ')}`).toBe(true);
    }
  });

  // Guards the finding that the emergency short-circuit is English-only: the seven guard-tripping cases must cost zero
  // upstream calls, evidenced by a call count, not an assertion about intent.
  test('guard-tripping emergency cases reach the classifier zero times', () => {
    const guarded = run.scored.filter(
      (entry) => entry.expected.passthroughReason === 'emergency_detected'
    );
    expect(guarded.length).toBeGreaterThanOrEqual(7);
    for (const entry of guarded) {
      expect(entry.classifierCalls, entry.caseId).toBe(0);
    }
  });

  describe('against the ACTIVE baseline', () => {
    // Resolved by hash, not filename: later prompt changes alter every cassette key, so the frozen baseline can't also be
    // what CI asserts current code against (see evals/lib/baselines.js). A run finds the baseline describing the code it
    // runs, and no match is a loud failure, never a silent skip.
    let baseline;

    test('a baseline exists that describes the current prompt, descriptors and corpus', () => {
      const match = resolveActiveBaseline(run.meta);
      expect(
        match,
        `No baseline matches promptHash=${run.meta.promptHash} descriptorHash=${run.meta.descriptorHash} ` +
          `registryHash=${run.meta.registryHash} corpusHash=${run.meta.corpusHash}. ` +
          'Record and promote one (--mode live --record --cassette-file ... --promote ...).'
      ).not.toBeNull();
      baseline = match.data;
    });

    test('every count matches exactly', () => {
      expect({
        turns: run.metrics.totals.turns,
        routed: run.metrics.totals.routed,
        labelledActions: run.metrics.totals.labelledActions,
        precisionHits: run.metrics.routing.precision.n,
        recallHits: run.metrics.routing.recall.n,
        exactDecisions: run.metrics.routing.decisionAccuracy.n,
        falsePositives: run.metrics.falsePositives.total,
        falseNegatives: run.metrics.falseNegatives.total,
        ambiguousAgreement: run.metrics.ambiguousBucket.agreement.n,
        topicExact: run.metrics.topic.verdicts.exact,
        memoryInheritanceCorrect: run.metrics.memory.inheritanceCorrectness.n,
        memoryStale: run.metrics.memory.staleness.n,
      }).toEqual(baseline.counts);
    });

    // Per-case rather than per-total, so a net-neutral change (one case fixed,
    // one broken) still fails and names both.
    test('every individual case verdict matches', () => {
      const actual = run.scored.map((entry) => ({
        id: entry.turn ? `${entry.caseId}#${entry.turn}` : entry.caseId,
        verdict: entry.verdict,
        decision: entry.actual.decision,
        actionId: entry.actual.actionId,
      }));
      expect(actual).toEqual(baseline.verdicts);
    });

    test('the recorded model version is still what the baseline was taken on', () => {
      // Informational rather than blocking: the endpoint is a floating alias and
      // the cassettes are fixed, so this can only change on a re-record.
      expect(run.meta.modelVersion).toBe(baseline.modelVersion);
    });
  });
});
