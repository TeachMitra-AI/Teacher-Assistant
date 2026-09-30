// Cheap local check for "does this look like a command?", so we only ask the server when it's worth a round trip.
// Tuned for precision over recall: a false positive adds a full classifier call in front of the coach on the most
// common path, while a miss just means the teacher navigates manually. The rule is an imperative verb near a
// domain noun, no leading question word and no "?". Measured precision/recall live in intentGate.eval.test.ts.
// Pure module: no network, storage, DOM or React.

import { MAX_UTTERANCE_LENGTH } from './types';

// Built in the same normal form the input is compared in. NFKC splits nukta letters ("ज़" becomes ज + nukta), so a
// precomposed literal would never match and the Hindi entries would silently never fire.
function vocabulary(words: string[]): Set<string> {
  return new Set(words.map((word) => word.normalize('NFKC').toLowerCase()));
}

// Imperative verbs meaning "produce something" or "take me somewhere", in English, romanized Hinglish and Devanagari.
// Hinglish carries several spellings since people type phonetically. Matched as whole tokens, never substrings
// ("de" would hit "define"). "do", "de" and "take" are left out on purpose: they're common in ordinary coaching
// prose ("do my students need…"); "bana do", "dijiye" and "open"/"show" already cover them.
const COMMAND_VERBS = vocabulary([
  // English
  'generate', 'create', 'make', 'build', 'prepare', 'draft', 'design', 'set',
  'open', 'show', 'give', 'start', 'launch',
  // Hinglish (romanized)
  'banao', 'bana', 'banado', 'banaiye', 'banaye', 'bnao', 'banaao',
  'kholo', 'khol', 'kholiye', 'dikhao', 'dikhaiye', 'dijiye',
  'chahiye', 'nikalo', 'taiyar', 'tayyar',
  // Hindi (Devanagari)
  'बनाओ', 'बनाइए', 'बनाएं', 'बनाये', 'खोलो', 'खोलिए', 'दिखाओ', 'दिखाइए',
  'दीजिए', 'चाहिए', 'तैयार',
]);

// Nouns for things the app can produce or open. Kept to the current actions so we don't classify utterances
// the catalog has no action for.
const DOMAIN_NOUNS = vocabulary([
  // English
  'quiz', 'quizzes', 'worksheet', 'worksheets', 'test', 'tests', 'paper',
  'papers', 'assessment', 'assessments', 'exam', 'exams', 'questions',
  'questionnaire', 'generator', 'mcq', 'mcqs',
  // Hinglish (romanized)
  'prashn', 'prashnpatra', 'parikshan', 'pariksha', 'patra', 'sawaal', 'sawal',
  // Hindi (Devanagari)
  'क्विज', 'क्विज़', 'प्रश्न', 'प्रश्नपत्र', 'परीक्षा', 'पेपर', 'सवाल', 'वर्कशीट',
]);

// Openers that make an utterance a question even if it has a verb and noun ("How do I make a worksheet?").
// Only the first token is checked, so "make a quiz on what plants need" still passes.
const QUESTION_OPENERS = vocabulary([
  // English
  'how', 'why', 'what', 'when', 'where', 'which', 'who', 'should', 'can',
  'could', 'would', 'is', 'are', 'was', 'were', 'do', 'does', 'did', 'am', 'may',
  // Hinglish (romanized)
  'kaise', 'kaisay', 'kaisa', 'kyun', 'kyu', 'kyon', 'kya', 'kaun',
  'kab', 'kahan', 'kitna', 'kitne',
  // Hindi (Devanagari)
  'कैसे', 'क्यों', 'क्या', 'कौन', 'कब', 'कहाँ', 'कहां', 'कितने', 'कितना',
]);

// Max token distance between verb and noun. Six covers "make a short class 5 maths quiz" and verb-final Hinglish
// ("Class 3 ke liye maths quiz banao"); wider starts matching prose like "make sure the students have finished
// their homework before the test".
const PROXIMITY_TOKENS = 6;

// Beyond this an utterance is prose, not an instruction.
const MAX_TOKENS = 40;

// NFKC + lowercase + whitespace collapse. Not the server's normalizeQuery, which belongs to its safety guards.
// Exported because the repeat cache keys on this string.
export function normalizeUtterance(text: string): string {
  if (typeof text !== 'string') return '';
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

// \p{M} matters: Devanagari vowels and virama are combining marks, so without it "बनाओ" splits into fragments and
// every Hindi phrase fails the gate.
function tokenize(normalized: string): string[] {
  return normalized.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
}

function matchIndexes(tokens: string[], lexicon: Set<string>): number[] {
  const found: number[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (lexicon.has(tokens[i])) found.push(i);
  }
  return found;
}

/** `true` means "worth asking the server", not "this is a command". `false` sends the message straight to the coach. */
export function isCommand(text: string): boolean {
  const normalized = normalizeUtterance(text);
  if (!normalized) return false;

  // The server 400s over-long utterances, so referring one is a wasted round trip.
  if (text.length > MAX_UTTERANCE_LENGTH) return false;

  // A question mark means a question; teachers don't punctuate instructions that way.
  if (normalized.includes('?') || normalized.includes('？')) return false;

  const tokens = tokenize(normalized);
  if (tokens.length === 0 || tokens.length > MAX_TOKENS) return false;

  if (QUESTION_OPENERS.has(tokens[0])) return false;

  const verbs = matchIndexes(tokens, COMMAND_VERBS);
  if (verbs.length === 0) return false;

  const nouns = matchIndexes(tokens, DOMAIN_NOUNS);
  if (nouns.length === 0) return false;

  // Either direction: English is verb-first, Hinglish often verb-last.
  return verbs.some((v) => nouns.some((n) => Math.abs(v - n) <= PROXIMITY_TOKENS));
}

// Test seams: the thresholds are policy, so tests assert them rather than redeclare.
export const GATE_PROXIMITY_TOKENS = PROXIMITY_TOKENS;
export const GATE_MAX_TOKENS = MAX_TOKENS;
