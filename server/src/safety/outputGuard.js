// Output-side AI safety helpers. Pure functions only — no DB/network — so
// they're trivial to unit test in isolation, and cheap to run on every
// response.
//
// Two independent checks:
//   1. Length cap — a generous backstop (not a normal-path limiter) against
//      a runaway/malformed response before it's stored or returned.
//   2. Leak detection — verifies the response doesn't verbatim-echo the
//      trusted instructions it was given, or anything that looks like a
//      secret/env-var name. Nothing in this codebase ever puts a real
//      secret into a prompt (verified by reading every template in
//      prompts.js), so this is defense-in-depth for a path that shouldn't
//      exist today, not a response to a known leak.

// Roughly 20-25x the templates' own 400-500 word target response length, so
// this only ever triggers as a genuine backstop.
const MAX_OUTPUT_LENGTH = 12000;

const TRUNCATION_NOTE =
  '\n\n[Response truncated for length. Ask a more specific follow-up question if you need the rest.]';

const SAFE_FALLBACK_MESSAGE =
  "Sorry, something went wrong while preparing that response. Please try rephrasing your question, or ask again in a moment.";

// Fixed set of sensitive-looking substrings to check for regardless of the
// per-request system instruction (covers config/secret names that should
// never legitimately appear in a coaching answer).
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
 * Does `haystack` contain a long verbatim chunk of `needle`? Used to check
 * whether a response accidentally echoes back its own system instructions.
 * Scans in fixed-size overlapping windows rather than requiring the whole
 * string to match, so a partial echo is still caught.
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
 * Truncates `text` to roughly `maxLength`, preferring to cut at the last
 * sentence boundary within a lookback window (falling back to the last
 * whitespace, then a hard cut) so the result doesn't end mid-word, and
 * appends a short note explaining the truncation.
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
 * Validates and, if necessary, sanitizes a model response before it's
 * persisted or sent to a teacher.
 * @param {string} text the candidate response text
 * @param {{ systemInstructionText?: string }} [options] the actual system
 *   instruction used for this request, if leak-checking against it is
 *   desired (optional — the fixed sensitive-marker check always runs).
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
