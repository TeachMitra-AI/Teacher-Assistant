// The vocabulary registry (Milestone M4).
//
// Small, but it guards a real gap: a descriptor may declare
// `type: 'vocab', vocab: 'GRADES'`, and the registry's startup validation only
// checks that the id is a KNOWN id — not that an implementation exists behind
// it. A slot pointing at a vocabulary with no mapper would canonicalize nothing
// and quietly fall through to the profile default on every request.

const { VOCABULARIES } = require('../../../src/assistant/contracts');
const { DESCRIPTORS } = require('../../../src/actions/registry');
const { VOCAB_STATUS, MAPPERS, VALUES, mapVocabulary } = require('../../../src/actions/vocab');

describe('vocabulary registry', () => {
  test('every id in the frozen contract has a mapper', () => {
    for (const id of VOCABULARIES) {
      expect(typeof MAPPERS[id], `${id} has no mapper`).toBe('function');
    }
  });

  test('no mapper exists for an id the contract does not define', () => {
    // The other direction: a mapper nobody can reference is dead code, and an id
    // that skipped the contract skipped the client's type union with it.
    expect(Object.keys(MAPPERS).sort()).toEqual([...VOCABULARIES].sort());
  });

  test('every id has a canonical value list', () => {
    for (const id of VOCABULARIES) {
      expect(Array.isArray(VALUES[id]), `${id} has no value list`).toBe(true);
      expect(VALUES[id].length).toBeGreaterThan(0);
    }
  });

  test('every vocab slot on every live descriptor resolves to a mapper', () => {
    const vocabSlots = DESCRIPTORS.flatMap((descriptor) =>
      descriptor.slots.filter((slot) => slot.type === 'vocab').map((slot) => [descriptor.id, slot])
    );

    // If this is ever zero the assertions below pass vacuously, which would make
    // this test worthless — so the count itself is asserted first.
    expect(vocabSlots.length).toBeGreaterThan(0);

    for (const [actionId, slot] of vocabSlots) {
      expect(typeof MAPPERS[slot.vocab], `${actionId}.${slot.name} -> ${slot.vocab}`).toBe('function');
    }
  });

  test('mapVocabulary dispatches to the right mapper', () => {
    expect(mapVocabulary('GRADES', 'class 5').value).toBe('Class 3-5');
    expect(mapVocabulary('SUBJECTS', 'maths').value).toBe('Mathematics');
    expect(mapVocabulary('LANGUAGES', 'in hindi').value).toBe('hi');
  });

  test('an unknown vocabulary degrades instead of throwing', () => {
    // Unreachable through a descriptor — the registry rejects an unknown id at
    // boot. It matters anyway: this module sits in a pipeline that must always
    // return an answer, never an exception, because it is in front of a text box.
    expect(mapVocabulary('NO_SUCH_VOCABULARY', 'class 5').status).toBe(VOCAB_STATUS.UNMAPPED);
    expect(mapVocabulary(undefined, 'class 5').status).toBe(VOCAB_STATUS.UNMAPPED);
  });
});
