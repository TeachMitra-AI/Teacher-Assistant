// Minimal dependency-free CSV builder for Classroom Management's report export: quote/escape fields and join with CRLF (RFC 4180).

/**
 * Escapes a single CSV field. Quotes it when it contains a comma, double quote or newline (embedded quotes
 * are doubled); null/undefined become an empty field.
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
 * Builds a CSV document from a header row and data rows.
 * @param {string[]} header
 * @param {Array<Array<string|number|null|undefined>>} rows
 * @returns {string}
 */
function toCsv(header, rows) {
  const lines = [header, ...rows].map((row) => row.map(escapeField).join(','));
  return lines.join('\r\n') + '\r\n';
}

module.exports = { toCsv, escapeField };
