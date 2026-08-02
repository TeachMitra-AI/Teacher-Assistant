// Vocabulary drift guard — CHANGE-11, pair C (Milestone M4).
//
// M4 creates the first SERVER-side copy of three lists that until now existed
// only in client/src/config.ts: GRADES, SUBJECTS and the LANGUAGES codes. The
// duplication is deliberate and documented (CommonJS server vs ESM client; a
// shared package would need a monorepo restructure larger than this project),
// and spec §8.4 accepts it for Phase 1 with mandatory cross-referencing
// comments. This file converts that convention into a control, exactly as
// M2 did for the two pairs before it.
//
//   Pair A  server/src/assistant/contracts.js <-> client/src/assistant/types.ts
//   Pair B  server/src/actions/schemas/generateAssessment.js <-> client/src/config.ts
//   Pair C  server/src/actions/vocab/* <-> client/src/config.ts        <- HERE
//
// Pairs A and B are guarded by test/assistant/contractDrift.test.js, which this
// file deliberately does not modify: those two are M2 acceptance criteria and a
// milestone should not edit a control it inherited. The extractors below are
// therefore a small, knowing duplication of that file's — worth folding into a
// shared helper when a fourth pair appears, and NOT worth editing a passing
// guard to achieve today.
//
// WHY THIS PAIR IS THE MOST DANGEROUS OF THE THREE. The other two drift into a
// 400 the teacher cannot act on. This one drifts silently: the resolver
// canonicalizes "class 5" to a band string, the Generator's datalist offers a
// different set, and the prefilled value simply looks like a typo the teacher
// made. Nothing errors. Nobody finds out.
//
// The client file is TypeScript and this suite is CommonJS, so it is read as
// TEXT. That is acceptable ONLY because every extraction fails loudly when it
// finds nothing — a drift test that silently compares two empty lists reports
// success forever.

const fs = require('fs');
const path = require('path');

const { GRADES } = require('../../src/actions/vocab/grades');
const { SUBJECTS } = require('../../src/actions/vocab/subjects');
const { LANGUAGE_CODES } = require('../../src/actions/vocab/languages');

const SERVER_ROOT = path.resolve(__dirname, '../../src');
const CONFIG_PATH = path.resolve(__dirname, '../../../client/src/config.ts');

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[vocab-drift] expected file not found: ${filePath}. ` +
        'If it moved, update this test — do not delete the guard.'
    );
  }
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Pull the string literals out of an exported flat array constant, e.g.
 * `export const GRADES = ['Pre-Primary', 'Class 1-2'];`
 */
function extractStringArray(source, constName) {
  const match = new RegExp(`export const ${constName}[^=]*=\\s*\\[([\\s\\S]*?)\\];`).exec(source);
  if (!match) {
    throw new Error(`[vocab-drift] could not find "export const ${constName}" in config.ts.`);
  }
  const values = [...match[1].matchAll(/'([^']*)'/g)].map((m) => m[1]);
  if (values.length === 0) {
    throw new Error(`[vocab-drift] parsed "${constName}" but found no members — the extractor is broken.`);
  }
  return values;
}

/** Pull the `value:` literals out of an exported array-of-objects constant. */
function extractOptionValues(source, constName) {
  const start = source.indexOf(`export const ${constName}`);
  if (start === -1) {
    throw new Error(`[vocab-drift] could not find "export const ${constName}" in config.ts.`);
  }
  const open = source.indexOf('= [', start);
  const close = source.indexOf('\n];', open);
  if (open === -1 || close === -1) {
    throw new Error(`[vocab-drift] could not delimit the array body of "${constName}".`);
  }
  const values = [...source.slice(open + 3, close).matchAll(/value:\s*'([^']+)'/g)].map((m) => m[1]);
  if (values.length === 0) {
    throw new Error(`[vocab-drift] parsed "${constName}" but found no values — the extractor is broken.`);
  }
  return values;
}

describe('vocabulary drift — the extractors themselves work', () => {
  const config = readFile(CONFIG_PATH);

  test('a known flat array is parsed correctly', () => {
    expect(extractStringArray(config, 'GRADES')).toContain('Class 3-5');
  });

  test('a known option list is parsed correctly', () => {
    expect(extractOptionValues(config, 'LANGUAGES')).toContain('en');
  });

  test('a missing symbol raises rather than silently returning nothing', () => {
    expect(() => extractStringArray(config, 'NO_SUCH_CONST')).toThrow(/could not find/i);
    expect(() => extractOptionValues(config, 'NO_SUCH_CONST')).toThrow(/could not find/i);
  });
});

describe('vocabulary drift — pair C: server vocab mappers vs client config', () => {
  const config = readFile(CONFIG_PATH);

  test('grades match exactly, including order', () => {
    // Order is asserted here, unlike the wire vocabularies in pair A, because
    // this list is rendered: it is the order of the Generator's datalist and the
    // Settings picker, and the server's own list is documented as school order.
    expect(extractStringArray(config, 'GRADES')).toEqual([...GRADES]);
  });

  test('subjects match exactly, including order', () => {
    expect(extractStringArray(config, 'SUBJECTS')).toEqual([...SUBJECTS]);
  });

  test('language codes match exactly, including order', () => {
    expect(extractOptionValues(config, 'LANGUAGES')).toEqual([...LANGUAGE_CODES]);
  });
});

describe('vocabulary drift — the cross-reference comments survive', () => {
  // The comments are how the next developer discovers the counterpart file at
  // all. A refactor that strips them leaves someone editing one side with no
  // pointer to the other — which is precisely how M1 nearly shipped a stale
  // reference (README §9).
  const config = readFile(CONFIG_PATH);

  test('each server mapper names client/src/config.ts', () => {
    for (const file of ['grades.js', 'subjects.js', 'languages.js']) {
      const source = readFile(path.join(SERVER_ROOT, 'actions/vocab', file));
      expect(source, `${file} does not name its client counterpart`).toMatch(
        /client\/src\/config\.ts/
      );
    }
  });

  test('config.ts names the server vocab folder', () => {
    expect(config).toMatch(/server\/src\/actions\/vocab/);
  });
});
