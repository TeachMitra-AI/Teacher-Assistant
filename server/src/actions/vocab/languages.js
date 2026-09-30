// Controlled vocabulary: LANGUAGES.
// The language a teacher types in isn't necessarily the one they want out: a Hinglish or Devanagari request often
// wants an English worksheet. So language is set only from an explicit statement ("in Hindi", "हिंदी में"), never
// from the script. This module matches language names only and never sees the utterance; no name means `unmapped`
// and the resolver falls back to the teacher's profile default.
// client/src/config.ts (LANGUAGES) holds the same codes, pinned by test/actions/vocabDrift.test.js. Change both together.

const {
  VOCAB_STATUS,
  RANGE_SEPARATORS,
  ALTERNATION_SEPARATORS,
  normalize,
  tokenize,
  mapped,
  contradiction,
  unmapped,
} = require('./shared');

/** Canonical language codes in the client's display order; what the Generator's <select> submits. */
const LANGUAGE_CODES = Object.freeze(['en', 'hi', 'bn', 'te', 'mr', 'ta', 'gu', 'kn', 'or', 'hinglish']);

/**
 * Language name -> code, names only. Bare codes are left out: "or" is Odia's code and also the English word,
 * so "Hindi or English" would read as a request for Odia.
 */
const LANGUAGE_NAMES = Object.freeze({
  english: 'en',
  angrezi: 'en',
  angreji: 'en',
  angrezee: 'en',
  'अंग्रेजी': 'en',
  'अंग्रेज़ी': 'en',

  hindi: 'hi',
  'हिंदी': 'hi',
  'हिन्दी': 'hi',

  bengali: 'bn',
  bangla: 'bn',
  'बंगाली': 'bn',
  'बांग्ला': 'bn',

  telugu: 'te',
  'तेलुगु': 'te',

  marathi: 'mr',
  'मराठी': 'mr',

  tamil: 'ta',
  'तमिल': 'ta',

  gujarati: 'gu',
  'गुजराती': 'gu',

  kannada: 'kn',
  'कन्नड़': 'kn',
  'कन्नड': 'kn',

  odia: 'or',
  oriya: 'or',
  'ओड़िया': 'or',
  'ओडिया': 'or',

  hinglish: 'hinglish',
});

/**
 * Map a raw language phrase to a code. Never returns `ambiguous`: a document has one language, so two
 * ("Hindi and English", "Hindi or English") are a contradiction to ask about, and prefilling raw words
 * would leave the <select> showing nothing.
 *
 * @param {unknown} raw whatever the classifier put in the `language` slot
 * @returns {{status: string, value?: string, readings?: string[], raw: unknown}}
 */
function mapLanguage(raw) {
  const normalized = normalize(raw);
  if (!normalized) return unmapped(raw);

  const tokens = tokenize(normalized);
  const mentions = [];

  for (const token of tokens) {
    if (RANGE_SEPARATORS.has(token) || ALTERNATION_SEPARATORS.has(token)) continue;
    if (LANGUAGE_NAMES[token]) mentions.push(LANGUAGE_NAMES[token]);
  }

  const distinct = [...new Set(mentions)];
  if (distinct.length === 0) return unmapped(raw);
  if (distinct.length === 1) return mapped(distinct[0], raw);
  return contradiction(distinct, raw);
}

module.exports = {
  LANGUAGE_CODES,
  VOCAB_STATUS,
  mapLanguage,
};
