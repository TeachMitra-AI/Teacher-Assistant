// Subject canonicalization (Milestone M4).
//
// Simpler than grades because a synonym names exactly one canonical subject.
// The work is breadth: English, Hinglish transliteration, Devanagari, and the
// sub-subjects the application's coarser list folds together.

const { SUBJECTS, VOCAB_STATUS, mapSubject } = require('../../../src/actions/vocab/subjects');

describe('mapSubject — confident mappings', () => {
  const CASES = [
    // Mathematics
    ['maths', 'Mathematics'],
    ['math', 'Mathematics'],
    ['Mathematics', 'Mathematics'],
    ['ganit', 'Mathematics'],
    ['गणित', 'Mathematics'],
    ['algebra', 'Mathematics'],

    // Science, including the sub-subjects the app has no separate entry for
    ['science', 'Science'],
    ['EVS', 'Science'],
    ['environmental studies', 'Science'],
    ['environment', 'Science'],
    ['environmental science', 'Science'],
    ['vigyan', 'Science'],
    ['विज्ञान', 'Science'],
    ['physics', 'Science'],
    ['biology', 'Science'],

    // English and Hindi are their own subjects, never "Languages"
    ['english', 'English'],
    ['angrezi', 'English'],
    ['अंग्रेजी', 'English'],
    ['hindi', 'Hindi'],
    ['हिंदी', 'Hindi'],

    // Social Studies
    ['social studies', 'Social Studies'],
    ['social science', 'Social Studies'],
    ['SST', 'Social Studies'],
    ['history', 'Social Studies'],
    ['geography', 'Social Studies'],
    ['itihas', 'Social Studies'],
    ['इतिहास', 'Social Studies'],

    // Languages — regional and classical, which have no entry of their own
    ['sanskrit', 'Languages'],
    ['urdu', 'Languages'],
    ['tamil', 'Languages'],
    ['bhasha', 'Languages'],

    // General
    ['general knowledge', 'General'],
    ['gk', 'General'],
    ['computer', 'General'],

    // Phrases, not just bare words
    ['maths worksheet', 'Mathematics'],
    ['science ka paper', 'Science'],
  ];

  test.each(CASES)('%j maps to %s', (raw, expected) => {
    const result = mapSubject(raw);
    expect(result.status).toBe(VOCAB_STATUS.MAPPED);
    expect(result.value).toBe(expected);
  });

  test('every mapped value is a member of the canonical vocabulary', () => {
    for (const [raw] of CASES) {
      expect(SUBJECTS).toContain(mapSubject(raw).value);
    }
  });

  test('Hindi the SUBJECT and Hindi the language do not collide', () => {
    // They are different slots resolved by different mappers. This pins the
    // subject side: "hindi" in the subject slot is the subject, not a request
    // for Hindi-language output.
    expect(mapSubject('hindi').value).toBe('Hindi');
  });
});

describe('mapSubject — spanning and contradictory phrases', () => {
  test('two subjects joined as alternatives is a contradiction', () => {
    const result = mapSubject('maths or science');
    expect(result.status).toBe(VOCAB_STATUS.CONTRADICTION);
    expect(result.readings).toEqual(['Mathematics', 'Science']);
  });

  test('two subjects joined as a span is ambiguous, and keeps the raw phrase', () => {
    // The subject field is free text in the generation schema, so "maths and
    // science" prefilled verbatim is a legitimate, honest outcome.
    const result = mapSubject('maths and science');
    expect(result.status).toBe(VOCAB_STATUS.AMBIGUOUS);
    expect(result.candidates).toEqual(['Mathematics', 'Science']);
    expect(result.value).toBeUndefined();
  });

  test('a faculty word spans subjects rather than naming one', () => {
    const result = mapSubject('humanities');
    expect(result.status).toBe(VOCAB_STATUS.AMBIGUOUS);
    expect(result.candidates).toEqual(['Social Studies', 'Languages']);
  });

  test('a named subject outranks a faculty word in the same phrase', () => {
    expect(mapSubject('humanities - history').value).toBe('Social Studies');
  });

  test('repeating the same subject is not a contradiction', () => {
    expect(mapSubject('maths and mathematics').value).toBe('Mathematics');
  });
});

describe('mapSubject — unmapped is a safe, ordinary outcome', () => {
  const CASES = [[''], ['   '], [null], [undefined], [7], ['asdfgh'], ['something else entirely']];

  test.each(CASES)('%j is unmapped', (raw) => {
    expect(mapSubject(raw).status).toBe(VOCAB_STATUS.UNMAPPED);
  });
});
