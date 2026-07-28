// Controlled vocabulary: LANGUAGES (Milestone M4).
//
// THE LANGUAGE TRAP — read this before changing anything here.
//
// The language a teacher TYPES IN is not necessarily the language they want the
// worksheet OUT in. A Hinglish or Devanagari request very often wants an
// ENGLISH worksheet, because the printed paper follows an English-medium
// syllabus. Getting this wrong produces a wrong-language printed document: the
// most visible possible failure of this feature, discovered by a teacher in
// front of a class (architecture §8.3).
//
// The rule is therefore: SET LANGUAGE ONLY FROM AN EXPLICIT STATEMENT — "in
// Hindi", "हिंदी में", "Hindi mein". Never from the script the utterance was
// written in.
//
// That rule is enforced structurally rather than by discipline. This module
// matches language NAMES and nothing else; it is never given the utterance, and
// there is no script detection anywhere in it or in its caller. A phrase with
// no language name in it returns `unmapped`, and the resolver then falls
// through to the teacher's own profile default — which is what they set
// precisely so it would be used.
//
// CLIENT COUNTERPART: client/src/config.ts (LANGUAGES) holds the same codes,
// where they are the values of the Generator's language <select> and the Coach
// language picker. Deliberate, documented duplication (CHANGE-11), pinned by
// server/test/actions/vocabDrift.test.js. CHANGE BOTH IN THE SAME COMMIT.

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

/**
 * The canonical language codes, in the client's display order. A mapped result
 * is always one of these — they are what the Generator's <select> submits and
 * what /api/resources/generate receives.
 */
const LANGUAGE_CODES = Object.freeze(['en', 'hi', 'bn', 'te', 'mr', 'ta', 'gu', 'kn', 'or', 'hinglish']);

/**
 * Language NAME → code. Names only.
 *
 * Note what is deliberately absent: the bare code strings themselves. "or" is
 * Odia's code AND the English word that separates two alternatives, so a table
 * containing it would read "Hindi or English" as a request for Odia. Teachers
 * write language names, not ISO codes; the codes are an implementation detail
 * of the form.
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
 * Map a raw language phrase to a canonical code.
 *
 * Unlike grades and subjects, this mapper NEVER returns `ambiguous`. A document
 * is written in one language, so two distinct languages in one phrase is a
 * question to ask, not a span to approximate — and the ambiguous path prefills
 * the teacher's raw words, which would put an unmatchable string into a <select>
 * and silently show nothing selected. "Hindi and English" and "Hindi or English"
 * are therefore both contradictions.
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
