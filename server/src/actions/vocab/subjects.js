// Controlled vocabulary: SUBJECTS (Milestone M4).
//
// Easier than grades — the mapping is many-to-one but not lossy, because a
// subject synonym names exactly one canonical subject. The work is in the
// breadth of the synonym table: English, Hinglish transliteration and
// Devanagari all appear in real teacher input, and so do the sub-subjects
// ("physics", "geography") that the application's coarser list folds together.
//
// Folding physics/chemistry/biology into Science, and history/geography/civics
// into Social Studies, is deliberate. The application has one Science and one
// Social Studies; mapping to the nearest canonical subject is more useful than
// reporting the phrase unrecognised, and the teacher can always overtype the
// field, which is free text.
//
// CLIENT COUNTERPART: client/src/config.ts (SUBJECTS) holds the same canonical
// list, where it populates the Generator's subject datalist and the Settings
// picker. Deliberate, documented duplication (CHANGE-11), pinned by
// server/test/actions/vocabDrift.test.js. CHANGE BOTH IN THE SAME COMMIT.

const {
  VOCAB_STATUS,
  RANGE_SEPARATORS,
  ALTERNATION_SEPARATORS,
  normalize,
  tokenize,
  unmapped,
  resolveMultiple,
} = require('./shared');

/** The canonical subjects. Every mapped result is one of these strings exactly. */
const SUBJECTS = Object.freeze([
  'Mathematics',
  'Science',
  'English',
  'Hindi',
  'Social Studies',
  'Languages',
  'General',
]);

/**
 * Synonym → canonical subject. Keys are matched against single normalized
 * tokens; multi-word names are collapsed to one token first (PHRASE_ALIASES).
 *
 * Kept as one flat table rather than per-subject arrays so that a duplicate key
 * is a syntax-level mistake rather than a silent precedence bug.
 */
const SYNONYMS = Object.freeze({
  // Mathematics
  math: 'Mathematics',
  maths: 'Mathematics',
  mathematics: 'Mathematics',
  arithmetic: 'Mathematics',
  algebra: 'Mathematics',
  geometry: 'Mathematics',
  ganit: 'Mathematics',
  'गणित': 'Mathematics',

  // Science
  science: 'Science',
  sciences: 'Science',
  evs: 'Science',
  environmentalstudies: 'Science',
  environment: 'Science',
  environmentalscience: 'Science',
  physics: 'Science',
  chemistry: 'Science',
  biology: 'Science',
  vigyan: 'Science',
  'विज्ञान': 'Science',

  // English
  english: 'English',
  angrezi: 'English',
  'अंग्रेजी': 'English',
  'अंग्रेज़ी': 'English',

  // Hindi
  hindi: 'Hindi',
  'हिंदी': 'Hindi',
  'हिन्दी': 'Hindi',

  // Social Studies
  socialstudies: 'Social Studies',
  socialscience: 'Social Studies',
  social: 'Social Studies',
  sst: 'Social Studies',
  history: 'Social Studies',
  geography: 'Social Studies',
  civics: 'Social Studies',
  economics: 'Social Studies',
  samajikadhyayan: 'Social Studies',
  itihas: 'Social Studies',
  bhugol: 'Social Studies',
  'इतिहास': 'Social Studies',
  'भूगोल': 'Social Studies',

  // Languages — regional and classical languages the app has no separate entry
  // for. Hindi and English are their own subjects above and must not fall here.
  languages: 'Languages',
  language: 'Languages',
  bhasha: 'Languages',
  sanskrit: 'Languages',
  urdu: 'Languages',
  bengali: 'Languages',
  bangla: 'Languages',
  marathi: 'Languages',
  tamil: 'Languages',
  telugu: 'Languages',
  gujarati: 'Languages',
  kannada: 'Languages',
  punjabi: 'Languages',
  odia: 'Languages',
  oriya: 'Languages',
  'भाषा': 'Languages',

  // General
  general: 'General',
  generalknowledge: 'General',
  gk: 'General',
  moralscience: 'General',
  computer: 'General',
  computers: 'General',
});

/**
 * Words that name a whole faculty rather than a subject. They span canonical
 * subjects, so the honest outcome is "ambiguous" — the teacher's own phrase is
 * kept and the field flagged, rather than one of two being picked.
 */
const FACULTY_WORDS = Object.freeze({
  humanities: ['Social Studies', 'Languages'],
  arts: ['Social Studies', 'Languages'],
});

const PHRASE_ALIASES = Object.freeze([
  [/\bsocial[\s-]*studies\b/g, ' socialstudies '],
  [/\bsocial[\s-]*science[s]?\b/g, ' socialscience '],
  [/\benvironmental[\s-]*studies\b/g, ' environmentalstudies '],
  [/\benvironmental[\s-]*science\b/g, ' environmentalscience '],
  [/\bgeneral[\s-]*knowledge\b/g, ' generalknowledge '],
  [/\bmoral[\s-]*science\b/g, ' moralscience '],
  [/\bsamajik[\s-]*adhyayan\b/g, ' samajikadhyayan '],
]);

/**
 * Map a raw subject phrase to a canonical subject.
 *
 * @param {unknown} raw whatever the classifier put in the `subject` slot
 * @returns {{status: string, value?: string, candidates?: string[], readings?: string[], raw: unknown}}
 */
function mapSubject(raw) {
  const normalized = normalize(raw);
  if (!normalized) return unmapped(raw);

  const collapsed = PHRASE_ALIASES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    normalized
  ).trim();

  const tokens = tokenize(collapsed);
  const mentions = [];
  const separators = [];

  for (const token of tokens) {
    if (RANGE_SEPARATORS.has(token) || ALTERNATION_SEPARATORS.has(token)) {
      if (mentions.length > 0) separators.push(token);
      continue;
    }
    if (SYNONYMS[token]) mentions.push(SYNONYMS[token]);
  }

  if (mentions.length > 0) {
    return resolveMultiple(mentions, separators, raw);
  }

  // Same precedence rule as grades: the weaker, spanning evidence is only
  // consulted when nothing specific was named.
  const facultyWord = tokens.find((token) => FACULTY_WORDS[token]);
  if (facultyWord) {
    return resolveMultiple(FACULTY_WORDS[facultyWord], [], raw);
  }

  return unmapped(raw);
}

module.exports = {
  SUBJECTS,
  VOCAB_STATUS,
  mapSubject,
};
