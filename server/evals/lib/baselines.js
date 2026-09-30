// Baseline resolution and the dev/holdout split.
// There's more than one baseline file because the original (frozen) baseline is the immutable reference for
// compare.js, but later prompt changes alter `promptHash` and so every cassette key, so it can't also be what CI
// asserts current code against. Baselines are resolved by hash, not filename: a run finds the baseline describing the
// code it runs, and no match is a loud failure, never a silent skip.

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

/** The frozen original reference. Throws if missing; it isn't optional. */
function loadFrozenBaseline({ file = FROZEN_BASELINE } = {}) {
  if (!fs.existsSync(file)) {
    throw new Error(`The frozen M7a baseline is missing at ${file}. It is the reference for every comparison.`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/**
 * Find the baseline describing the code that produced `meta`. It matches all four provenance hashes, not just
 * the prompt: a descriptor or registry change is a different system, and a corpus change makes counts incomparable.
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
 * Split the corpus into a dev half to iterate on and a holdout half to check generalization.
 * Tuning prompts against the same turns we report on makes the numbers optimistic by an unknown amount; the split
 * makes that visible, since a dev improvement far above holdout is the overfitting.
 * It's deterministic and stratified: within each (stratum, language) group, cases are sorted by id and assigned
 * alternately, with no randomness, so the same corpus always gives the same split. Sessions are split whole, since
 * their turns are dependent (memory threads through them). This doesn't modify the corpus; it's a filter applied at load time.
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
