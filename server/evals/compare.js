#!/usr/bin/env node
// Run comparison CLI (Milestone M7a).
//
//   node evals/compare.js runs/<before> runs/<after>
//
// Prints a flip table: which cases were FIXED, which were BROKEN, and only then
// what happened to the aggregate. Exits 1 when a case in a blocking stratum
// broke or a hard gate regressed — a net-positive precision change does not
// rescue a newly-broken emergency case.

const fs = require('fs');
const path = require('path');

const { compareRuns, renderComparison, baselineAsRun, restrictToIds } = require('./lib/compare');
const { loadFrozenBaseline, splitCorpus } = require('./lib/baselines');
const { loadCorpus } = require('./lib/loadCorpus');

function loadRun(dir) {
  const file = path.join(dir, 'results.json');
  if (!fs.existsSync(file)) {
    throw new Error(`No results.json in ${dir} — is that a run directory?`);
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { scored: parsed.cases, metrics: parsed.metrics };
}

const USAGE = `usage:
  node evals/compare.js <before-run-dir> <after-run-dir> [--half dev|holdout]
  node evals/compare.js --frozen <after-run-dir> [--half dev|holdout]

--frozen compares against the TRACKED M7a baseline artifact rather than a run
directory, so it still works on a fresh clone (runs/ is gitignored).
--half restricts BOTH sides to the same corpus half, for dev iteration.
`;

function main() {
  const argv = process.argv.slice(2);

  let half = 'all';
  const halfIndex = argv.indexOf('--half');
  if (halfIndex !== -1) {
    half = argv[halfIndex + 1];
    argv.splice(halfIndex, 2);
  }

  const useFrozen = argv[0] === '--frozen';
  if (useFrozen) argv.shift();
  const [beforeArg, afterArg] = useFrozen ? [null, argv[0]] : argv;

  if (!afterArg || (!useFrozen && !beforeArg)) {
    process.stderr.write(USAGE);
    return 2;
  }

  const corpus = loadCorpus();
  let before = useFrozen ? baselineAsRun(loadFrozenBaseline(), corpus) : loadRun(beforeArg);
  let after = loadRun(afterArg);

  // Both sides are restricted to the SAME ids, so a dev-half comparison can
  // never accidentally score a dev run against the full-corpus reference.
  if (half !== 'all') {
    const selected = splitCorpus(corpus, { half });
    const ids = new Set([...selected.cases, ...selected.sessions].map((entry) => entry.id));
    before = restrictToIds(before, ids);
    after = restrictToIds(after, ids);
    process.stdout.write(`(restricted to the ${half} half: ${ids.size} cases)\n\n`);
  }

  const comparison = compareRuns(before, after);
  process.stdout.write(`${renderComparison(comparison)}\n`);
  return comparison.verdict === 'ok' ? 0 : 1;
}

try {
  process.exit(main());
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
}
