// Controlled vocabulary: GRADES. Turns "class 5", "5th", "V", "पाँचवीं", "kaksha 5 ke liye" into a canonical grade.
// The hardest mapping: "class 5-6" and "primary" span several grades with
// no single honest answer. Done in code rather than a prompt so it can be unit-tested against many phrasings.
// client/src/config.ts (GRADES) holds the same list, pinned by test/actions/vocabDrift.test.js. Change both together.

const {
  VOCAB_STATUS,
  RANGE_SEPARATORS,
  ALTERNATION_SEPARATORS,
  normalize,
  tokenize,
  unmapped,
  resolveMultiple,
} = require('./shared');

/** The canonical grades, in school order; every mapped result is exactly one of these. */
const GRADES = Object.freeze([
  'Pre-Primary',
  ...Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`),
]);

/** Classes outside 1-12 are not grades. */
const classLabel = (number) => (number >= 1 && number <= 12 ? `Class ${number}` : null);

/**
 * Words that mark a phrase as being about a class, in English and Hinglish. Exported because
 * assistant/slotRecovery.js gates on this same set; adding a word here widens that gate too, deliberately.
 */
const CLASS_KEYWORDS = new Set([
  'class',
  'classes',
  'cls',
  'grade',
  'std',
  'standard',
  'kaksha',
  'kaksa',
  'कक्षा',
]);

// Cardinal words: "class five" is more common than "fifth class", so leaving them out was a recall gap.
const ENGLISH_CARDINALS = Object.freeze({
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
});

const ENGLISH_ORDINALS = Object.freeze({
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
});

// Both the feminine (…वीं, agreeing with कक्षा) and masculine forms, plus the
// common spellings with and without the nasal vowel sign — teachers type both.
const HINDI_ORDINALS = Object.freeze({
  'पहली': 1,
  'पहला': 1,
  'दूसरी': 2,
  'दूसरा': 2,
  'तीसरी': 3,
  'तीसरा': 3,
  'चौथी': 4,
  'चौथा': 4,
  'पाँचवीं': 5,
  'पांचवीं': 5,
  'पाँचवी': 5,
  'पांचवी': 5,
  'छठी': 6,
  'छठवीं': 6,
  'सातवीं': 7,
  'सातवी': 7,
  'आठवीं': 8,
  'आठवी': 8,
  'नौवीं': 9,
  'नौवी': 9,
  'दसवीं': 10,
  'दसवी': 10,
  'ग्यारहवीं': 11,
  'बारहवीं': 12,
});

// Hinglish ordinals as typed on a Latin keyboard. Spellings vary, so common variants are listed rather than normalized by a rule that would over-match.
const HINGLISH_ORDINALS = Object.freeze({
  pehli: 1,
  pehla: 1,
  doosri: 2,
  dusri: 2,
  teesri: 3,
  tisri: 3,
  chauthi: 4,
  panchvi: 5,
  paanchvi: 5,
  panchvin: 5,
  chhati: 6,
  chhathi: 6,
  chathi: 6,
  saatvi: 7,
  satvi: 7,
  aathvi: 8,
  athvi: 8,
  navi: 9,
  nauvi: 9,
  dasvi: 10,
  dusvi: 10,
  gyarvi: 11,
  barvi: 12,
});

const ROMAN_NUMERALS = Object.freeze({
  i: 1,
  ii: 2,
  iii: 3,
  iv: 4,
  v: 5,
  vi: 6,
  vii: 7,
  viii: 8,
  ix: 9,
  x: 10,
  xi: 11,
  xii: 12,
});

/** Words that name the pre-primary years directly. */
const PRE_PRIMARY_TOKENS = new Set([
  'nursery',
  'lkg',
  'ukg',
  'kg',
  'kindergarten',
  'preprimary',
  'prep',
  'नर्सरी',
]);

/**
 * Vague band words. They span several grades, so the caller keeps the teacher's own words unless a numbered class narrows it.
 */
const BAND_WORDS = Object.freeze({
  primary: ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'],
  primaryschool: ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'],
  elementary: ['Class 1', 'Class 2', 'Class 3', 'Class 4', 'Class 5'],
  middle: ['Class 6', 'Class 7', 'Class 8'],
  middleschool: ['Class 6', 'Class 7', 'Class 8'],
  upperprimary: ['Class 6', 'Class 7', 'Class 8'],
  secondary: ['Class 9', 'Class 10'],
  highschool: ['Class 9', 'Class 10'],
  seniorsecondary: ['Class 11', 'Class 12'],
  seniorschool: ['Class 11', 'Class 12'],
});

// Multi-word phrases collapsed to one token before tokenizing, so "pre-primary" isn't read as two mentions joined by a range separator. Applied in order.
const PHRASE_ALIASES = Object.freeze([
  [/\bpre[\s-]*primary\b/g, ' preprimary '],
  [/\bpre[\s-]*school\b/g, ' preprimary '],
  [/\bplay[\s-]*group\b/g, ' preprimary '],
  [/\bplay[\s-]*school\b/g, ' preprimary '],
  [/\b(senior|higher)[\s-]*secondary\b/g, ' seniorsecondary '],
  [/\bsenior[\s-]*school\b/g, ' seniorsecondary '],
  [/\bhigh[\s-]*school\b/g, ' highschool '],
  [/\bmiddle[\s-]*school\b/g, ' middleschool '],
  [/\bupper[\s-]*primary\b/g, ' upperprimary '],
  [/\bprimary[\s-]*school\b/g, ' primaryschool '],
]);

/**
 * Read a single token as a class number, or null. Roman numerals and cardinal words are gated on class
 * context because alone they're ordinary words ("i want a worksheet" would read as Class 1, "ten questions"
 * as Class 10). They're accepted when the phrase is about a class ("class five") or is the whole phrase ("five").
 * Digits and ordinals need no gate.
 *
 * @param {string} token
 * @param {{hasClassContext: boolean}} opts
 * @returns {number|null}
 */
function readClassNumber(token, { hasClassContext }) {
  const digits = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(token);
  if (digits) return Number(digits[1]);

  if (ENGLISH_ORDINALS[token]) return ENGLISH_ORDINALS[token];
  if (HINDI_ORDINALS[token]) return HINDI_ORDINALS[token];
  if (HINGLISH_ORDINALS[token]) return HINGLISH_ORDINALS[token];

  if (hasClassContext && ENGLISH_CARDINALS[token]) return ENGLISH_CARDINALS[token];
  if (hasClassContext && ROMAN_NUMERALS[token]) return ROMAN_NUMERALS[token];

  return null;
}

/**
 * Map a raw grade phrase to a canonical grade.
 *
 * @param {unknown} raw whatever the classifier put in the `grade` slot
 * @returns {{status: string, value?: string, candidates?: string[], readings?: string[], raw: unknown}}
 */
function mapGrade(raw) {
  const normalized = normalize(raw);
  if (!normalized) return unmapped(raw);

  const collapsed = PHRASE_ALIASES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    normalized
  ).trim();

  const tokens = tokenize(collapsed);
  const hasClassContext = tokens.length === 1 || tokens.some((token) => CLASS_KEYWORDS.has(token));

  // Explicit mentions in the order they were said, plus the separators found
  // between them — which is what distinguishes one span from two alternatives.
  const mentions = [];
  const separators = [];

  for (const token of tokens) {
    if (RANGE_SEPARATORS.has(token) || ALTERNATION_SEPARATORS.has(token)) {
      if (mentions.length > 0) separators.push(token);
      continue;
    }

    if (PRE_PRIMARY_TOKENS.has(token)) {
      mentions.push('Pre-Primary');
      continue;
    }

    const number = readClassNumber(token, { hasClassContext });
    const label = number !== null ? classLabel(number) : null;
    if (label) mentions.push(label);
  }

  if (mentions.length > 0) {
    return resolveMultiple(mentions, separators, raw);
  }

  // No numbered class named: fall back to the weaker band words, so "primary class 3" resolves on the 3.
  const bandWord = tokens.find((token) => BAND_WORDS[token]);
  if (bandWord) {
    return resolveMultiple(BAND_WORDS[bandWord], [], raw);
  }

  return unmapped(raw);
}

module.exports = {
  GRADES,
  VOCAB_STATUS,
  CLASS_KEYWORDS,
  mapGrade,
};
