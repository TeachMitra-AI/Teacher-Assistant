// Input-side AI safety helpers for the coaching flow. Pure functions only —
// no DB/network access — so they're trivial to unit test in isolation.
//
// Design note: the real defense against prompt injection is the structural
// systemInstruction/userContent split in prompts.js + gemini.js (the model
// is given a real API-level boundary between trusted instructions and the
// teacher's text). Everything here is a secondary, low-cost layer:
// normalization closes an obfuscation trick, and the injection heuristic is
// explicitly advisory-only (never blocks a request) — keyword-matching is
// well known to be both bypassable and prone to false positives on
// legitimate teacher language, so it must not be the thing standing between
// a teacher and an answer.

// Strips characters that carry no visible meaning but can be used to hide
// or break up an injection payload, plus stray control characters — while
// deliberately keeping \t, \n, \r, since teachers may legitimately write
// multi-line questions. Built from an escaped-string list (rather than a
// regex literal containing the raw characters) so this source file only
// ever contains plain, visible ASCII — no invisible/control bytes actually
// live in the file itself.
const INVISIBLE_OR_CONTROL_RANGES = [
  '\\u0000-\\u0008', // C0 controls before \t
  '\\u000B\\u000C', // vertical tab, form feed
  '\\u000E-\\u001F', // C0 controls after \r
  '\\u007F-\\u009F', // DEL + C1 controls
  '\\u200B-\\u200F', // zero-width space/non-joiner/joiner, LTR/RTL marks
  '\\u202A-\\u202E', // bidi embedding/override controls (LRE RLE PDF LRO RLO)
  '\\u2060-\\u2069', // word joiner + bidi isolate controls (LRI RLI FSI PDI)
  '\\uFEFF', // zero-width no-break space / byte-order mark
].join('');
const INVISIBLE_OR_CONTROL_CHARS = new RegExp('[' + INVISIBLE_OR_CONTROL_RANGES + ']', 'g');

/**
 * Normalizes a raw query before it's used anywhere: Unicode NFKC
 * normalization (folds visually-identical alternate encodings to a single
 * form) plus stripping invisible/control characters. Does not otherwise
 * change meaning, casing, or length in any way a human reader would notice.
 * @param {string} raw
 * @returns {string}
 */
function normalizeQuery(raw) {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC').replace(INVISIBLE_OR_CONTROL_CHARS, '').trim();
}

// Each pattern is deliberately narrow (multiple specific words in a specific
// relationship) rather than a single broad keyword, to keep the false-positive
// rate low on ordinary classroom language — e.g. "ignore" alone is common in
// legitimate questions ("students keep ignoring instructions"); only the
// "ignore + previous/above/prior + instructions" combination is flagged.
const INJECTION_PATTERNS = [
  { category: 'ignore_instructions', pattern: /\bignore\s+(all\s+|the\s+)?(previous|above|prior)\s+instructions?\b/i },
  { category: 'disregard_instructions', pattern: /\bdisregard\s+(all\s+|the\s+)?(previous|above|prior)\b/i },
  { category: 'reveal_system_prompt', pattern: /\b(reveal|show|print|output|repeat)\s+(your|the)\s+(system|hidden|internal)\s+(prompt|instructions?)\b/i },
  { category: 'reveal_system_prompt', pattern: /\bwhat\s+(is|are)\s+your\s+(system\s+prompt|instructions|rules|guidelines)\b/i },
  { category: 'role_override', pattern: /\byou\s+are\s+now\s+(a|an)\b/i },
  { category: 'role_override', pattern: /\bpretend\s+(you|to)\s+(have\s+no|are\s+not|ignore)\b/i },
  { category: 'developer_mode', pattern: /\b(developer|debug|admin|god)\s*mode\b/i },
  { category: 'jailbreak', pattern: /\bjailbreak\b/i },
  { category: 'forget_instructions', pattern: /\bforget\s+(your|all|the)\s+(instructions|rules|guidelines)\b/i },
  { category: 'role_spoof', pattern: /^\s*(system|assistant)\s*:/i },
  { category: 'repeat_above', pattern: /\b(repeat|translate|summarize)\s+(everything\s+|the\s+text\s+)?above\b/i },
];

/**
 * Non-blocking heuristic: does this query resemble a common prompt-injection
 * attempt? Never used to reject a request — only to flag it for a
 * best-effort telemetry record. False positives here cost nothing (the
 * request still proceeds); false negatives are expected and fine, since the
 * real protection is architectural (see module doc comment above).
 * @param {string} query
 * @returns {{ flagged: boolean, category: string | null }}
 */
function flagPossibleInjection(query) {
  if (typeof query !== 'string' || query.length === 0) {
    return { flagged: false, category: null };
  }
  for (const { category, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(query)) {
      return { flagged: true, category };
    }
  }
  return { flagged: false, category: null };
}

// Strong signal this is a request to TEACH about an emergency-related topic
// ("how do I teach first aid?"), not a description of something happening
// right now — always wins even if a symptom/threat word appears elsewhere
// in the same question (e.g. "how do I teach students to recognize chest
// pain as a heart attack sign?"). Checked before the situation patterns
// below, and short-circuits them.
const TEACHING_ABOUT_PATTERN =
  /\b(how (do|can|should) i teach|how to teach|lesson plan|teach (my )?students? (about|how)|activit(y|ies) (for|about|on|to teach)|create a lesson|explain to (my )?students?|how (do|can|should) i explain|ways to teach|what should i teach)\b/i;

// Deliberately narrow: multi-word phrases specific to an ACTIVE situation,
// not bare topic words (no bare "emergency", "safety", or "injury" — those
// alone appear constantly in ordinary lesson-planning questions, e.g.
// "emergency preparedness" or "safety rules").
const EMERGENCY_SITUATION_PATTERNS = [
  {
    category: 'medical_emergency',
    pattern:
      /\b(chest pain|difficulty breathing|can'?t breathe|not breathing|stopped breathing|severe(ly)? bleeding|bleeding (heavily|a lot)|won'?t stop bleeding|unconscious|passed out|collapsed|having a seizure|convulsing|choking|anaphyla(xis|ctic)|severe allergic reaction|throat (is |)swelling|turning blue|losing consciousness|no pulse|(is|seems|isn'?t)\s+unresponsive)\b/i,
  },
  {
    category: 'safety_threat',
    pattern:
      /\b(has a (knife|gun|weapon)|is being attacked|is attacking (another|other|a) student|fire in the (classroom|school|building)|(the )?building is on fire|there'?s? an intruder|trying to hurt (himself|herself|themselves|another student)|threatening to (hurt|kill))\b/i,
  },
  {
    category: 'serious_injury',
    pattern: /\b(severe(ly)? injured|serious(ly)? injured|badly hurt|broken (bone|arm|leg|neck)|head injury)\b/i,
  },
];

/**
 * Does this query describe an ACTIVE, potentially real emergency — as
 * opposed to a request to teach about an emergency-related topic? This is
 * one layer of two: a positive match here routes straight to a dedicated
 * emergency-safe prompt (see prompts.js), but the real backstop against a
 * false negative is an unconditional, explicitly-highest-priority override
 * instruction baked into the normal system prompt itself, so a missed
 * detection here still has a chance to be caught by the model recognizing
 * the situation from context — not just from these keywords.
 * @param {string} query
 * @returns {{ isEmergency: boolean, category: string | null }}
 */
function detectEmergency(query) {
  if (typeof query !== 'string' || query.length === 0) {
    return { isEmergency: false, category: null };
  }
  if (TEACHING_ABOUT_PATTERN.test(query)) {
    return { isEmergency: false, category: null };
  }
  for (const { category, pattern } of EMERGENCY_SITUATION_PATTERNS) {
    if (pattern.test(query)) {
      return { isEmergency: true, category };
    }
  }
  return { isEmergency: false, category: null };
}

module.exports = { normalizeQuery, flagPossibleInjection, detectEmergency };
