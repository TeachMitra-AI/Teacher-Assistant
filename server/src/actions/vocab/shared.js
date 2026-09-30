// Shared leaf for the vocabulary mappers: the text normalization they all apply, and the result contract they
// all return. Nothing here knows a specific vocabulary, and no mapper imports another.

/**
 * The four outcomes a mapper may report; the caller treats each differently.
 *   mapped        one canonical value, used with provenance 'utterance'
 *   ambiguous     spans more than one canonical value; the teacher's raw phrase is prefilled and the
 *                 field flagged low-confidence (safe since these are free text in the generation schema)
 *   contradiction two or more distinct readings stated ("class 5 or 8"); the policy asks, showing both
 *   unmapped      nothing recognisable; the slot falls through to memory, profile, then default
 */
const VOCAB_STATUS = Object.freeze({
  MAPPED: 'mapped',
  AMBIGUOUS: 'ambiguous',
  CONTRADICTION: 'contradiction',
  UNMAPPED: 'unmapped',
});

/**
 * Longest raw value a mapper scans. Longer is treated as malformed and reported unmapped, which degrades to the profile default.
 */
const MAX_RAW_LENGTH = 120;

// Devanagari digits, so "कक्षा ५" reaches the same code path as "class 5"
// instead of needing a parallel set of patterns.
const DEVANAGARI_DIGITS = '०१२३४५६७८९';

/**
 * Lower-case, collapse whitespace, convert Devanagari digits to ASCII, and reduce typical punctuation to
 * spaces, except `-` and `/`, which join a range and are handled by the caller. Mappers match on token boundaries.
 *
 * @param {unknown} raw
 * @returns {string} '' when there is nothing usable
 */
function normalize(raw) {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_RAW_LENGTH) return '';

  let out = '';
  for (const char of trimmed.toLowerCase()) {
    const devanagari = DEVANAGARI_DIGITS.indexOf(char);
    if (devanagari !== -1) {
      out += String(devanagari);
    } else if (/[.,;:!?()[\]{}"'“”‘’]/.test(char)) {
      out += ' ';
    } else {
      out += char;
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/**
 * Split a normalized string into word tokens, keeping range and alternation separators as tokens so callers
 * can tell "3 to 5" (one span) from "3 or 5" (two readings).
 *
 * @param {string} normalized
 * @returns {string[]}
 */
function tokenize(normalized) {
  return normalized
    .replace(/([-/–—&])/g, ' $1 ')
    .split(' ')
    .filter(Boolean);
}

/** Separators that join two values into ONE span. */
const RANGE_SEPARATORS = new Set(['-', '/', '–', '—', 'to', 'se', 'tak', 'through', 'and', 'aur']);

/** Separators that present two values as ALTERNATIVES the teacher has not chosen between. */
const ALTERNATION_SEPARATORS = new Set(['or', 'ya', 'either', 'vs', 'versus']);

// `and` is a range separator on purpose: "class 3 and 4" is usually one multi-grade classroom, while "3 or 4" signals indecision.

const mapped = (value, raw) => ({ status: VOCAB_STATUS.MAPPED, value, raw });

const ambiguous = (candidates, raw) => ({
  status: VOCAB_STATUS.AMBIGUOUS,
  candidates: [...candidates],
  raw,
});

const contradiction = (readings, raw) => ({
  status: VOCAB_STATUS.CONTRADICTION,
  readings: [...readings],
  raw,
});

const unmapped = (raw) => ({ status: VOCAB_STATUS.UNMAPPED, raw });

/**
 * Decide between mapped, ambiguous and contradiction once a mapper has extracted the canonical values a
 * phrase mentions and the separators between them. Shared because all three mappers face this choice.
 *
 * @param {string[]} values canonical values in mention order (may repeat)
 * @param {string[]} separators separator tokens found between mentions
 * @param {string} raw the original phrase, echoed back for the caller
 */
function resolveMultiple(values, separators, raw) {
  const distinct = [...new Set(values)];

  if (distinct.length === 0) return unmapped(raw);
  // Every mention landed on the same canonical value: "class 3 to 5" is simply
  // "Class 3-5", and the teacher gets a confident fill rather than a question.
  if (distinct.length === 1) return mapped(distinct[0], raw);

  if (separators.some((sep) => ALTERNATION_SEPARATORS.has(sep))) {
    return contradiction(distinct, raw);
  }
  // Distinct values joined by a range separator (or none): understood, but it
  // spans canonical values. The raw phrase is kept and the field flagged.
  return ambiguous(distinct, raw);
}

module.exports = {
  VOCAB_STATUS,
  RANGE_SEPARATORS,
  ALTERNATION_SEPARATORS,
  normalize,
  tokenize,
  mapped,
  ambiguous,
  contradiction,
  unmapped,
  resolveMultiple,
};
