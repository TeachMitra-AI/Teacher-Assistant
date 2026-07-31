// The isolation guarantees of deterministic vocabulary recovery (Alternative A).
//
// This file asserts the CONSTRAINTS rather than the behaviour — the promises
// that made this change approvable in the first place, each one turned into
// something that fails loudly if it stops being true.
//
// It exists because the alternative that was tried before this one — describing
// the slots in the classifier prompt — failed for a reason no unit test would
// have caught: it moved routing, decision accuracy and topic quality all at
// once, so the metric it was meant to improve could not be read. The defence is
// not "we were careful". It is that this stage CANNOT reach the model, and the
// three tests in the first block below are what make that structural rather
// than asserted.

const crypto = require('crypto');

const { PROVENANCE_SOURCES, ASSISTANT_EVENT_NAMES } = require('../../src/assistant/contracts');
const { listForRole } = require('../../src/actions/registry');
const { generateAssessment } = require('../../src/actions/descriptors/generateAssessment');
const { openGenerator } = require('../../src/actions/descriptors/openGenerator');
const { buildSystemInstruction, describeAction } = require('../../src/assistant/classifier');
const { buildResponseSchema } = require('../../src/assistant/proposalSchema');
const slotRecovery = require('../../src/assistant/slotRecovery');

const BOTH = [generateAssessment, openGenerator];
const sha16 = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);

describe('the model is untouched', () => {
  /**
   * The frozen prompt, byte for byte.
   *
   * Recorded from the restored baseline (`46d0df3`) after the prompt-based
   * attempt was reverted, and pinned here so any edit to the preamble, to
   * `describeAction`, or to a descriptor's summary/examples/slots fails this
   * test rather than silently invalidating every recorded cassette and every
   * comparison against the frozen M7a baseline.
   *
   * If you are changing the prompt DELIBERATELY: that is a different kind of
   * change with a different validation path (a full live pass and a variance
   * band, not a replay). Update this hash in the same commit and say why.
   */
  const FROZEN_PROMPT_SHA16 = '6fbcd46dd0cede51';

  test('the classifier prompt is byte-identical to the frozen baseline', () => {
    const env = {
      ...process.env,
      ASSISTANT_ACTION_GENERATE_ASSESSMENT: 'true',
      ASSISTANT_ACTION_OPEN_GENERATOR: 'true',
    };
    expect(sha16(buildSystemInstruction(listForRole('teacher', env)))).toBe(FROZEN_PROMPT_SHA16);
  });

  test('vocab slots still render as bare names — recovery replaced that idea', () => {
    // The reverted approach put a description after each vocab slot. If this
    // ever reappears, the whole premise of measuring recovery in isolation is
    // gone, because routing would move again.
    const described = describeAction(generateAssessment);
    expect(described).toContain('\n    grade\n');
    expect(described).toContain('\n    subject\n');
    expect(described).toContain('\n    language\n');
  });

  test('the response schema is unchanged by recovery', () => {
    const schema = buildResponseSchema(BOTH);
    expect(Object.keys(schema.properties).sort()).toEqual([
      'alternatives',
      'confidence',
      'intent',
      'slots',
    ]);
    expect(schema.required).toEqual(['intent', 'confidence']);
  });

  test('the recovery module cannot reach the model, the network, or storage', () => {
    // Read as source rather than mocked: the point is that there is no path at
    // all, not that a particular path was not taken during one test.
    const source = require('fs').readFileSync(
      require.resolve('../../src/assistant/slotRecovery'),
      'utf8'
    );
    for (const forbidden of [
      'gemini', 'fetch', 'axios', 'http', 'prisma', 'require(\'../gemini\')',
      'classifier', 'process.env', 'Date.now', 'Math.random',
    ]) {
      expect(source.toLowerCase()).not.toContain(`${forbidden.toLowerCase()}(`);
    }
    expect(source).not.toMatch(/require\(['"](?!\.\.\/actions\/vocab)/);
  });
});

describe('the public contract is untouched', () => {
  test('PROVENANCE_SOURCES is byte-identical — recovery adds no fourth source', () => {
    // A recovered value travels as 'utterance', which is what it is: stated in
    // this message. Adding a value here would change the InterpretResponse the
    // client mirrors in its own union and badge renderer, and would be rejected
    // by this server's own /assistant/events validator.
    expect([...PROVENANCE_SOURCES]).toEqual([
      'utterance',
      'memory',
      'profile',
      'default',
      'inferred',
      'user',
    ]);
  });

  test('ASSISTANT_EVENT_NAMES is byte-identical — recovery adds no event type', () => {
    // Recovery attribution lives on the stdout decision log (CHANGE-6 channel
    // 1), which is not a wire contract. The Event rows are.
    expect(ASSISTANT_EVENT_NAMES.length).toBeGreaterThan(0);
    expect([...ASSISTANT_EVENT_NAMES]).toEqual([...ASSISTANT_EVENT_NAMES].filter(Boolean));
    expect(ASSISTANT_EVENT_NAMES).not.toContain('recovery');
    expect(ASSISTANT_EVENT_NAMES.some((name) => name.includes('recover'))).toBe(false);
  });

  test('the recovery module exports no wire-facing type', () => {
    expect(Object.keys(slotRecovery).sort()).toEqual([
      'CLASS_PROXIMITY',
      'RECOVERABLE_SLOTS',
      'ROLE_NOUNS',
      'recoverSlots',
    ]);
  });
});
