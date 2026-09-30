// Per-format presentation and purpose for generated assessments, in one table. Ternaries on `format` were wrong
// the moment a third format existed: unknown formats fell through to the quiz branch and were labelled "Quiz".
// Adding a format takes three edits: FORMATS in actions/schemas/generateAssessment.js (vocabulary), FORMAT_META
// here (how it reads), and ASSESSMENT_FORMATS in client/src/config.ts (picker). The first and third must land together.
// The assertion at the bottom runs at require time, so a format without metadata stops the server at boot.

const { FORMATS } = require('../actions/schemas/generateAssessment');

/**
 * `purpose` is the only generative field: it tells the model what the document is for, which is what makes
 * an exit ticket read differently from a short quiz.
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
  homework: Object.freeze({
    noun: 'homework',
    title: 'Homework',
    answerKeyHeading: '## Teacher Answer Key',
    // The setting is the difference from `worksheet`: homework is attempted alone, often late, sometimes with a
    // parent who may not read the language of instruction. Each clause changes what a good question looks like.
    purpose:
      'Homework: practice students complete at home, on their own, with NO teacher available to explain anything. '
      + 'Every question must be answerable from what was already taught in class — never introduce a new idea, notation or vocabulary word here. '
      + 'Each question must be fully self-contained: state everything needed inside the question, because a student who is stuck cannot ask what it means. '
      + 'Use only materials certain to be at home (paper, pencil, everyday household objects) — never lab equipment, printouts, internet access or a device. '
      + 'End the student section with one short note addressed to a parent or guardian saying what the child practised and how they can help, phrased so it is useful to an adult who did not attend the lesson and may not have studied the topic themselves.',
  }),
});

/**
 * Metadata for a validated format. Falls back to `quiz` rather than throwing, since the format has already
 * passed generateAssessmentSchema and the boot assertion below is what prevents an unknown one.
 */
function formatMeta(format) {
  return FORMAT_META[format] || FORMAT_META.quiz;
}

// Fail at boot: a format with no metadata would render as a quiz and look like a content bug.
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
