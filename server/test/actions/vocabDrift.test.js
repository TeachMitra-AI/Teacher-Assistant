// Vocabulary drift guard for the GRADES, SUBJECTS and LANGUAGES lists, which exist in client/src/config.ts and as
// server copies (CommonJS server vs ESM client, no shared package). This test turns the cross-referencing comments
// into a control. Its pair is server/src/actions/vocab/* <-> client/src/config.ts; the other two pairs (contracts.js
// <-> assistant/types.ts, generateAssessment.js <-> config.ts) are guarded by test/assistant/contractDrift.test.js,
// whose extractors this file duplicates; fold them into a helper if a fourth pair appears.
// This pair drifts silently: the resolver canonicalizes "class 5" to a band, the Generator's datalist offers a
// different set, and the prefilled value looks like the teacher's typo. The client file is TypeScript, so it's read as
// text, which is safe only because every extraction fails loudly on finding nothing.

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
    // Order is asserted, unlike the wire vocabularies in contracts.js, because this list is rendered (the Generator's datalist and Settings picker) in school order.
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
  // The comments are how the next developer finds the counterpart file; stripping them leaves someone editing one side with no pointer to the other.
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
