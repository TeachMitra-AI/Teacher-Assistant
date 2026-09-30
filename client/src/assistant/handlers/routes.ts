// Route strings for AI navigation. They live only in handlers/: the server never sends a route, just an action id that
// the client maps, so an unknown id from a newer server can at worst find no mapping. A leaf file so a handler can name
// its route without importing the map that imports it.

// The quiz and worksheet generator.
export const GENERATOR_ROUTE = '/generator';

// An opaque draft id and nothing else; the teacher's topic in a query string would land in history and access logs.
export const PREFILL_PARAM = 'ai';
