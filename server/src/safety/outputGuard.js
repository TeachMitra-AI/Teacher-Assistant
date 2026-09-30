// Output-side safety helpers. Pure functions, cheap enough to run on every response.
//   1. Length cap: a generous backstop against a runaway or malformed response.
//   2. Leak detection: the response must not verbatim-echo its trusted instructions or look like a secret/env-var name.
//      No prompt contains a real secret, so this is defence in depth, not a response to a known leak.

// Roughly 20-25x the templates' own 400-500 word target response length, so
// this only ever triggers as a genuine backstop.
const MAX_OUTPUT_LENGTH = 12000;

const TRUNCATION_NOTE =
  '\n\n[Response truncated for length. Ask a more specific follow-up question if you need the rest.]';

const SAFE_FALLBACK_MESSAGE =
  "Sorry, something went wrong while preparing that response. Please try rephrasing your question, or ask again in a moment.";

// Sensitive-looking substrings checked regardless of the system instruction.
const SENSITIVE_MARKERS = ['GEMINI_API_KEY', 'JWT_SECRET', 'DATABASE_URL', 'PROCESS.ENV'];
// The literal prefix format of a real Gemini API key — a strong signal on
// its own even without a full match.
const SECRET_KEY_PREFIX_PATTERN = /AIza[0-9A-Za-z_-]{10,}/;

function containsSensitiveMarker(text) {
  const upper = text.toUpperCase();
  if (SENSITIVE_MARKERS.some((marker) => upper.includes(marker))) return true;
  return SECRET_KEY_PREFIX_PATTERN.test(text);
}

/**
 * Does `haystack` contain a long verbatim chunk of `needle`? Scans overlapping fixed-size windows so a partial echo is caught.
 */
function containsVerbatimChunk(haystack, needle, chunkLength = 60, step = 20) {
  if (!haystack || !needle || needle.length < chunkLength) return false;
  const lowerHaystack = haystack.toLowerCase();
  for (let i = 0; i + chunkLength <= needle.length; i += step) {
    const chunk = needle.slice(i, i + chunkLength).toLowerCase();
    if (lowerHaystack.includes(chunk)) return true;
  }
  return false;
}

/**
 * Truncates `text` to roughly `maxLength`, cutting at the last sentence boundary in a lookback window (then
 * whitespace, then a hard cut), and appends a short truncation note.
 */
function truncateCleanly(text, maxLength) {
  const budget = Math.max(maxLength - TRUNCATION_NOTE.length, 0);
  const slice = text.slice(0, budget);
  const lookbackStart = Math.max(0, slice.length - 300);
  const window = slice.slice(lookbackStart);

  const sentenceEndCandidates = [window.lastIndexOf('. '), window.lastIndexOf('.\n'), window.lastIndexOf('! '), window.lastIndexOf('? ')];
  const lastSentenceEnd = Math.max(...sentenceEndCandidates);

  let cutPoint;
  if (lastSentenceEnd !== -1) {
    cutPoint = lookbackStart + lastSentenceEnd + 1; // keep the terminal punctuation
  } else {
    const lastSpace = slice.lastIndexOf(' ');
    cutPoint = lastSpace !== -1 ? lastSpace : slice.length;
  }

  return slice.slice(0, cutPoint).trimEnd() + TRUNCATION_NOTE;
}

/**
 * Validates and, if needed, sanitizes a model response before it is stored or sent.
 * @param {string} text the candidate response text
 * @param {{ systemInstructionText?: string }} [options] the system instruction used for this request, to leak-check against
 * @returns {{ text: string, truncated: boolean, suppressed: boolean }}
 */
function sanitizeOutput(text, options = {}) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { text: SAFE_FALLBACK_MESSAGE, truncated: false, suppressed: true };
  }

  const { systemInstructionText } = options;
  const leaked =
    containsSensitiveMarker(text) ||
    (systemInstructionText ? containsVerbatimChunk(text, systemInstructionText) : false);
  if (leaked) {
    return { text: SAFE_FALLBACK_MESSAGE, truncated: false, suppressed: true };
  }

  if (text.length > MAX_OUTPUT_LENGTH) {
    return { text: truncateCleanly(text, MAX_OUTPUT_LENGTH), truncated: true, suppressed: false };
  }

  return { text, truncated: false, suppressed: false };
}

module.exports = {
  sanitizeOutput,
  MAX_OUTPUT_LENGTH,
  SAFE_FALLBACK_MESSAGE,
};
