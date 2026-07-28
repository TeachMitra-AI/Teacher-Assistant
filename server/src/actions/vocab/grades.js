// Controlled vocabulary: GRADES (Milestone M4).
//
// Turns what a teacher says — "class 5", "5th", "V", "पाँचवीं", "kaksha 5 ke
// liye" — into one of the application's canonical grade BANDS.
//
// This is the hardest mapping in Phase 1 and the clearest argument for keeping
// canonicalization in code rather than in a prompt (decision D10). The
// vocabulary is expressed in RANGES while teachers speak in POINTS, so the
// mapping is many-to-one and lossy in a direction that matters: "class 5-6"
// crosses two bands and there is no honest single answer. A prompt cannot be
// unit-tested against forty phrasings, cannot be fixed without a model change,
// and regresses silently when the model is upgraded. This module can, is, and
// does not.
//
// CLIENT COUNTERPART: client/src/config.ts (GRADES) holds the same canonical
// list, where it populates the Generator's grade datalist and the Settings
// picker. That duplication is deliberate and documented (CHANGE-11 — CommonJS
// server vs ESM client), and pinned by server/test/actions/vocabDrift.test.js.
// CHANGE BOTH IN THE SAME COMMIT.

const {
  VOCAB_STATUS,
  RANGE_SEPARATORS,
  ALTERNATION_SEPARATORS,
  normalize,
  tokenize,
  unmapped,
  resolveMultiple,
} = require('./shared');

/**
 * The canonical grade bands, in school order. This list is the vocabulary —
 * every mapped result is one of these strings exactly.
 */
const GRADES = Object.freeze([
  'Pre-Primary',
  'Class 1-2',
  'Class 3-5',
  'Class 6-8',
  'Class 9-10',
  'Class 11-12',
]);

/**
 * Which band a numbered class falls in. Classes outside 1–12 are not grades.
 * Module-private: the mapping is asserted through `mapGrade`'s own cases, so
 * exporting the table would only invite a second consumer of it.
 */
const NUMBER_TO_BAND = Object.freeze({
  1: 'Class 1-2',
  2: 'Class 1-2',
  3: 'Class 3-5',
  4: 'Class 3-5',
  5: 'Class 3-5',
  6: 'Class 6-8',
  7: 'Class 6-8',
  8: 'Class 6-8',
  9: 'Class 9-10',
  10: 'Class 9-10',
  11: 'Class 11-12',
  12: 'Class 11-12',
});

/** Words that mark the phrase as being about a class, in English and Hinglish. */
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

// Cardinal number words. "class five" is at least as common as "class 5" and
// far more common than "fifth class", so leaving these out was a real recall
// gap — found by running the mapper over realistic phrasings rather than by the
// test table, which had been written by the same person as the implementation.
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

// Hinglish ordinals — the Devanagari forms above as teachers type them on a
// Latin keyboard, which is how a large share of the target users actually
// write. Spelling varies, so the common variants are all listed rather than
// being normalized by a rule that would over-match.
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
 * Vague band words. Each maps to the band(s) it covers: a single candidate is a
 * confident answer ("middle school" IS classes 6–8), while several candidates
 * mean the phrase genuinely spans bands and the caller should keep the
 * teacher's own words instead.
 */
const BAND_WORDS = Object.freeze({
  primary: ['Class 1-2', 'Class 3-5'],
  primaryschool: ['Class 1-2', 'Class 3-5'],
  elementary: ['Class 1-2', 'Class 3-5'],
  middle: ['Class 6-8'],
  middleschool: ['Class 6-8'],
  upperprimary: ['Class 6-8'],
  secondary: ['Class 9-10'],
  highschool: ['Class 9-10'],
  seniorsecondary: ['Class 11-12'],
  seniorschool: ['Class 11-12'],
});

// Multi-word phrases collapsed to a single token before tokenizing, so the
// tokenizer never sees "pre-primary" as two mentions joined by a range
// separator. Applied in order.
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
 * Read a single token as a class number, or null.
 *
 * Two of the four notations are GATED ON CLASS CONTEXT, because standing alone
 * they are indistinguishable from ordinary words:
 *
 *   roman numerals   "i", "v" and "x" are valid numerals AND common English.
 *                    Ungated, "i want a worksheet" reads as Class 1-2.
 *   cardinal words   "one", "ten" and the rest appear constantly in ordinary
 *                    sentences. Ungated, "ten questions on fractions" reads as
 *                    Class 9-10 — found by exploratory testing after cardinals
 *                    were added, which is exactly the class of mistake a
 *                    same-author test table does not catch.
 *
 * Both are accepted when the phrase says it is about a class ("class five") or
 * when the token IS the whole phrase ("five"). Digits, ordinals and the
 * Hindi/Hinglish ordinals need no gate: nothing else says "5th" or "panchvi".
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
 * Map a raw grade phrase to a canonical band.
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
    if (number !== null && NUMBER_TO_BAND[number]) {
      mentions.push(NUMBER_TO_BAND[number]);
    }
  }

  if (mentions.length > 0) {
    return resolveMultiple(mentions, separators, raw);
  }

  // No numbered class was named. Fall back to the vague band words, which are
  // weaker evidence and are therefore only consulted when nothing explicit was
  // said: "primary class 3" must resolve on the 3, not on "primary".
  const bandWord = tokens.find((token) => BAND_WORDS[token]);
  if (bandWord) {
    return resolveMultiple(BAND_WORDS[bandWord], [], raw);
  }

  return unmapped(raw);
}

module.exports = {
  GRADES,
  VOCAB_STATUS,
  mapGrade,
};
