// Shared leaf for the controlled-vocabulary mappers (Milestone M4).
//
// Holds two things the three mappers would otherwise each copy: the text
// normalization they all apply before matching, and the RESULT CONTRACT they
// all return. A leaf module both are free to import keeps the dependency
// direction clean (guardrail 12a) and means a change to what "normalized" means
// happens in one place rather than three.
//
// No mapper imports another mapper, and nothing here knows about any specific
// vocabulary.

/**
 * The four outcomes a mapper may report. They are deliberately distinct rather
 * than collapsed into "did it work?", because the caller treats each one
 * differently and getting that wrong is how a router produces a confident,
 * plausible, wrong worksheet:
 *
 *   mapped        one canonical value, used with provenance 'utterance'
 *   ambiguous     understood, but spans more than one canonical value. The
 *                 teacher's RAW phrase is prefilled and the field is flagged
 *                 low-confidence — more honest than picking one (architecture
 *                 §8.2), and safe because the fields this can happen to are
 *                 free text in the generation schema
 *   contradiction two or more DISTINCT readings were stated ("class 5 or 8").
 *                 Never resolved by guessing: the policy asks, presenting both
 *                 readings (architecture §9)
 *   unmapped      nothing recognisable. Not a failure — the slot simply falls
 *                 through to the next precedence source (memory, profile,
 *                 default), which is usually the right answer
 */
const VOCAB_STATUS = Object.freeze({
  MAPPED: 'mapped',
  AMBIGUOUS: 'ambiguous',
  CONTRADICTION: 'contradiction',
  UNMAPPED: 'unmapped',
});

/**
 * Longest raw slot value a mapper will scan. Model-produced slots are short
 * phrases; anything longer is either a malformed proposal or an attempt to feed
 * the mapper an entire document, and neither deserves a linear scan. Beyond
 * this the value is reported unmapped, which degrades to the profile default.
 *
 * Module-private: it is an implementation detail of `normalize`, and the
 * behaviour it produces is asserted through the mappers rather than directly.
 */
const MAX_RAW_LENGTH = 120;

// Devanagari digits, so "कक्षा ५" reaches the same code path as "class 5"
// instead of needing a parallel set of patterns.
const DEVANAGARI_DIGITS = '०१२३४५६७८९';

/**
 * Lower-case, collapse whitespace, convert Devanagari digits to ASCII, and
 * reduce the punctuation teachers actually type to spaces — EXCEPT the
 * separators that carry meaning (`-` and `/` join a range, and are handled by
 * the caller). Trailing possessives and postpositions are left alone; the
 * mappers match on token boundaries rather than on the whole string.
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
 * Split a normalized string into word tokens, keeping the range and alternation
 * separators as tokens of their own so a caller can tell "3 to 5" (one span)
 * from "3 or 5" (two readings).
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

// `and` sits in RANGE_SEPARATORS on purpose. "class 3 and 4" is overwhelmingly
// one multi-grade classroom rather than a question, and treating it as a span
// keeps a very common phrasing out of the clarification path. "class 3 or 4" is
// the phrasing that genuinely signals indecision.

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
 * Decide between mapped / ambiguous / contradiction once a mapper has extracted
 * the canonical values a phrase mentions, in order, along with the separators
 * that joined them. Shared because all three mappers face exactly this choice
 * and it is the part most likely to be got subtly wrong twice.
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
