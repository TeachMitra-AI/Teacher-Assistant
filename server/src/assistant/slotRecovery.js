// Fills `grade` and `subject` from the utterance when the teacher plainly said them and the model didn't.
// Pure code: nothing here reaches the prompt, schema or model, so routing behaviour is unchanged.
// It only picks which short span is worth asking about; canonical values still come from actions/vocab/.
// Whole-utterance mapping gave false positives ("I have 5 students" -> Class 3-5, "Math teacher" -> Mathematics)
// and hits shared.js's 120-char normalize cap, so we isolate a few tokens first and map only that.

const { mapGrade, CLASS_KEYWORDS } = require('../actions/vocab/grades');
const { mapSubject } = require('../actions/vocab/subjects');
const { VOCAB_STATUS } = require('../actions/vocab/shared');

/**
 * The only slots this stage fills. `language` is excluded (it must come from an explicit request, never
 * be inferred from the script typed) and `topic` is free text with no vocabulary to validate a span against.
 */
const RECOVERABLE_SLOTS = Object.freeze(['grade', 'subject']);

/**
 * How far from a class keyword a number may sit and still be that class. Two tokens covers "class 5",
 * "5th class", "standard vii", "कक्षा 5"; wider pulls in unrelated numbers ("chapter 8 for class 3" is rejected as ambiguous).
 */
const CLASS_PROXIMITY = 2;

/** Stop scanning after this many tokens; a work bound matching the client intent gate's ceiling. */
const MAX_TOKENS = 60;

/**
 * Words that make a subject mention describe a person or place rather than the worksheet's subject
 * ("Math teacher"). Kept out of actions/vocab/ since they name no subject.
 */
const ROLE_NOUNS = new Set([
  // English
  'teacher', 'teachers', 'faculty', 'department', 'dept', 'hod',
  'sir', 'madam', 'maam', 'staff', 'professor', 'lecturer', 'tutor',
  // Hinglish
  'shikshak', 'adhyapak', 'guruji', 'vibhag',
  // Hindi
  'शिक्षक', 'अध्यापक', 'अध्यापिका', 'विभाग',
]);

/**
 * How far past a subject mention to look for a role noun. Two, so "social studies teacher" is refused.
 * Not wider, and "class" is excluded: "science for class 5" is an ordinary request.
 */
const ROLE_LOOKAHEAD = 2;

/**
 * Markers meaning the subject word is governed by a preposition and names something else: the output
 * language ("write it in Hindi", "hindi mein likho") or the topic ("algebra par", which would otherwise
 * infer the subject from the topic). English puts the marker before, Hindi and Hinglish after, so both
 * sides are checked. "for" is omitted: "a worksheet for maths" names the subject.
 */
const DEMOTING_BEFORE = new Set(['in', 'on', 'about', 'par', 'mein', 'में', 'पर']);
const DEMOTING_AFTER = new Set(['mein', 'में', 'par', 'पर']);

/**
 * Anything that could be a class number, including Devanagari digits. Only decides whether a candidate
 * existed, separating `rejected` (saw a number and refused it) from `skipped`; `mapGrade` decides values.
 */
const NUMBER_LIKE = /^(?:\d{1,2}(?:st|nd|rd|th)?|[०-९]{1,2})$/;

/**
 * Split an utterance into lower-cased tokens. Not shared.js#normalize, which caps at 120 chars.
 * `\p{M}` matters: Devanagari vowels are combining marks, and without it Hindi words would split into fragments.
 */
function tokenize(utterance) {
  if (typeof utterance !== 'string' || utterance === '') return [];
  return utterance
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter(Boolean)
    .slice(0, MAX_TOKENS);
}

/**
 * Collapse mapper results into one decision. Mapped-only: an ambiguous or contradictory span recovers
 * nothing, since a scanner must not raise a clarifying question on less context than the model.
 * Two spans agreeing on a value is a fill; disagreeing is ambiguity, not a vote.
 *
 * @param {{status: string, value?: string}[]} results
 * @returns {{outcome: 'recovered', value: string}|{outcome: 'ambiguous'}|{outcome: 'none'}}
 */
function collapse(results) {
  const mapped = results.filter((r) => r.status === VOCAB_STATUS.MAPPED);
  const sawUncertain = results.some(
    (r) => r.status === VOCAB_STATUS.AMBIGUOUS || r.status === VOCAB_STATUS.CONTRADICTION
  );

  const distinct = [...new Set(mapped.map((r) => r.value))];

  if (distinct.length === 1 && !sawUncertain) return { outcome: 'recovered', value: distinct[0] };
  if (distinct.length > 1 || sawUncertain) return { outcome: 'ambiguous' };
  return { outcome: 'none' };
}

/**
 * Grade: a number is only a class when a CLASS_KEYWORDS word (the set grades.js uses) is nearby, which
 * rejects "I have 5 students", "Chapter 5", "Roll No. 5". A grade with no class word ("worksheet for 5th")
 * is deliberately missed: a miss keeps today's behaviour, a false fill prefills a wrong class.
 */
function recoverGrade(tokens) {
  const anchors = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (CLASS_KEYWORDS.has(tokens[i])) anchors.push(i);
  }

  // Separates "refused a candidate" from "nothing here"; only the first is evidence about the gate.
  const sawCandidate = anchors.length > 0 || tokens.some((token) => NUMBER_LIKE.test(token));

  if (anchors.length === 0) {
    return sawCandidate ? { outcome: 'rejected' } : { outcome: 'none' };
  }

  const results = [];
  for (const anchor of anchors) {
    const from = Math.max(0, anchor - CLASS_PROXIMITY);
    const to = Math.min(tokens.length, anchor + CLASS_PROXIMITY + 1);
    // Re-joined from tokens; the mapper re-normalizes, so only token order matters.
    results.push(mapGrade(tokens.slice(from, to).join(' ')));
  }

  const collapsed = collapse(results);
  if (collapsed.outcome === 'none') {
    return sawCandidate ? { outcome: 'rejected' } : { outcome: 'none' };
  }
  return collapsed;
}

/**
 * Subject: the vocabulary token is distinctive, what follows it is the risk. Tries a single token first,
 * then the pair. The pair first would swallow "teacher" into the span (`mapSubject('math teacher')`
 * maps) and the role-noun guard would look past it. The pair is still needed for synonyms like
 * "environmental studies". The guard looks ROLE_LOOKAHEAD tokens past whatever actually matched.
 */
function recoverSubject(tokens) {
  const results = [];
  let sawCandidate = false;

  for (let i = 0; i < tokens.length; i += 1) {
    // A span can't begin on a governing word. The pair probe would swallow the preposition
    // (`mapSubject('in hindi')` maps) and the guard would then look past it and miss it.
    if (DEMOTING_BEFORE.has(tokens[i])) continue;

    const single = mapSubject(tokens[i]);
    const pair = tokens.slice(i, i + 2);
    const pairResult =
      single.status === VOCAB_STATUS.UNMAPPED && pair.length === 2
        ? mapSubject(pair.join(' '))
        : null;

    const usePair = pairResult !== null && pairResult.status !== VOCAB_STATUS.UNMAPPED;
    const result = usePair ? pairResult : single;
    if (result.status === VOCAB_STATUS.UNMAPPED) continue;

    sawCandidate = true;

    const matchLength = usePair ? 2 : 1;
    const followers = tokens.slice(i + matchLength, i + matchLength + ROLE_LOOKAHEAD);

    // It names a person or a department, not the worksheet.
    if (followers.some((token) => ROLE_NOUNS.has(token))) continue;

    // It is governed by a preposition, so it names the output language or the
    // topic. See DEMOTING_BEFORE for the five corpus cases that require this.
    if (i > 0 && DEMOTING_BEFORE.has(tokens[i - 1])) continue;
    if (followers.length > 0 && DEMOTING_AFTER.has(followers[0])) continue;

    results.push(result);
  }

  const collapsed = collapse(results);
  if (collapsed.outcome === 'none') {
    return sawCandidate ? { outcome: 'rejected' } : { outcome: 'none' };
  }
  return collapsed;
}

const RECOVERERS = Object.freeze({
  grade: recoverGrade,
  subject: recoverSubject,
});

/**
 * Recover the vocabulary slots the model left empty. Runs after parseProposal (intent authorized) and
 * before resolveSlots (precedence stays there), and outside sanitizeSlots so our parser's output isn't
 * counted as the model's `dropped`. Never throws; a defect costs a recovery opportunity only.
 *
 * @param {object} args
 * @param {object} args.descriptor the authorized action descriptor
 * @param {string} args.utterance the normalized utterance for this turn only
 * @param {string[]} [args.alreadyFilled] slot names the model already reported
 * @returns {{
 *   recovered: Record<string, string>,
 *   skipped: string[],
 *   rejected: string[],
 *   ambiguous: string[]
 * }}
 */
function recoverSlots({ descriptor, utterance, alreadyFilled = [] } = {}) {
  const recovered = {};
  const skipped = [];
  const rejected = [];
  const ambiguous = [];

  try {
    if (!descriptor || !Array.isArray(descriptor.slots)) {
      return { recovered, skipped, rejected, ambiguous };
    }

    const filled = new Set(Array.isArray(alreadyFilled) ? alreadyFilled : []);
    const tokens = tokenize(utterance);
    if (tokens.length === 0) return { recovered, skipped, rejected, ambiguous };

    for (const slot of descriptor.slots) {
      // All required: the action declares the slot, it is grade/subject, and the model didn't already fill it
      // (never overwrite Gemini).
      if (!RECOVERABLE_SLOTS.includes(slot.name)) continue;
      if (slot.type !== 'vocab') continue;
      if (filled.has(slot.name)) continue;

      const result = RECOVERERS[slot.name](tokens);

      if (result.outcome === 'recovered') recovered[slot.name] = result.value;
      else if (result.outcome === 'ambiguous') ambiguous.push(slot.name);
      else if (result.outcome === 'rejected') rejected.push(slot.name);
      else skipped.push(slot.name);
    }
  } catch {
    // A scanner bug is not the teacher's problem; discard partial results so the outcome is all-or-nothing.
    return { recovered: {}, skipped: [], rejected: [], ambiguous: [] };
  }

  return { recovered, skipped, rejected, ambiguous };
}

module.exports = {
  RECOVERABLE_SLOTS,
  CLASS_PROXIMITY,
  ROLE_NOUNS,
  recoverSlots,
};
