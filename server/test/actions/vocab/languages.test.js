// Language canonicalization. The negative half matters more: language is set only from an explicit statement, never
// from the script typed, since a Hinglish or Devanagari request often wants an English worksheet. So a request written
// in Hindi with no language named must yield nothing, leaving the teacher's profile default to win.

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
    // Structural: mapLanguage takes one slot value, so the utterance, its script and the locale can't reach the decision.
    expect(mapLanguage.length).toBe(1);
  });
});

describe('mapLanguage — never ambiguous', () => {
  // Unlike grades and subjects this mapper never returns AMBIGUOUS: the ambiguous path prefills raw words, and an
  // unmatchable string in the language <select> shows as nothing selected. A document has one language, so two is a question.
  const TWO_LANGUAGES = ['hindi or english', 'hindi and english', 'english / hindi'];

  test.each(TWO_LANGUAGES)('%j is a contradiction, not an ambiguity', (raw) => {
    const result = mapLanguage(raw);
    expect(result.status).toBe(VOCAB_STATUS.CONTRADICTION);
    // Readings are in the order said, so assert membership, not order.
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
    // Teachers write names, not codes, so a code arriving here means something upstream echoes form values. "or" is also
    // Odia's code, so a table containing codes would read "Hindi or English" as Odia. Falling through to the profile default is safe.
    expect(mapLanguage('en').status).toBe(VOCAB_STATUS.UNMAPPED);
    expect(mapLanguage('or').status).toBe(VOCAB_STATUS.UNMAPPED);
    expect(mapLanguage('hindi or english').readings).not.toContain('or');
  });
});
