// Controlled-vocabulary registry (Milestone M4).
//
// Maps a vocabulary id — the value a descriptor's slot carries in its `vocab`
// field — to the mapper that canonicalizes it. The resolver looks a mapper up
// by id and never imports a specific vocabulary, so adding GRADES_SECONDARY or
// BOARDS in a later phase means adding a mapper and one line here, and touching
// no core file (the four-artifact rule, spec §8.3).
//
// The ids themselves live in assistant/contracts.js (VOCABULARIES) because they
// are part of the frozen wire contract — a slot's `vocab` is projected into the
// catalog. This module is the only place that knows what each id *does*.
//
// Deliberately NOT imported by actions/registry.js: the registry validates that
// a slot's vocabulary id is a known id, which it can do from contracts.js
// alone. Requiring an implementation at registry-validation time would couple
// startup to M4 code that production never calls in Phase 1. The coupling that
// does matter — every id having a mapper — is asserted by this folder's tests.

const { VOCABULARIES } = require('../../assistant/contracts');
const { VOCAB_STATUS, unmapped } = require('./shared');
const { GRADES, mapGrade } = require('./grades');
const { SUBJECTS, mapSubject } = require('./subjects');
const { LANGUAGE_CODES, mapLanguage } = require('./languages');

/** Vocabulary id → mapper. Keys must cover VOCABULARIES exactly. */
const MAPPERS = Object.freeze({
  GRADES: mapGrade,
  SUBJECTS: mapSubject,
  LANGUAGES: mapLanguage,
});

/** Vocabulary id → its canonical value list, for consumers that need the set itself. */
const VALUES = Object.freeze({
  GRADES,
  SUBJECTS,
  LANGUAGES: LANGUAGE_CODES,
});

/**
 * Canonicalize a raw phrase against a named vocabulary.
 *
 * An unknown id returns `unmapped` rather than throwing. A descriptor cannot
 * reach this state — the registry rejects an unknown vocabulary id at boot —
 * but the pipeline's job in every unexpected case is to degrade to the
 * teacher's default, never to take the request down (guardrail G22's spirit:
 * this endpoint sits in front of a text box).
 *
 * @param {string} vocabularyId one of VOCABULARIES
 * @param {unknown} raw
 */
function mapVocabulary(vocabularyId, raw) {
  const mapper = MAPPERS[vocabularyId];
  if (!mapper) return unmapped(raw);
  return mapper(raw);
}

module.exports = {
  VOCABULARIES,
  VOCAB_STATUS,
  MAPPERS,
  VALUES,
  mapVocabulary,
  mapGrade,
  mapSubject,
  mapLanguage,
};
