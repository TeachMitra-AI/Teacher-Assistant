// Per-format presentation and purpose for generated assessments.
//
// Everything that differs BETWEEN formats lives here, in one table. These used
// to be `format === 'worksheet' ? … : …` ternaries inside the prompt builder
// and the renderer — correct while there were exactly two formats, and silently
// wrong the moment there is a third, because every unknown format falls through
// to the quiz branch and is labelled "Quiz".
//
// Adding a format is now three edits, each in its own concern:
//   1. FORMATS      in actions/schemas/generateAssessment.js  (the vocabulary)
//   2. FORMAT_META  here                                      (how it reads)
//   3. ASSESSMENT_FORMATS in client/src/config.ts             (the picker)
//
// (1) and (3) must land in the SAME commit — see the drift note in both files.
// (2) cannot be forgotten: the assertion at the bottom of this module runs at
// require time, so a format without metadata stops the server at boot instead
// of shipping documents labelled as the wrong thing.

const { FORMATS } = require('../actions/schemas/generateAssessment');

/**
 * `purpose` is the only genuinely generative field. It tells the model what the
 * document is FOR, which is what makes an exit ticket read differently from a
 * quiz of the same length — without it, a three-question exit ticket is just a
 * short quiz with a different heading.
 */
const FORMAT_META = Object.freeze({
  quiz: Object.freeze({
    noun: 'quiz',
    title: 'Quiz',
    answerKeyHeading: '## Answer Key',
    purpose:
      'A quiz that tests whether students have learned the topic. Questions should cover the topic broadly and be answerable from what was taught.',
  }),
  worksheet: Object.freeze({
    noun: 'worksheet',
    title: 'Worksheet',
    answerKeyHeading: '## Teacher Answer Key',
    purpose:
      'A worksheet students work through in class, with the teacher available to help. Questions should build up in difficulty and give students practice, not only test them.',
  }),
  exit_ticket: Object.freeze({
    noun: 'exit ticket',
    title: 'Exit Ticket',
    answerKeyHeading: '## Teacher Answer Key',
    purpose:
      "An exit ticket: a very short check handed to students in the last few minutes of a lesson, so the teacher knows who understood today's lesson and who needs another look tomorrow. "
      + 'Every question must target the SINGLE most important idea of the lesson — not the wider topic — and must be answerable in under a minute with no reference material. '
      + 'Prefer questions whose wrong answers reveal a specific misunderstanding, so a wrong answer tells the teacher something rather than just being marked wrong.',
  }),
});

/**
 * Metadata for a validated format. Falls back to `quiz` rather than throwing:
 * by the time this is called the format has already passed
 * generateAssessmentSchema, so an unknown value here would mean the boot
 * assertion below was bypassed — and a request in flight is the wrong place to
 * discover that. The assertion is what actually prevents it.
 */
function formatMeta(format) {
  return FORMAT_META[format] || FORMAT_META.quiz;
}

// Fail at boot, not at request time — the same discipline index.js applies to
// the action registry. A format in FORMATS with no metadata here would
// otherwise render as a quiz, which is the kind of bug that reaches a teacher
// looking like a content problem rather than a code one.
const missing = FORMATS.filter((format) => !FORMAT_META[format]);
if (missing.length > 0) {
  throw new Error(
    `[assessmentFormats] FORMATS contains ${missing.join(', ')} with no FORMAT_META entry. `
    + 'Add it here — otherwise the format silently renders as a quiz.'
  );
}

const extra = Object.keys(FORMAT_META).filter((format) => !FORMATS.includes(format));
if (extra.length > 0) {
  throw new Error(
    `[assessmentFormats] FORMAT_META describes ${extra.join(', ')}, which is not in FORMATS. `
    + 'Either add it to FORMATS (and the client picker) or remove it here.'
  );
}

module.exports = { FORMAT_META, formatMeta };
