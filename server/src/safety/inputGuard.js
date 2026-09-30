// Input-side safety helpers for the coaching flow. Pure functions, no DB or network.
// The real defence against prompt injection is the systemInstruction/userContent split in prompts.js and gemini.js.
// These are secondary layers: normalization closes an obfuscation trick, and the injection heuristic is advisory
// only (never blocks), since keyword matching is bypassable and prone to false positives on teacher language.

// Invisible and control characters that can hide or break up an injection payload. \t, \n and \r are kept for
// multi-line questions. Built from escaped strings so the source file stays plain ASCII.
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
 * Normalizes a raw query: Unicode NFKC (folds alternate encodings) and strips invisible/control characters.
 * @param {string} raw
 * @returns {string}
 */
function normalizeQuery(raw) {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFKC').replace(INVISIBLE_OR_CONTROL_CHARS, '').trim();
}

// Each pattern is narrow (several specific words in a specific relationship) to keep false positives low:
// "ignore" alone is common in legitimate questions; only "ignore + previous/above/prior + instructions" is flagged.
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
 * Non-blocking heuristic: does this query resemble a prompt-injection attempt? Only used to flag a
 * best-effort telemetry record. False positives cost nothing; false negatives are expected, since the real protection is architectural.
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

// A request to teach about an emergency topic ("how do I teach first aid?") always wins over symptom or
// threat words elsewhere in the question. Checked before, and short-circuits, the situation patterns below.
const TEACHING_ABOUT_PATTERN =
  /\b(how (do|can|should) i teach|how to teach|lesson plan|teach (my )?students? (about|how)|activit(y|ies) (for|about|on|to teach)|create a lesson|explain to (my )?students?|how (do|can|should) i explain|ways to teach|what should i teach)\b/i;

// Narrow multi-word phrases for an active situation; bare words like "emergency" or "safety" are common in lesson planning.
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
 * Does this query describe an active, possibly real emergency, as opposed to teaching about one? A match
 * routes to a dedicated emergency-safe prompt (prompts.js). The backstop for a missed detection is the
 * highest-priority override instruction in the normal system prompt.
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
