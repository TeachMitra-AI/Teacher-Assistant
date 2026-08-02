// Run orchestration (Milestone M7a).
//
// Two modes, and the difference between them is stated plainly because
// conflating them is how a team concludes that quality is monitored when it is
// actually frozen:
//
//   live   — real network, real model. NOT deterministic (temperature, and a
//            floating model alias). This is the mode that MEASURES QUALITY.
//   replay — recorded upstream responses. Bit-for-bit deterministic, free,
//            offline. This is the mode that catches PIPELINE REGRESSIONS. It
//            does not measure the model, and a green replay run is not evidence
//            that the router is good.
//
// REPLAY ALWAYS EXECUTES THE COMPLETE CORPUS. Filtering is refused outright in
// replay mode rather than merely discouraged: a CI gate that can be narrowed is
// a CI gate that will be narrowed on the first inconvenient morning, and a
// partial run reports metrics whose denominators silently changed.

const { execSync } = require('child_process');

const { loadCorpus } = require('./loadCorpus');
const { createRunContext, runSingle, runSession } = require('./runCase');
const { createRecorder, createReplayer, saveCassettes } = require('./cassette');
const { score } = require('./score');
const { splitCorpus } = require('./baselines');

/**
 * Minimum spacing between upstream calls in live mode, in milliseconds.
 *
 * NOT a workaround — a requirement. The first smoke run of this harness fired 64
 * calls in 34 seconds, tripped the upstream per-minute limit, and reported 22
 * consecutive `classifier_error` turns. Those were scored as false negatives and
 * would have gone into a baseline as a model-quality result. An eval runner that
 * saturates the rate limiter measures the rate limiter.
 *
 * ~4.2 s spaces requests at roughly 14/minute, inside the usual 15 RPM free-tier
 * allowance with headroom for gemini.js's own retry. Override with --pace-ms on
 * a key with a higher quota.
 */
const DEFAULT_PACE_MS = 4200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Short git sha, or null outside a repository. Never fatal. */
function gitSha() {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/** Apply `--filter stratum=commands,language=hinglish`. Live mode only. */
function applyFilter(entries, filter) {
  if (!filter) return entries;
  const criteria = Object.fromEntries(
    filter
      .split(',')
      .map((pair) => pair.split('='))
      .filter((parts) => parts.length === 2)
      .map(([key, value]) => [key.trim(), value.trim()])
  );
  return entries.filter((entry) =>
    Object.entries(criteria).every(([key, value]) => String(entry[key]) === value || entry.id === value)
  );
}

/**
 * Execute the corpus.
 *
 * @param {object} options
 * @param {'live'|'replay'} options.mode
 * @param {boolean} [options.record] live only — write cassettes from this run
 * @param {number} [options.repeat] live only — passes per case, for a variance band
 * @param {string} [options.filter] live only — refused in replay mode
 * @param {number} [options.maxCalls] cost circuit breaker
 */
async function runCorpus({
  mode = 'replay',
  record = false,
  repeat = 1,
  filter = null,
  maxCalls = Infinity,
  paceMs,
  half = 'all',
  cassetteFile,
  onProgress = () => {},
} = {}) {
  if (mode === 'replay' && half !== 'all') {
    throw new Error(
      'Replay mode refuses --half: the CI gate must always execute the complete corpus. ' +
        'Use --mode live to iterate on a half.'
    );
  }
  if (mode === 'replay' && filter) {
    throw new Error(
      'Replay mode refuses --filter: the CI gate must always execute the complete corpus. ' +
        'Use --mode live to explore a subset.'
    );
  }
  if (mode === 'replay' && record) {
    throw new Error('Replay mode cannot record — there is no upstream to record from.');
  }
  if (mode !== 'live' && mode !== 'replay') {
    throw new Error(`Unknown mode "${mode}". Expected "live" or "replay".`);
  }

  const corpus = loadCorpus();
  const startedAt = new Date().toISOString();

  const seam =
    mode === 'live'
      ? createRecorder({})
      : createReplayer(cassetteFile ? { file: cassetteFile } : {});

  // Spacing between TURNS, never inside the fetch seam: a sleep inside the seam
  // sits inside gemini.js's 5 s total deadline and starves the real call.
  // Retries within one request are deliberately unpaced — they are already
  // bounded by maxCallsPerRequest and by the deadline.
  const paceInterval = mode === 'live' ? (paceMs ?? DEFAULT_PACE_MS) : 0;
  let nextAllowedAt = 0;
  const pace =
    paceInterval > 0
      ? async () => {
          const wait = nextAllowedAt - Date.now();
          if (wait > 0) await sleep(wait);
          nextAllowedAt = Date.now() + paceInterval;
        }
      : null;

  const context = createRunContext({ fetchImpl: seam.fetchImpl });

  // The dev/holdout split is applied BEFORE any filter, and it is a filter over
  // the frozen corpus files rather than a change to them (decision D7).
  const selected = splitCorpus(corpus, { half });
  const cases = applyFilter(selected.cases, filter);
  const sessions = applyFilter(selected.sessions, filter);

  if (cases.length === 0 && sessions.length === 0) {
    throw new Error(`Filter "${filter}" matched no cases. Refusing to report on an empty run.`);
  }

  const passes = [];
  const effectiveRepeat = mode === 'live' ? Math.max(1, repeat) : 1;
  let totalCalls = 0;

  for (let pass = 0; pass < effectiveRepeat; pass += 1) {
    const results = [];

    // Corpus order, always. Never sorted, never parallel — a stable line per
    // case in every artifact is what makes two runs diffable.
    for (const testCase of cases) {
      if (totalCalls >= maxCalls) break;
      const produced = await runSingle({ context, seam, testCase, pace });
      totalCalls += produced.reduce((sum, entry) => sum + entry.classifierCalls, 0);
      results.push(...produced);
      onProgress({ pass, id: testCase.id, done: results.length, total: cases.length + sessions.length });
    }

    for (const session of sessions) {
      if (totalCalls >= maxCalls) break;
      const produced = await runSession({ context, seam, session, pace });
      totalCalls += produced.reduce((sum, entry) => sum + entry.classifierCalls, 0);
      results.push(...produced);
      onProgress({ pass, id: session.id, done: results.length, total: cases.length + sessions.length });
    }

    passes.push(results);
  }

  // A cassette miss must never become a score. The throw inside the seam is
  // caught by interpret.js's total catch and reported as `classifier_error`, so
  // the run would otherwise finish "successfully" with the missing cases counted
  // as model failures. Checked here, after the run, so the error names every
  // missing case at once rather than one per re-run.
  if (seam.state.misses && seam.state.misses.length > 0) {
    const listed = seam.state.misses
      .map((miss) => `${miss.caseId}${miss.turn ? `#${miss.turn}` : ''}`)
      .join(', ');
    throw new Error(
      `${seam.state.misses.length} cassette miss(es) — the run is INVALID and no metrics are reported: ` +
        `${listed}. Re-record those cases (--mode live --record --filter id=<case>) or re-record the ` +
        'whole corpus if the prompt changed.'
    );
  }

  const budgetExhausted = totalCalls >= maxCalls;

  // Metrics come from the FIRST pass. Later passes exist to measure how stable
  // the model is, not to be averaged into a number that no single run produced.
  const { scored, metrics } = score(passes[0]);

  // Per-case agreement across passes — the variance band a single live run
  // against a floating alias cannot provide on its own.
  let stability = null;
  if (passes.length > 1) {
    const flips = [];
    for (let index = 0; index < passes[0].length; index += 1) {
      const verdicts = passes.map((pass) => {
        const entry = pass[index];
        return entry ? `${entry.actual.decision}/${entry.actual.actionId}` : 'missing';
      });
      if (new Set(verdicts).size > 1) {
        const entry = passes[0][index];
        flips.push({ id: entry.turn ? `${entry.caseId}#${entry.turn}` : entry.caseId, verdicts });
      }
    }
    stability = {
      passes: passes.length,
      flipped: flips.length,
      of: passes[0].length,
      cases: flips,
    };
  }

  if (mode === 'live' && record) {
    saveCassettes(seam.entries, cassetteFile ? { file: cassetteFile } : {});
  }

  const modelVersions = [...seam.state.modelVersions].sort();

  const meta = {
    mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    modelVersion: modelVersions.length === 1 ? modelVersions[0] : modelVersions.join(', ') || null,
    modelVersions,
    endpoint: context.endpoint,
    promptHash: context.promptHash,
    descriptorHash: context.descriptorHash,
    registryHash: context.registryHash,
    corpusHash: corpus.hash,
    corpusCounts: corpus.counts,
    gitSha: gitSha(),
    repeat: effectiveRepeat,
    paceMs: paceInterval,
    totalClassifierCalls: totalCalls,
    // Upstream HTTP status counts. A run whose `infra` attributions are really
    // rate limiting says so here instead of leaving the reader to guess.
    upstreamStatuses: seam.state.statuses,
    budgetExhausted,
    filtered: Boolean(filter),
    half,
    stability,
  };

  return { scored, metrics, meta, corpus, passes };
}

module.exports = { runCorpus, applyFilter, gitSha };
