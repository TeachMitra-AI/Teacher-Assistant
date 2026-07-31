// Deterministic vocabulary recovery (Alternative A).
//
// Fills `grade` and `subject` when the teacher plainly said them and the model
// did not report them. M7a measured those two slots at 23.9% and 22.7%
// extraction against a Definition of Done of 85%, and the failure a teacher
// sees is the right form opening with the class and subject blank.
//
// ─── WHY THIS IS NOT A PROMPT CHANGE ───────────────────────────────────────
// Because one was tried and measured. Describing the slots in the classifier
// prompt regressed EVERY slot and routing metric on a full live pass (grade
// 23.9% -> 9.1%, routing recall 89.6% -> 84.0%), and it was un-diagnosable
// because a prompt edit perturbs the whole decision at once. Nothing in this
// file can reach the model: no prompt, no schema, no parameter. Routing
// precision, recall and decision accuracy are therefore STRUCTURALLY invariant
// across this change, which is what makes it measurable in a single pass.
//
// ─── WHAT THIS FILE OWNS, AND WHAT IT MUST NEVER OWN ───────────────────────
// It owns ONE question: WHICH SUBSTRING OF THE UTTERANCE IS WORTH ASKING ABOUT?
// It does not own what that substring MEANS. Every canonical value below comes
// from actions/vocab/, unchanged, which stays the single canonicalization
// authority (decision D10, guardrail G5). A second opinion about what "class 5"
// resolves to is exactly the kind of duplication that drifts silently.
//
// ─── WHY SPANS, AND NOT THE WHOLE UTTERANCE ────────────────────────────────
// The obvious implementation — hand the utterance to mapGrade — was tried and
// MEASURED WRONG before this module was written:
//
//     mapGrade('I have 5 students')  -> mapped: Class 3-5     (false positive)
//     mapGrade('Chapter 5')          -> mapped: Class 3-5     (false positive)
//     mapSubject('Math teacher')     -> mapped: Mathematics   (false positive)
//     mapGrade(<130-char utterance>) -> unmapped              (silent recall loss)
//
// Two causes, both correct behaviour for the mappers' designed input and wrong
// for a sentence. grades.js#readClassNumber gates roman numerals and cardinal
// words on class context but returns a BARE DIGIT immediately — right when the
// phrase IS the grade ("5"), wrong when it is prose. And shared.js#normalize
// returns '' above MAX_RAW_LENGTH (120), which whole utterances routinely
// exceed.
//
// So this module isolates a short span first and passes only that span to the
// mapper. The span is always a few tokens, which puts the length cap out of
// reach as a side effect rather than by working around it.
//
// This module is pure: no network, no storage, no clock, no model, no mutation
// of its arguments.

const { mapGrade, CLASS_KEYWORDS } = require('../actions/vocab/grades');
const { mapSubject } = require('../actions/vocab/subjects');
const { VOCAB_STATUS } = require('../actions/vocab/shared');

/**
 * The only slots this stage will ever fill.
 *
 * Deliberately a closed list rather than "every vocab slot". `language` is
 * excluded on the descriptor's own instruction — it must be set ONLY from an
 * explicit request, never inferred from the script the teacher typed in,
 * because getting it wrong prints the wrong language, and its baseline
 * denominator (4 cases) could not prove a change either way. `topic` is
 * excluded because it is free text: there is no closed vocabulary to validate a
 * span against, so any span would be a guess wearing a confident badge.
 */
const RECOVERABLE_SLOTS = Object.freeze(['grade', 'subject']);

/**
 * How far from a class keyword a number may sit and still be that class.
 *
 * Two tokens covers every phrasing in the acceptance set, in three scripts:
 * "class 5", "5th class", "standard vii", "कक्षा 5", "पाँचवीं कक्षा", and the
 * padded "…students in class 5". Wider starts pulling unrelated numbers into
 * the window — "chapter 8 for class 3" already reaches two distinct bands at
 * this width, and is rejected as ambiguous rather than guessed at, which is the
 * behaviour we want at the boundary.
 */
const CLASS_PROXIMITY = 2;

/**
 * Beyond this many tokens, stop scanning.
 *
 * A bound on work for a pathological input, not a quality rule. Matches the
 * client intent gate's own ceiling, above which an utterance is prose rather
 * than an instruction.
 */
const MAX_TOKENS = 60;

/**
 * Words that make a subject mention describe a PERSON OR A PLACE rather than
 * the worksheet's subject.
 *
 * "Math teacher" is who the teacher is, not what the worksheet is about. This
 * is the subject gate in full: the vocabulary tokens themselves are
 * distinctive, so the risk was never the token — it is what the token is
 * attached to.
 *
 * NOT sourced from actions/vocab/: these words name no subject and belong to no
 * vocabulary. Putting them there would make the mappers answer a question they
 * are not asked (what is this phrase ABOUT?) and would change their behaviour
 * for the classifier path too.
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
 * How far past a subject mention to look for a role noun.
 *
 * Two, so "social studies teacher" is refused: the mention matches on "social"
 * alone, which leaves "studies" between it and the word that gives the phrase
 * away.
 *
 * Deliberately NOT wide, and deliberately not containing "class": "science for
 * class 5" is an ordinary worksheet request, and a set or a window that swept
 * that up would trade a rare false positive for a very common false negative.
 * Only words naming a PERSON or a DEPARTMENT appear above.
 */
const ROLE_LOOKAHEAD = 2;

/**
 * Markers that mean the subject word is GOVERNED BY A PREPOSITION, and is
 * therefore naming something other than the worksheet's subject.
 *
 * Found by the replay corpus, not by reasoning, and it caught five false
 * positives the role-noun guard let through. Two roles, one grammar:
 *
 *   THE OUTPUT LANGUAGE   "write it in Hindi", "hindi mein likho",
 *                         "हिंदी में लिखो" — the teacher is asking for the
 *                         worksheet to be WRITTEN in Hindi, not to be about it.
 *   THE TOPIC             "worksheet banao algebra par" — subjects.js maps
 *                         "algebra" to Mathematics, so without this the subject
 *                         would be INFERRED FROM THE TOPIC, which this stage is
 *                         explicitly forbidden to do.
 *
 * English puts the marker BEFORE ("in Hindi", "on algebra"); Hindi and Hinglish
 * put it AFTER, as a postposition ("hindi mein", "algebra par"). Both sides are
 * checked because both phrasings are ordinary in the target input.
 *
 * Deliberately NOT including "for": "a worksheet for maths" names the subject,
 * and demoting it would trade a rare false positive for a common false negative.
 */
const DEMOTING_BEFORE = new Set(['in', 'on', 'about', 'par', 'mein', 'में', 'पर']);
const DEMOTING_AFTER = new Set(['mein', 'में', 'par', 'पर']);

/**
 * Token-level anything-that-could-be-a-class-number.
 *
 * Used ONLY to decide whether a candidate existed at all, which is what
 * separates the `rejected` counter (we saw a number and refused it — the
 * false-positive control's own evidence) from `skipped` (there was nothing to
 * consider). It never decides a value; `mapGrade` does that.
 *
 * Includes Devanagari digits so "कक्षा ५" counts as a candidate; the mapper
 * converts them when it normalizes the span.
 */
const NUMBER_LIKE = /^(?:\d{1,2}(?:st|nd|rd|th)?|[०-९]{1,2})$/;

/**
 * Split an utterance into comparable tokens, lower-cased.
 *
 * Deliberately NOT shared.js#normalize: that is the MAPPERS' normalization and
 * it caps at 120 characters, which is precisely the limit this module exists to
 * work around. This is a cheaper, different job — find token boundaries in a
 * whole sentence — and the span handed to the mapper is normalized there, by
 * the mapper, as it always has been.
 *
 * `\p{M}` (combining marks) is as load-bearing as `\p{L}`: Devanagari writes
 * its vowels and virama as marks, so a class of letters and digits alone would
 * split "पाँचवीं" into fragments that match nothing, and every Hindi phrase
 * would silently fail with no test noticing.
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
 * Collapse a set of mapper results into one decision.
 *
 * MAPPED-ONLY, and that is the rule that keeps this stage from ever making the
 * teacher's experience worse. A span the mapper calls `ambiguous` or
 * `contradiction` is reported as ambiguous here and recovers NOTHING: a scanner
 * must never be the thing that raises a clarifying question, because it has far
 * less context than the model whose reading it is standing in for.
 *
 * Two spans agreeing on one canonical value is a confident fill ("class 5" and
 * "5th standard" in one sentence). Two spans disagreeing is ambiguity, not a
 * majority vote.
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
 * Grade: a number is only a class when the sentence says it is one.
 *
 * THE ENTIRE FALSE-POSITIVE CONTROL IS THE CLASS-KEYWORD ANCHOR. Every span
 * probed here is a window around a word from CLASS_KEYWORDS — the same set
 * grades.js already uses to gate its roman numerals and cardinal words, imported
 * rather than restated. A bare number with no such word nearby is never
 * recovered, which is what rejects "I have 5 students", "Chapter 5", "5 marks",
 * "Roll No. 5", "Section 5", "5 days" and "5 lessons" without naming any of them.
 *
 * The cost, stated: a grade written with NO class word ("worksheet for 5th")
 * is not recovered. That is a deliberate miss. A missed recovery leaves today's
 * behaviour; a false one prefills a confident wrong class.
 */
function recoverGrade(tokens) {
  const anchors = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (CLASS_KEYWORDS.has(tokens[i])) anchors.push(i);
  }

  // Did the utterance contain anything that COULD have been a class? This
  // separates "refused a candidate" from "there was nothing here", and only the
  // first is evidence about the gate.
  const sawCandidate = anchors.length > 0 || tokens.some((token) => NUMBER_LIKE.test(token));

  if (anchors.length === 0) {
    return sawCandidate ? { outcome: 'rejected' } : { outcome: 'none' };
  }

  const results = [];
  for (const anchor of anchors) {
    const from = Math.max(0, anchor - CLASS_PROXIMITY);
    const to = Math.min(tokens.length, anchor + CLASS_PROXIMITY + 1);
    // The span is re-joined from tokens rather than sliced out of the original
    // string. The mapper re-normalizes whatever it is given, so the only thing
    // that matters is that the tokens and their order survive.
    results.push(mapGrade(tokens.slice(from, to).join(' ')));
  }

  const collapsed = collapse(results);
  if (collapsed.outcome === 'none') {
    return sawCandidate ? { outcome: 'rejected' } : { outcome: 'none' };
  }
  return collapsed;
}

/**
 * Subject: the vocabulary token is distinctive; what follows it is the risk.
 *
 * ─── SINGLE TOKEN FIRST, THEN THE PAIR ─────────────────────────────────────
 * The obvious order is the wrong one, and it silently defeated this guard when
 * the module was first written: `mapSubject('math teacher')` MAPS, because the
 * mapper collects the synonyms it recognises and ignores every other token.
 * Probing the pair first therefore swallowed "teacher" INTO the matched span and
 * then looked for a role noun past it — so "Math teacher" recovered Mathematics,
 * which is one of the two cases this gate exists to refuse.
 *
 * A single token is tried first, and the pair only when it maps nothing. The
 * pair still earns its place: subjects.js collapses "environmental studies" to
 * one synonym that neither word produces on its own.
 *
 * The guard then looks ROLE_LOOKAHEAD tokens past whatever ACTUALLY matched.
 * "maths teacher" describes a person, "maths worksheet" describes the artefact.
 * Nothing else about the sentence is consulted, because anything more would be
 * inference rather than reading.
 */
function recoverSubject(tokens) {
  const results = [];
  let sawCandidate = false;

  for (let i = 0; i < tokens.length; i += 1) {
    // A SPAN MAY NEVER BEGIN ON A GOVERNING WORD. Without this the pair probe
    // swallows the preposition — `mapSubject('in hindi')` maps, because the
    // mapper ignores tokens it does not recognise — and the guard below then
    // looks for a marker PAST the span and finds none. That is the same
    // swallowing bug the single-before-pair ordering fixes for role nouns, one
    // level up, and it left "write it in Hindi" recovering subject=Hindi.
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
 * Recover the vocabulary slots the model left empty.
 *
 * Runs AFTER parseProposal (so the intent is authorized and the descriptor is
 * known) and BEFORE resolveSlots (so precedence stays resolver policy, in one
 * place). Deliberately NOT inside sanitizeSlots: that is the untrusted-model
 * boundary, and injecting our own parser's output into the model's raw slot bag
 * would make `dropped` describe this module as though the model had produced it.
 *
 * Never throws — a defect here must cost a recovery opportunity and nothing
 * else (G22, invariant I11). The caller sits in front of a text box.
 *
 * @param {object} args
 * @param {object} args.descriptor the authorized action descriptor
 * @param {string} args.utterance the normalized utterance for THIS turn only
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
      // Three independent conditions, all required:
      //   - the action actually declares this slot
      //   - it is one of the two slots this stage supports
      //   - THE MODEL DID NOT ALREADY FILL IT (rule R2 — never overwrite Gemini,
      //     enforced structurally here rather than by convention downstream)
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
    // A bug in the scanner is not the teacher's problem. Everything recovered
    // before the throw is discarded so the outcome is all-or-nothing rather
    // than half-applied.
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
