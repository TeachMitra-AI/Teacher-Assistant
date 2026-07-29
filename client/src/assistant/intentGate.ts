// AI Action Router — the client intent gate (Phase 1, Milestone M6).
//
// One question, answered locally in about zero milliseconds: DOES THIS LOOK
// LIKE A COMMAND? Nothing here classifies. It decides only whether the server
// is worth asking, and everything it rejects goes straight to the coach exactly
// as it does today.
//
// ─── TUNED FOR PRECISION, NOT RECALL (amendment CHANGE-2) ──────────────────
// The original design said "over-refer, never decide", on the reasoning that a
// false maybe costs one round trip. That reasoning is wrong, and the reversal is
// binding: a false maybe costs the FULL classifier budget ADDED TO the coach
// call, on the app's most common path, for teachers who may never use the
// router. A missed routing costs one manual navigation — which is today's
// experience and nobody's crisis. Five extra seconds on every coaching question
// costs adoption.
//
// So the rule is deliberately narrow: an imperative verb adjacent to a domain
// noun, no leading interrogative, no question mark. "Generate a Class 5
// fractions worksheet" passes. "How do I make a worksheet?" does not, and that
// is correct — it is a question about teaching, and the coach answers it well.
//
// The recall gap this leaves is REAL, and M7 MEASURED it rather than leaving it
// to intuition: over the 196-turn labelled corpus the gate scores 96.1% precision
// and 92.5% recall, declining 8 utterances that were labelled as actions (see
// intentGate.eval.test.ts, which reads that corpus directly). CHANGE-2's
// precision-first bet costs less than its own author feared.
//
// Those 8 are the measured price, and they are named rather than guessed at.
// Widening the vocabulary below on the strength of one remembered phrasing is
// still exactly how thresholds stop being evidence-based (technical-debt item
// #12) — the eval pins the gate's counts, so any change here must re-promote
// them deliberately.
//
// This module is pure: no network, no storage, no DOM, no React.

import { MAX_UTTERANCE_LENGTH } from './types';

/**
 * Builds a lookup set in the SAME normal form the input is compared in.
 *
 * This is load-bearing for Devanagari, not housekeeping. NFKC decomposes nukta
 * letters — "ज़" becomes "ज" + a combining nukta, because Devanagari nukta
 * compositions sit on Unicode's composition-exclusion list — so a literal typed
 * in its precomposed form here would never match a normalized utterance. Every
 * Hindi entry below would silently never fire, and nothing would fail.
 */
function vocabulary(words: string[]): Set<string> {
  return new Set(words.map((word) => word.normalize('NFKC').toLowerCase()));
}

/**
 * Imperative verbs that mean "produce something" or "take me somewhere",
 * across the three languages a teacher actually types in: English, romanized
 * Hinglish, and Devanagari Hindi.
 *
 * Hinglish carries several spellings of the same word because teachers type
 * phonetically and no spelling is authoritative ("banao"/"bnao"/"banaao").
 * These are matched as whole tokens, never as substrings — a substring match on
 * "de" would fire on "define", "december" and "understand".
 *
 * Note what is NOT here: "do", "de" and "take". Each is a plausible request verb
 * and each also appears constantly in ordinary coaching prose ("do my students
 * need…", "my students take a test tomorrow"), where it would sit inside the
 * proximity window of a domain noun and fire. Precision first: their recall is
 * already covered by "bana do" (which tokenizes to "bana"), "dijiye", and
 * "open"/"show".
 */
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

/**
 * Nouns naming something this application can actually produce or open.
 *
 * Scoped to the Phase 1 domain on purpose. A noun list covering the whole
 * product would refer utterances the catalog has no action for, spending the
 * classifier budget to be told "not an action" — the precise cost CHANGE-2
 * exists to avoid. Phase 2 widens this alongside the actions that justify it.
 */
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

/**
 * Openers that make an utterance a QUESTION, whatever else it contains.
 *
 * "How do I make a worksheet?" contains a command verb next to a domain noun
 * and is still a coaching question. Checking only the first token keeps this
 * cheap and keeps it from swallowing legitimate commands that merely mention
 * one of these words later ("make a quiz on what plants need").
 */
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

/**
 * How far apart a verb and a noun may sit and still count as "adjacent".
 *
 * Six tokens covers the real phrasings in all three languages, including the
 * verb-final Hinglish word order ("Class 3 ke liye maths quiz banao", where the
 * noun precedes the verb) and English's habit of stacking a determiner, an
 * adjective, a class and a subject in between ("make a short class 5 maths
 * quiz" — six exactly, and the case that set this number).
 *
 * Wider than this starts matching sentences that merely mention both words:
 * "make sure the students have finished their homework before the test" is
 * eleven apart and must stay on the coach path.
 */
const PROXIMITY_TOKENS = 6;

/**
 * Beyond this, an utterance is prose rather than an instruction.
 *
 * A teacher describing a classroom situation writes paragraphs; a teacher asking
 * for a worksheet writes a line. This also keeps the gate from referring
 * something that would only be a slow way of reaching the coach.
 */
const MAX_TOKENS = 40;

/**
 * NFKC + lowercase + whitespace collapse.
 *
 * Deliberately NOT the server's `normalizeQuery`: that lives in the server's
 * safety guards, which are consumed and never re-implemented (this is a
 * different, cheaper job — a cache key and a token split, not a safety
 * boundary). Devanagari has no case, so `toLowerCase` is a no-op there and the
 * tables above carry the script's own forms.
 *
 * Exported because the repeat cache keys on exactly this string: two spellings
 * that normalize the same must hit the same cache entry.
 */
export function normalizeUtterance(text: string): string {
  if (typeof text !== 'string') return '';
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Split into comparable word tokens.
 *
 * Punctuation is stripped rather than kept, so "worksheet." and "worksheet"
 * match, and hyphenated forms split into their parts.
 *
 * `\p{M}` — combining marks — is as load-bearing here as `\p{L}`. Devanagari
 * writes its vowels and its virama as marks, so "बनाओ" is ब + न + ा + ओ and a
 * class of letters and digits alone would split it into fragments that match
 * nothing. Every Hindi phrase would silently fail the gate, and no test that
 * only fed it English would notice.
 */
function tokenize(normalized: string): string[] {
  return normalized.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
}

/** Indexes of every token present in `lexicon`. */
function matchIndexes(tokens: string[], lexicon: Set<string>): number[] {
  const found: number[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (lexicon.has(tokens[i])) found.push(i);
  }
  return found;
}

/**
 * Should this utterance be sent to the server for classification?
 *
 * `true` means "worth asking", never "this is a command" — the server decides
 * that, and passthrough remains by far its most common answer. `false` means the
 * message goes to the coach with zero added latency and zero cost, which is the
 * outcome this function is tuned to produce for anything it is not sure about.
 */
export function isCommand(text: string): boolean {
  const normalized = normalizeUtterance(text);
  if (!normalized) return false;

  // The server rejects an over-long utterance with a 400 (envelope validation),
  // so referring one is a guaranteed wasted round trip. Checking the RAW length
  // matches what the request body would carry.
  if (text.length > MAX_UTTERANCE_LENGTH) return false;

  // A question mark makes it a question. Cheap, and it costs almost no recall:
  // teachers do not punctuate instructions with question marks.
  if (normalized.includes('?') || normalized.includes('？')) return false;

  const tokens = tokenize(normalized);
  if (tokens.length === 0 || tokens.length > MAX_TOKENS) return false;

  if (QUESTION_OPENERS.has(tokens[0])) return false;

  const verbs = matchIndexes(tokens, COMMAND_VERBS);
  if (verbs.length === 0) return false;

  const nouns = matchIndexes(tokens, DOMAIN_NOUNS);
  if (nouns.length === 0) return false;

  // Adjacency in either direction: English puts the verb first, Hinglish
  // routinely puts it last.
  return verbs.some((v) => nouns.some((n) => Math.abs(v - n) <= PROXIMITY_TOKENS));
}

/** Test seams: the thresholds are policy, and the tests assert the policy rather than re-declaring it. */
export const GATE_PROXIMITY_TOKENS = PROXIMITY_TOKENS;
export const GATE_MAX_TOKENS = MAX_TOKENS;
