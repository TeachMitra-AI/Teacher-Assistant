// Closed vocabularies for PYQ — Phase 5 (docs/pyq-implementation-plan.md §9/
// §20). The single source of truth for every PYQ enum that was previously
// duplicated inline (with a forward-reference comment pointing here) across
// routes/adminPyq.js and lib/pyqExtractionSchema.js in Phases 2-4. Mirrors
// lib/roles.js's own shape: plain frozen arrays, no behaviour.
//
// UNLIKE actions/vocab/{grades,subjects}.js (which map free-text teacher
// input to a canonical value), these are not free-text mappers — every value
// here is already a closed, exact vocabulary enforced by Zod .enum() at the
// API boundary, never guessed from a phrase.

const PYQ_CLASS_LEVELS = Object.freeze(['9', '10', '11', '12']);
const PYQ_EXAM_TYPES = Object.freeze(['annual', 'compartment', 'pre_board']);
const PYQ_PAPER_STATUSES = Object.freeze([
  'uploaded', 'extracting', 'needs_review', 'published', 'archived', 'extraction_failed',
]);
const PYQ_QUESTION_TYPES = Object.freeze(['mcq', 'very_short_answer', 'short_answer', 'long_answer', 'case_study']);
const PYQ_QUESTION_REVIEW_STATUSES = Object.freeze(['extracted', 'reviewed', 'approved', 'rejected']);

// Who proposed a Question<->Topic link (QuestionTopic.source, schema.prisma
// §7) — 'ai' from classifyPyqChapter.js, 'human' from a reviewer's own PATCH.
const PYQ_TOPIC_SOURCES = Object.freeze(['ai', 'human']);

module.exports = {
  PYQ_CLASS_LEVELS,
  PYQ_EXAM_TYPES,
  PYQ_PAPER_STATUSES,
  PYQ_QUESTION_TYPES,
  PYQ_QUESTION_REVIEW_STATUSES,
  PYQ_TOPIC_SOURCES,
};
