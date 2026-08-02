// Run-to-run comparison (Milestone M7a).
//
// THE OUTPUT IS A FLIP TABLE, NOT A DELTA, and the aggregate is printed LAST.
//
// "Precision went from 91.4% to 92.9%" is the least useful true sentence
// available about a change: it is equally consistent with three cases fixed and
// with four fixed and three broken. A net-positive aggregate that broke a
// previously-working case is a regression, and only a per-case comparison can
// see it. So FIXED and BROKEN come first, by case id, and the percentages come
// after them as context.
//
// Any BROKEN case in the emergency, adversarial or language-trap strata fails
// the comparison outright, regardless of what the aggregate did.

const BLOCKING_STRATA = Object.freeze(['emergency', 'adversarial']);

const idOf = (entry) => (entry.turn ? `${entry.caseId}#${entry.turn}` : entry.caseId);

/**
 * Adapt a promoted baseline into the shape `compareRuns` consumes.
 *
 * The baseline artifact is TRACKED and the run directories are gitignored, so
 * the frozen M7a reference has to be readable from the baseline itself or it
 * would not survive a fresh clone. `verdicts` carries exactly what a flip table
 * needs; `stratum` comes from the corpus, which is also tracked and frozen.
 */
function baselineAsRun(baseline, corpus) {
  const stratumById = new Map();
  for (const entry of corpus.cases) stratumById.set(entry.id, entry.stratum);
  for (const session of corpus.sessions) stratumById.set(session.id, 'memory');

  return {
    metrics: {
      routing: {
        precision: { n: baseline.counts.precisionHits, of: baseline.counts.routed, pct: null },
        recall: { n: baseline.counts.recallHits, of: baseline.counts.labelledActions, pct: null },
      },
      hardGates: Object.fromEntries(
        Object.entries(baseline.hardGates).map(([name, pass]) => [name, { pass, offenders: [] }])
      ),
    },
    scored: baseline.verdicts.map((entry) => {
      const [caseId, turn] = entry.id.split('#');
      return {
        caseId,
        turn: turn ? Number(turn) : null,
        stratum: stratumById.get(caseId) || 'unknown',
        verdict: entry.verdict,
        actual: { decision: entry.decision, actionId: entry.actionId },
      };
    }),
  };
}

/** Restrict both sides of a comparison to the same corpus half. */
function restrictToIds(run, allowedIds) {
  return {
    metrics: run.metrics,
    scored: run.scored.filter((entry) => allowedIds.has(entry.caseId)),
  };
}
const isGood = (verdict) => verdict === 'correct' || verdict === 'acceptable' || verdict === 'correct_action_wrong_decision';

/**
 * Compare two scored runs.
 *
 * @param {{scored: object[], metrics: object}} before
 * @param {{scored: object[], metrics: object}} after
 */
function compareRuns(before, after) {
  const beforeById = new Map(before.scored.map((entry) => [idOf(entry), entry]));
  const afterById = new Map(after.scored.map((entry) => [idOf(entry), entry]));

  const fixed = [];
  const broken = [];
  const changed = [];
  const unchanged = [];
  const added = [];
  const removed = [];

  // Iterate the AFTER run in its own (corpus) order so the report is stable.
  for (const entry of after.scored) {
    const id = idOf(entry);
    const previous = beforeById.get(id);
    if (!previous) {
      added.push(id);
      continue;
    }

    const wasGood = isGood(previous.verdict);
    const isNowGood = isGood(entry.verdict);

    if (!wasGood && isNowGood) {
      fixed.push({ id, stratum: entry.stratum, from: previous.verdict, to: entry.verdict });
    } else if (wasGood && !isNowGood) {
      broken.push({ id, stratum: entry.stratum, from: previous.verdict, to: entry.verdict });
    } else if (previous.verdict !== entry.verdict || previous.actual.actionId !== entry.actual.actionId) {
      changed.push({ id, stratum: entry.stratum, from: previous.verdict, to: entry.verdict });
    } else {
      unchanged.push(id);
    }
  }

  for (const entry of before.scored) {
    if (!afterById.has(idOf(entry))) removed.push(idOf(entry));
  }

  const blockingBreaks = broken.filter((entry) => BLOCKING_STRATA.includes(entry.stratum));

  // A hard gate that was passing and now is not, is its own blocking event.
  const gateRegressions = Object.entries(after.metrics.hardGates)
    .filter(([name, gate]) => !gate.pass && before.metrics.hardGates[name]?.pass)
    .map(([name]) => name);

  return {
    fixed,
    broken,
    changed,
    added,
    removed,
    unchanged: unchanged.length,
    blockingBreaks,
    gateRegressions,
    verdict: blockingBreaks.length === 0 && gateRegressions.length === 0 ? 'ok' : 'blocked',
    aggregate: {
      precision: { before: before.metrics.routing.precision, after: after.metrics.routing.precision },
      recall: { before: before.metrics.routing.recall, after: after.metrics.routing.recall },
    },
  };
}

/** Render a comparison as text. Fixed and broken first; the aggregate last. */
function renderComparison(comparison) {
  const lines = [];
  const pct = (r) => (r.pct === null ? 'n/a' : `${r.pct.toFixed(1)}% (${r.n}/${r.of})`);

  lines.push(`FIXED     ${String(comparison.fixed.length).padStart(3)}`);
  for (const entry of comparison.fixed) lines.push(`  + ${entry.id}  ${entry.from} -> ${entry.to}`);

  lines.push(`BROKEN    ${String(comparison.broken.length).padStart(3)}`);
  for (const entry of comparison.broken) {
    const flag = BLOCKING_STRATA.includes(entry.stratum) ? '  ** BLOCKING **' : '';
    lines.push(`  - ${entry.id}  ${entry.from} -> ${entry.to}${flag}`);
  }

  if (comparison.changed.length > 0) {
    lines.push(`CHANGED   ${String(comparison.changed.length).padStart(3)}  (still correct, different route)`);
    for (const entry of comparison.changed) lines.push(`  ~ ${entry.id}  ${entry.from} -> ${entry.to}`);
  }
  if (comparison.added.length > 0) lines.push(`ADDED     ${comparison.added.length}  ${comparison.added.join(', ')}`);
  if (comparison.removed.length > 0) lines.push(`REMOVED   ${comparison.removed.length}  ${comparison.removed.join(', ')}`);
  if (comparison.gateRegressions.length > 0) {
    lines.push(`HARD GATE REGRESSION: ${comparison.gateRegressions.join(', ')}  ** BLOCKING **`);
  }

  lines.push(`UNCHANGED ${String(comparison.unchanged).padStart(3)}`);
  lines.push('');
  lines.push(`precision ${pct(comparison.aggregate.precision.before)} -> ${pct(comparison.aggregate.precision.after)}`);
  lines.push(`recall    ${pct(comparison.aggregate.recall.before)} -> ${pct(comparison.aggregate.recall.after)}`);
  lines.push('');
  lines.push(`VERDICT: ${comparison.verdict.toUpperCase()}`);

  return lines.join('\n');
}

module.exports = { BLOCKING_STRATA, compareRuns, renderComparison, idOf, isGood, baselineAsRun, restrictToIds };
