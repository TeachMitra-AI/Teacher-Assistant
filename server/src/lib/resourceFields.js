// Field bounds shared by more than one Resource-related schema.
//
// Extracted during Milestone M1 of the AI Action Router project, when the quiz/
// worksheet generation schema moved out of routes/resources.js into
// src/actions/schemas/generateAssessment.js so that the route and the capability
// registry validate against ONE definition rather than two copies.
//
// Only the genuinely SHARED bounds live here. MAX_TITLE, MAX_CONTENT,
// MAX_STRUCTURED and MAX_SOURCE_ID stay in routes/resources.js because only the
// library CRUD schemas use them — moving those too would have widened an
// otherwise minimal refactor without removing any duplication.
//
// Why a third module rather than one schema importing from the other: the
// generation schema needs these bounds, and so do the create/update/ai-action
// schemas in routes/resources.js. Having actions/schemas/ import from routes/
// would both invert the intended dependency direction (routes -> actions) and
// create a require cycle, which in CommonJS yields a partially-initialised
// module — a genuinely subtle class of bug. A leaf module both sides import has
// neither problem.

/**
 * Max length of a `grade` or `subject` value.
 *
 * These are free-text fields with a datalist of suggestions rather than a closed
 * enum, because real timetables do not fit a fixed vocabulary ("Class 3-5",
 * "Class 6 & 7", "Nursery A"). The bound is a sanity limit, not a taxonomy.
 */
const MAX_META = 80;

/** Max length of a `language` value (a short code such as "en", "hi", "hinglish"). */
const MAX_LANGUAGE = 20;

module.exports = { MAX_META, MAX_LANGUAGE };
