// Language canonicalization (Milestone M4).
//
// The negative half of this file matters more than the positive half.
//
// The rule is "set language ONLY from an explicit statement, never from the
// script the teacher typed in" (architecture §8.3), because a Hinglish or
// Devanagari request very often wants an ENGLISH worksheet — the printed paper
// follows an English-medium syllabus. The failure this prevents is a
// wrong-language printed document, discovered in front of a class.
//
// So the tests that carry the weight are the ones asserting that a request
// written in Hindi, with no language named, yields NOTHING — leaving the
// teacher's own profile default to win.

const { LANGUAGE_CODES, VOCAB_STATUS, mapLanguage } = require('../../../src/actions/vocab/languages');

describe('mapLanguage — explicit statements', () => {
  const CASES = [
    ['in Hindi', 'hi'],
    ['hindi', 'hi'],
    ['Hindi mein', 'hi'],
    ['हिंदी में', 'hi'],
    ['हिन्दी', 'hi'],
    ['in English', 'en'],
    ['english', 'en'],
    ['angrezi mein', 'en'],
    ['angreji', 'en'],
    ['अंग्रेजी', 'en'],
    ['hinglish', 'hinglish'],
    ['in Marathi', 'mr'],
    ['bangla', 'bn'],
    ['bengali', 'bn'],
    ['tamil', 'ta'],
    ['telugu', 'te'],
    ['gujarati', 'gu'],
    ['kannada', 'kn'],
    ['odia', 'or'],
    ['oriya', 'or'],
  ];

  test.each(CASES)('%j maps to %s', (raw, expected) => {
    const result = mapLanguage(raw);
    expect(result.status).toBe(VOCAB_STATUS.MAPPED);
    expect(result.value).toBe(expected);
  });

  test('every mapped value is a canonical code', () => {
    for (const [raw] of CASES) {
      expect(LANGUAGE_CODES).toContain(mapLanguage(raw).value);
    }
  });
});

describe('mapLanguage — the language trap', () => {
  // Each of these is written in a non-English script or register and names no
  // language. Every one must be unmapped so the profile default wins.
  const NO_LANGUAGE_STATED = [
    ['मुझे भिन्न पर वर्कशीट चाहिए', 'a Devanagari request with no language named'],
    ['कक्षा ५ के लिए गणित का प्रश्नपत्र', 'a Devanagari request naming a class and subject'],
    ['class 5 ke liye maths quiz banao', 'a Hinglish request'],
    ['ek worksheet banao', 'a Hinglish imperative'],
  ];

  test.each(NO_LANGUAGE_STATED)('%j (%s) yields no language', (raw) => {
    expect(mapLanguage(raw).status).toBe(VOCAB_STATUS.UNMAPPED);
  });

  test('naming the language in that same script IS explicit, and is honoured', () => {
    // The rule is about inference from script, not about refusing Devanagari.
    expect(mapLanguage('हिंदी में वर्कशीट').value).toBe('hi');
  });

  test('the module has no way to see the utterance at all', () => {
    // Structural, not behavioural: mapLanguage takes one slot value. There is no
    // parameter through which the utterance, its script, or the teacher's locale
    // could reach this decision, which is what makes the rule enforceable rather
    // than merely documented.
    expect(mapLanguage.length).toBe(1);
  });
});

describe('mapLanguage — never ambiguous', () => {
  // Unlike grades and subjects, this mapper must never return AMBIGUOUS. The
  // ambiguous path prefills the teacher's raw words, and the Generator's
  // language field is a <select> — an unmatchable string there shows as nothing
  // selected, silently. A document has one language, so two languages is a
  // question, not a span.
  const TWO_LANGUAGES = ['hindi or english', 'hindi and english', 'english / hindi'];

  test.each(TWO_LANGUAGES)('%j is a contradiction, not an ambiguity', (raw) => {
    const result = mapLanguage(raw);
    expect(result.status).toBe(VOCAB_STATUS.CONTRADICTION);
    // Readings are in the order they were said, so membership is asserted
    // rather than order — "english / hindi" and "hindi or english" are the same
    // contradiction presented in different words.
    expect([...result.readings].sort()).toEqual(['en', 'hi']);
  });

  test('readings preserve the order the teacher said them in', () => {
    // Which matters for the chip order in the clarifying question: the first
    // thing they said should be the first thing offered back.
    expect(mapLanguage('hindi or english').readings).toEqual(['hi', 'en']);
    expect(mapLanguage('english / hindi').readings).toEqual(['en', 'hi']);
  });

  test('no input in this suite produces an ambiguous result', () => {
    const everything = [
      ...TWO_LANGUAGES,
      'hindi',
      'in english',
      'हिंदी में',
      'class 5 maths',
      '',
      null,
      'hindi english marathi',
    ];
    for (const raw of everything) {
      expect(mapLanguage(raw).status).not.toBe(VOCAB_STATUS.AMBIGUOUS);
    }
  });

  test('the same language said twice is not a contradiction', () => {
    expect(mapLanguage('hindi or hindi').value).toBe('hi');
  });
});

describe('mapLanguage — unmapped is a safe, ordinary outcome', () => {
  const CASES = [[''], ['   '], [null], [undefined], [3], ['asdfgh']];

  test.each(CASES)('%j is unmapped', (raw) => {
    expect(mapLanguage(raw).status).toBe(VOCAB_STATUS.UNMAPPED);
  });

  test('a bare ISO code is not treated as a statement', () => {
    // Two reasons, both deliberate. Teachers write language names, not codes —
    // a code arriving here means something upstream is echoing form values. And
    // "or" is BOTH Odia's code and the word separating two alternatives, so a
    // table containing codes would read "Hindi or English" as a request for
    // Odia. Falling through to the profile default is the safe outcome.
    expect(mapLanguage('en').status).toBe(VOCAB_STATUS.UNMAPPED);
    expect(mapLanguage('or').status).toBe(VOCAB_STATUS.UNMAPPED);
    expect(mapLanguage('hindi or english').readings).not.toContain('or');
  });
});
