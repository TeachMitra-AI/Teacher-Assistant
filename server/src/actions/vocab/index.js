// Controlled-vocabulary registry: maps a vocabulary id (a slot's `vocab`) to its mapper. The resolver looks
// mappers up by id, so a new vocabulary is a mapper plus one line here. The ids live in assistant/contracts.js
// (VOCABULARIES) as part of the wire contract. Not imported by registry.js, which only needs the ids; this
// folder's tests assert every id has a mapper.

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
 * Canonicalize a raw phrase against a named vocabulary. An unknown id returns `unmapped` rather than
 * throwing; the registry rejects one at boot, but the pipeline should degrade, not fail the request.
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
