// Minimal, dependency-free CSV builder — used only by Classroom Management's
// report export (docs/classroom-feature-plan.md §13). No npm package needed
// for what this app requires: quote/escape fields, join with CRLF (RFC 4180).

/**
 * Escapes a single CSV field. Wraps in double quotes whenever the value
 * contains a comma, double quote, or newline; an embedded double quote is
 * doubled per RFC 4180. `null`/`undefined` become an empty field, never the
 * literal string "null"/"undefined".
 * @param {string|number|null|undefined} value
 * @returns {string}
 */
function escapeField(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Builds a complete CSV document from a header row + data rows.
 * @param {string[]} header
 * @param {Array<Array<string|number|null|undefined>>} rows
 * @returns {string}
 */
function toCsv(header, rows) {
  const lines = [header, ...rows].map((row) => row.map(escapeField).join(','));
  return lines.join('\r\n') + '\r\n';
}

module.exports = { toCsv, escapeField };
