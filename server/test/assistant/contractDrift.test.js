// Milestone M2 acceptance criterion — the contract drift guard.
//
// Two pairs of files hold the same knowledge in two runtimes. Neither pair can
// be collapsed into a single source today (CommonJS server vs ESM client; a
// shared package would need a monorepo restructure larger than this project),
// so the duplication is deliberate and documented. This test converts that
// documentation from a convention into a control.
//
//   Pair A  server/src/assistant/contracts.js  <->  client/src/assistant/types.ts
//           The wire vocabularies. Drift here means the client fails to handle a
//           decision or reason the server can legitimately send.
//
//   Pair B  server/src/actions/schemas/generateAssessment.js  <->  client/src/config.ts
//           The generator's option vocabularies. Drift here means the teacher's
//           dropdown offers something the server rejects with a 400 they cannot
//           act on — and, from M2, that the capability descriptor advertises a
//           choice the picker cannot express.
//
// The client files are TypeScript and this suite is CommonJS, so they are read
// as TEXT and parsed. That is acceptable ONLY because every extraction below
// fails loudly when it finds nothing: a drift test that silently compares two
// empty lists is worse than no test at all, because it reports success forever.

const fs = require('fs');
const path = require('path');

const contracts = require('../../src/assistant/contracts');
const generatorSchema = require('../../src/actions/schemas/generateAssessment');

const CLIENT_ROOT = path.resolve(__dirname, '../../../client/src');
const TYPES_PATH = path.join(CLIENT_ROOT, 'assistant/types.ts');
const CONFIG_PATH = path.join(CLIENT_ROOT, 'config.ts');

function readClientFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `[drift] expected client file not found: ${filePath}. ` +
        'If it moved, update this test — do not delete the guard.'
    );
  }
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * Pull the string literals out of an exported TypeScript union.
 * Handles both single-line and leading-pipe multi-line forms.
 * @returns {string[]} in declaration order
 */
function extractUnionMembers(source, typeName) {
  const match = new RegExp(`export type ${typeName}\\s*=([\\s\\S]*?);`).exec(source);
  if (!match) {
    throw new Error(`[drift] could not find "export type ${typeName}" in types.ts.`);
  }
  const members = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (members.length === 0) {
    throw new Error(`[drift] parsed "${typeName}" but found no members — the extractor is broken.`);
  }
  return members;
}

/** Pull an exported numeric constant. */
function extractNumericConst(source, name) {
  const match = new RegExp(`export const ${name}\\s*=\\s*(\\d+)`).exec(source);
  if (!match) {
    throw new Error(`[drift] could not find "export const ${name}" in the client file.`);
  }
  return Number(match[1]);
}

/**
 * Pull the `value:` literals from an exported array-of-objects constant.
 *
 * Deliberately reads only the array BODY, never the type annotation on the
 * declaration line — the annotation repeats the same literals, and including it
 * would let an annotation-only edit mask a real change to the options.
 */
function extractOptionValues(source, constName) {
  const start = source.indexOf(`export const ${constName}`);
  if (start === -1) {
    throw new Error(`[drift] could not find "export const ${constName}" in config.ts.`);
  }
  const open = source.indexOf('= [', start);
  const close = source.indexOf('\n];', open);
  if (open === -1 || close === -1) {
    throw new Error(`[drift] could not delimit the array body of "${constName}" in config.ts.`);
  }
  const body = source.slice(open + 3, close);
  const values = [...body.matchAll(/value:\s*'([^']+)'/g)].map((m) => m[1]);
  if (values.length === 0) {
    throw new Error(`[drift] parsed "${constName}" but found no values — the extractor is broken.`);
  }
  return values;
}

// ---------------------------------------------------------------------------

describe('contract drift — the extractors themselves work', () => {
  // If these fail, every comparison below is meaningless, so they are asserted
  // first and explicitly rather than being assumed.
  const types = readClientFile(TYPES_PATH);
  const config = readClientFile(CONFIG_PATH);

  test('a known union is parsed correctly out of types.ts', () => {
    expect(extractUnionMembers(types, 'ConfidenceLevel')).toEqual(['high', 'medium', 'low']);
  });

  test('a known option list is parsed correctly out of config.ts', () => {
    expect(extractOptionValues(config, 'ASSESSMENT_FORMATS')).toEqual(['quiz', 'worksheet']);
  });

  test('a missing symbol raises rather than silently returning nothing', () => {
    expect(() => extractUnionMembers(types, 'NoSuchType')).toThrow(/could not find/i);
    expect(() => extractOptionValues(config, 'NO_SUCH_CONST')).toThrow(/could not find/i);
  });
});

describe('contract drift — pair A: server contracts vs client types', () => {
  const types = readClientFile(TYPES_PATH);

  // Every frozen server vocabulary that has a client counterpart. PHASE1_DECISIONS
  // and NON_ACTION_INTENTS are intentionally absent: they are server-side policy
  // subsets with no client union to drift from.
  const PAIRS = [
    ['EFFECTS', contracts.EFFECTS, 'ActionEffect'],
    ['DECISIONS', contracts.DECISIONS, 'ActionDecision'],
    ['PASSTHROUGH_REASONS', contracts.PASSTHROUGH_REASONS, 'PassthroughReason'],
    ['PROVENANCE_SOURCES', contracts.PROVENANCE_SOURCES, 'ProvenanceSource'],
    ['CONFIDENCE_LEVELS', contracts.CONFIDENCE_LEVELS, 'ConfidenceLevel'],
    ['ACTION_STATUSES', contracts.ACTION_STATUSES, 'ActionStatus'],
    ['SLOT_TYPES', contracts.SLOT_TYPES, 'SlotType'],
    ['VOCABULARIES', contracts.VOCABULARIES, 'VocabularyId'],
  ];

  test.each(PAIRS)('%s matches the client union exactly', (_name, serverValues, typeName) => {
    const clientValues = extractUnionMembers(types, typeName);
    // Compared as sorted sets: order is a stylistic choice in a union, but
    // membership is the contract. Both directions — a client union with an
    // EXTRA member is drift too, and would mean the client believes in a value
    // the server can never send.
    expect([...clientValues].sort()).toEqual([...serverValues].sort());
  });

  test('the contract version and utterance cap agree', () => {
    expect(extractNumericConst(types, 'ASSISTANT_CONTRACT_VERSION')).toBe(
      contracts.ASSISTANT_CONTRACT_VERSION
    );
    expect(extractNumericConst(types, 'MAX_UTTERANCE_LENGTH')).toBe(contracts.MAX_UTTERANCE_LENGTH);
  });

  test('the pair list covers every client-facing vocabulary in contracts.js', () => {
    // Guards against the quiet failure mode where a new vocabulary is added to
    // contracts.js and simply never gets a drift check.
    const covered = PAIRS.map(([name]) => name);
    const serverSideOnly = ['PHASE1_DECISIONS', 'NON_ACTION_INTENTS'];
    const allVocabularies = Object.entries(contracts)
      .filter(([, value]) => Array.isArray(value))
      .map(([name]) => name);

    for (const name of allVocabularies) {
      if (serverSideOnly.includes(name)) continue;
      expect(covered, `${name} has no drift check — add it to PAIRS or to serverSideOnly`).toContain(name);
    }
  });
});

describe('contract drift — pair B: generator schema vs client picker options', () => {
  const config = readClientFile(CONFIG_PATH);

  test('formats match', () => {
    expect(extractOptionValues(config, 'ASSESSMENT_FORMATS').sort()).toEqual(
      [...generatorSchema.FORMATS].sort()
    );
  });

  test('difficulties match', () => {
    expect(extractOptionValues(config, 'DIFFICULTIES').sort()).toEqual(
      [...generatorSchema.DIFFICULTIES].sort()
    );
  });

  test('question types match', () => {
    expect(extractOptionValues(config, 'QUESTION_TYPES').sort()).toEqual(
      [...generatorSchema.QUESTION_TYPES].sort()
    );
  });

  test('question-count bounds match', () => {
    // The picker's spinner bounds and the schema's accepted range must be the
    // same number, or the form can submit a count the endpoint rejects.
    expect(extractNumericConst(config, 'QUESTION_COUNT_MIN')).toBe(generatorSchema.MIN_QUESTIONS);
    expect(extractNumericConst(config, 'QUESTION_COUNT_MAX')).toBe(generatorSchema.MAX_QUESTIONS);
  });

  test('the client default count sits inside the schema bounds', () => {
    const dflt = extractNumericConst(config, 'QUESTION_COUNT_DEFAULT');
    expect(dflt).toBeGreaterThanOrEqual(generatorSchema.MIN_QUESTIONS);
    expect(dflt).toBeLessThanOrEqual(generatorSchema.MAX_QUESTIONS);
  });
});

describe('contract drift — the cross-reference comments survive', () => {
  // The comments are how a developer discovers the counterpart file in the first
  // place. A refactor that removes them leaves the next person with no pointer,
  // which is how M1 nearly shipped a stale reference.
  test('both files in each pair name their counterpart', () => {
    const serverContracts = fs.readFileSync(
      path.resolve(__dirname, '../../src/assistant/contracts.js'),
      'utf8'
    );
    const serverGenerator = fs.readFileSync(
      path.resolve(__dirname, '../../src/actions/schemas/generateAssessment.js'),
      'utf8'
    );

    expect(serverContracts).toMatch(/client\/src\/assistant\/types\.ts/);
    expect(readClientFile(TYPES_PATH)).toMatch(/server\/src\/assistant\/contracts\.js/);
    expect(serverGenerator).toMatch(/client\/src\/config\.ts/);
    expect(readClientFile(CONFIG_PATH)).toMatch(/generateAssessment\.js/);
  });
});
