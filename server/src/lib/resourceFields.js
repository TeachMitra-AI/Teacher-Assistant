// Field bounds shared by more than one Resource schema, in a leaf module. The generation schema in
// actions/schemas/ and the create/update/ai-action schemas in routes/resources.js both need them, and
// importing from routes/ would invert the dependency direction and create a require cycle, which in
// CommonJS yields a partially-initialised module. MAX_TITLE, MAX_CONTENT, MAX_STRUCTURED and MAX_SOURCE_ID
// stay in routes/resources.js since only the library CRUD schemas use them.

/**
 * Max length of a `grade` or `subject` value. These are free text with a datalist of suggestions, since real
 * timetables don't fit a fixed vocabulary ("Class 3-5", "Nursery A"). A sanity limit, not a taxonomy.
 */
const MAX_META = 80;

/** Max length of a `language` value (a short code such as "en", "hi", "hinglish"). */
const MAX_LANGUAGE = 20;

module.exports = { MAX_META, MAX_LANGUAGE };
