// Baseline resolution and the dev/holdout split (Milestone M7b).
//
// ─── WHY THERE IS MORE THAN ONE BASELINE FILE ──────────────────────────────
// The M7a baseline is FROZEN (M7b decision D1): its counts, its cassettes and
// its corpus are the immutable reference every future change is compared
// against. But M7b changes the prompt, which changes `promptHash`, which changes
// every cassette key — so the frozen baseline cannot also be the thing CI
// asserts current code against. Those are two different jobs:
//
//   REFERENCE  — "what did the router do when we froze it?"  -> baseline.json,
//                never rewritten, used by compare.js
//   ACTIVE     — "does the current code still do what it did
//                when last recorded?"                        -> whichever
//                baseline file matches the current hashes
//
// So baselines are RESOLVED by hash rather than by filename. A run finds the
// baseline that describes the code it is running; if none matches, that is a
// loud failure, never a silent skip — the same rule the corpus loader and the
// cassette store follow.

const fs = require('fs');
const path = require('path');

const BASELINE_DIR = path.join(__dirname, '..', 'baselines');
const FROZEN_BASELINE = path.join(BASELINE_DIR, 'baseline.json');

/** Every baseline file on disk, newest-looking last for deterministic ties. */
function listBaselines({ dir = BASELINE_DIR } = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ file: path.join(dir, name), data: JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) }));
}

/** The frozen M7a reference. Throws if it is missing — it is not optional. */
function loadFrozenBaseline({ file = FROZEN_BASELINE } = {}) {
  if (!fs.existsSync(file)) {
    throw new Error(`The frozen M7a baseline is missing at ${file}. It is the reference for every comparison.`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Find the baseline describing the code that produced `meta`.
 *
 * Matched on all four provenance hashes, not just the prompt: a descriptor or
 * registry change with an unchanged preamble is still a different system, and a
 * corpus change makes the counts incomparable.
 */
function resolveActiveBaseline(meta, { dir = BASELINE_DIR } = {}) {
  const candidates = listBaselines({ dir });
  const match = candidates.find(
    ({ data }) =>
      data.promptHash === meta.promptHash &&
      data.descriptorHash === meta.descriptorHash &&
      data.registryHash === meta.registryHash &&
      data.corpusHash === meta.corpusHash
  );
  return match || null;
}

/**
 * Split the corpus into a dev half to iterate on and a holdout half to check
 * generalization against.
 *
 * ─── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * After M7b the corpus will have been both the tuning set and the test set.
 * Iterating prompts against the same turns we then report on makes the reported
 * numbers optimistic by an unknown amount, and no metric in the harness can
 * detect that. Splitting does not fix it — it makes it VISIBLE: if dev improves
 * far more than holdout, the gap is the overfitting.
 *
 * ─── HOW ───────────────────────────────────────────────────────────────────
 * Deterministic and stratified: within each (stratum, language) group, cases are
 * sorted by id and assigned alternately. No randomness and no seed, so the same
 * corpus always produces the same split and two runs are comparable.
 *
 * Sessions are split WHOLE. Their turns are dependent — memory threads through
 * them — so half a session would measure nothing.
 *
 * THIS DOES NOT MODIFY THE CORPUS (M7b decision D7). It is a filter over the
 * frozen files, computed at load time.
 */
function splitCorpus(corpus, { half = 'all' } = {}) {
  if (half === 'all') return { cases: corpus.cases, sessions: corpus.sessions };

  const assign = (entries) => {
    const groups = new Map();
    for (const entry of entries) {
      const key = `${entry.stratum}|${entry.language}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }

    const dev = [];
    const holdout = [];
    for (const group of [...groups.keys()].sort()) {
      const sorted = [...groups.get(group)].sort((a, b) => a.id.localeCompare(b.id));
      sorted.forEach((entry, index) => (index % 2 === 0 ? dev : holdout).push(entry));
    }
    return { dev, holdout };
  };

  const cases = assign(corpus.cases);
  const sessions = assign(corpus.sessions);

  if (half !== 'dev' && half !== 'holdout') {
    throw new Error(`Unknown corpus half "${half}". Expected "dev", "holdout" or "all".`);
  }

  const selected = { cases: cases[half], sessions: sessions[half] };
  if (selected.cases.length === 0) {
    throw new Error(`The "${half}" half is empty. Refusing to report on an empty run.`);
  }
  return selected;
}

module.exports = {
  BASELINE_DIR,
  FROZEN_BASELINE,
  listBaselines,
  loadFrozenBaseline,
  resolveActiveBaseline,
  splitCorpus,
};
