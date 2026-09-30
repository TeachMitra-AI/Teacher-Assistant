// Controlled vocabulary: SUBJECTS. Many-to-one but not lossy, so the work is the synonym table: English,
// Hinglish and Devanagari, plus sub-subjects the app folds together (physics/chemistry/biology -> Science,
// history/geography/civics -> Social Studies). The nearest canonical subject beats "unrecognised", and the field is free text.
// client/src/config.ts (SUBJECTS) holds the same list, pinned by test/actions/vocabDrift.test.js. Change both together.

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
 * Synonym -> canonical subject, matched against single normalized tokens (multi-word names are collapsed
 * first via PHRASE_ALIASES). One flat table so a duplicate key is a syntax error, not a silent precedence bug.
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

/** Words naming a whole faculty, which span subjects: reported ambiguous, keeping the teacher's own phrase. */
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
