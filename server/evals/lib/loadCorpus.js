// Corpus loader. Its job is to fail loudly: a harness reporting 100% precision over an empty corpus looks like a
// working one in every artifact. A missing directory, unreadable file, malformed line, duplicate id, empty stratum
// or zero total is thrown, never warned about or skipped, since a check that silently matches nothing is worse than no check.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { caseSchema, sessionSchema, STRATA } = require('./caseSchema');

const CORPUS_DIR = path.join(__dirname, '..', 'corpus');

/**
 * Minimum case count per stratum, a floor and not a target, so deleting or emptying a corpus file fails a test
 * instead of quietly shrinking the baseline's coverage.
 */
const STRATUM_MINIMUMS = Object.freeze({
  commands: 60,
  coaching: 40,
  ambiguous: 10,
  emergency: 10,
  adversarial: 20,
  memory: 15, // sessions, not turns
});

/** Read one .jsonl file into parsed objects, with the line number on any error. */
function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const records = [];

  raw.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    // Blank lines separate groups for readability; `//` lines are section
    // headings inside a corpus file. Neither is data.
    if (trimmed === '' || trimmed.startsWith('//')) return;
    try {
      records.push({ record: JSON.parse(trimmed), line: index + 1 });
    } catch (error) {
      throw new Error(`${path.basename(filePath)}:${index + 1} is not valid JSON — ${error.message}`);
    }
  });

  return records;
}

/**
 * Load, validate and hash the whole corpus.
 *
 * @returns {{cases: object[], sessions: object[], hash: string, counts: Record<string, number>, files: string[]}}
 */
function loadCorpus({ dir = CORPUS_DIR } = {}) {
  if (!fs.existsSync(dir)) {
    throw new Error(`Corpus directory not found: ${dir}`);
  }

  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort(); // Deterministic file order -> deterministic case order.

  if (files.length === 0) {
    throw new Error(`No .jsonl corpus files in ${dir}. Refusing to score an empty corpus.`);
  }

  const cases = [];
  const sessions = [];
  const seenIds = new Set();
  const seenUtterances = new Map();

  for (const file of files) {
    const isSessionFile = file.startsWith('sessions.');
    for (const { record, line } of readJsonl(path.join(dir, file))) {
      const schema = isSessionFile ? sessionSchema : caseSchema;
      const parsed = schema.safeParse(record);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(
          `${file}:${line} (${record && record.id}) failed validation — ` +
            `${issue.path.join('.') || '(root)'}: ${issue.message}`
        );
      }

      const entry = parsed.data;
      if (seenIds.has(entry.id)) throw new Error(`${file}:${line} duplicate case id "${entry.id}"`);
      seenIds.add(entry.id);

      // A duplicate utterance would be scored twice and would silently weight
      // one phrasing double in the aggregate.
      const utterances = isSessionFile ? entry.turns.map((turn) => turn.utterance) : [entry.utterance];
      for (const utterance of utterances) {
        const key = utterance.normalize('NFKC').toLowerCase().trim();
        if (seenUtterances.has(key)) {
          throw new Error(
            `${file}:${line} duplicate utterance (also in ${seenUtterances.get(key)}): "${utterance}"`
          );
        }
        seenUtterances.set(key, entry.id);
      }

      entry.source = file;
      (isSessionFile ? sessions : cases).push(entry);
    }
  }

  const counts = {};
  for (const stratum of STRATA) counts[stratum] = 0;
  for (const entry of cases) counts[entry.stratum] += 1;
  counts.memory = sessions.length;

  if (cases.length === 0) {
    throw new Error('Corpus contains zero single-turn cases. Refusing to score an empty corpus.');
  }

  for (const [stratum, minimum] of Object.entries(STRATUM_MINIMUMS)) {
    if (counts[stratum] < minimum) {
      throw new Error(
        `Stratum "${stratum}" has ${counts[stratum]} cases, below the floor of ${minimum}. ` +
          'Shrinking the corpus is a deliberate act and must change STRATUM_MINIMUMS too.'
      );
    }
  }

  // Hashes the LABELS as well as the text, so relabelling a case invalidates a
  // baseline exactly as re-authoring one does.
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify([...cases, ...sessions].map(({ source: _s, ...rest }) => rest)))
    .digest('hex')
    .slice(0, 16);

  return { cases, sessions, hash, counts, files };
}

module.exports = { loadCorpus, readJsonl, CORPUS_DIR, STRATUM_MINIMUMS };
