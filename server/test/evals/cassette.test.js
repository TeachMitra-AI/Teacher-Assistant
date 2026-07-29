// Cassette record/replay (Milestone M7a).
//
// The tests here defend one property: A MISS IS NEVER SILENT. That is harder
// than it sounds, and the harness got it wrong first: interpret.js runs the
// pipeline inside a total catch and classifier.js maps any thrown error to a
// passthrough reason, so the miss error was swallowed and reported as
// `classifier_error` — a model-quality result. The throw alone is not the
// guarantee; the runner's post-run check is.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { keyFor, saveCassettes, loadCassettes, createReplayer } = require('../../evals/lib/cassette');

let tmpFile;

beforeEach(() => {
  tmpFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'evals-cassette-')), 'candidate.json');
});

afterEach(() => {
  try {
    fs.rmSync(path.dirname(tmpFile), { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

const body = (system, user, schema = { type: 'object' }) => ({
  systemInstruction: { parts: [{ text: system }] },
  contents: [{ role: 'user', parts: [{ text: user }] }],
  generationConfig: { responseSchema: schema },
});

const entry = (over = {}) => ({
  key: keyFor(body('SYS', 'utterance')),
  caseId: 'c.1',
  turn: null,
  utterance: 'utterance',
  modelVersion: 'test-model',
  status: 200,
  response: { candidates: [{ content: { parts: [{ text: '{}' }] } }], modelVersion: 'test-model' },
  ...over,
});

describe('cassette keys', () => {
  test('are stable for the same prompt', () => {
    expect(keyFor(body('SYS', 'u'))).toBe(keyFor(body('SYS', 'u')));
  });

  // This is what makes stale cassettes impossible to replay silently. Both the
  // system instruction and the response schema are registry-derived, so any
  // descriptor change invalidates every key at once.
  test('change when the system instruction changes', () => {
    expect(keyFor(body('SYS', 'u'))).not.toBe(keyFor(body('SYS-CHANGED', 'u')));
  });

  test('change when the response schema changes', () => {
    expect(keyFor(body('SYS', 'u', { type: 'object' }))).not.toBe(
      keyFor(body('SYS', 'u', { type: 'object', required: ['intent'] }))
    );
  });

  test('change when the utterance changes', () => {
    expect(keyFor(body('SYS', 'a'))).not.toBe(keyFor(body('SYS', 'b')));
  });
});

describe('saving', () => {
  // The M7a recording is frozen by decision D1 and the guard is enforced in
  // code rather than by discipline: a single careless --record would rewrite it
  // silently, and a re-recorded cassette still replays fine — it just no longer
  // describes the run the frozen thresholds were measured on.
  test('refuses to rewrite the frozen M7a cassette file', () => {
    expect(() => saveCassettes([entry()], { file: path.join(os.tmpdir(), 'classifier.json') })).toThrow(
      /FROZEN M7a recording/
    );
  });

  test('merges rather than overwriting, so a subset re-record keeps the rest', () => {
    saveCassettes([entry({ key: 'k1', caseId: 'a.1' })], { file: tmpFile });
    saveCassettes([entry({ key: 'k2', caseId: 'a.2' })], { file: tmpFile });
    const keys = loadCassettes({ file: tmpFile }).entries.map((e) => e.key);
    expect(keys.sort()).toEqual(['k1', 'k2']);
  });

  test('a deliberate re-record replaces the entry for the same key', () => {
    saveCassettes([entry({ key: 'k1', modelVersion: 'old' })], { file: tmpFile });
    saveCassettes([entry({ key: 'k1', modelVersion: 'new' })], { file: tmpFile });
    const stored = loadCassettes({ file: tmpFile }).entries;
    expect(stored).toHaveLength(1);
    expect(stored[0].modelVersion).toBe('new');
  });

  // A recorded 503 replays as a 503 forever — an upstream blip becomes a
  // permanent, deterministic "model failure". This happened during M7a's own
  // baseline recording, on coach.en.023.
  test('refuses to persist a non-2xx response', () => {
    saveCassettes([entry({ key: 'ok' }), entry({ key: 'bad', status: 503 })], { file: tmpFile });
    const keys = loadCassettes({ file: tmpFile }).entries.map((e) => e.key);
    expect(keys).toEqual(['ok']);
  });

  test('keeps the FIRST response per key within one run, so replay reproduces pass 1', () => {
    saveCassettes([entry({ key: 'k', modelVersion: 'first' }), entry({ key: 'k', modelVersion: 'second' })], {
      file: tmpFile,
    });
    expect(loadCassettes({ file: tmpFile }).entries[0].modelVersion).toBe('first');
  });
});

describe('replaying', () => {
  test('returns the recorded response for a known key', async () => {
    saveCassettes([entry()], { file: tmpFile });
    const replayer = createReplayer({ file: tmpFile });
    const response = await replayer.fetchImpl('http://ignored', {
      body: JSON.stringify(body('SYS', 'utterance')),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).modelVersion).toBe('test-model');
  });

  test('THROWS on a miss and records it — never a default, never a skip', async () => {
    saveCassettes([entry()], { file: tmpFile });
    const replayer = createReplayer({ file: tmpFile });
    replayer.state.caseId = 'c.99';

    await expect(
      replayer.fetchImpl('http://ignored', { body: JSON.stringify(body('SYS', 'never recorded')) })
    ).rejects.toThrow(/CASSETTE MISS/);

    // The recorded miss is what survives interpret.js's total catch, which
    // would otherwise turn this into a `classifier_error` score.
    expect(replayer.state.misses).toHaveLength(1);
    expect(replayer.state.misses[0].caseId).toBe('c.99');
  });

  test('refuses to construct against an empty store', () => {
    saveCassettes([], { file: tmpFile });
    expect(() => createReplayer({ file: tmpFile })).toThrow(/No cassettes/);
  });
});
