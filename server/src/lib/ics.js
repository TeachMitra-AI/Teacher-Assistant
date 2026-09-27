// Minimal .ics (iCalendar) file builder for Schedule a Call booking
// confirmations. No `ics` npm package — the format needed here is a handful
// of BEGIN/END lines, and adding a dependency for that would be more code
// (and more supply-chain surface) than writing it directly.
//
// Deliberately supports only the single fields this feature needs — this is
// not a general-purpose calendar library.

function formatUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Folds/escapes per RFC 5545 §3.3.11 just enough for plain text we generate
// ourselves (no user-supplied line breaks or exotic characters expected, but
// commas/semicolons in an org name or notes are plausible).
function escapeText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * @param {{uid: string, summary: string, description: string, startsAt: Date, durationMinutes: number}} params
 * @returns {string}
 */
function buildIcsEvent({ uid, summary, description, startsAt, durationMinutes }) {
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60 * 1000);
  const now = formatUtc(new Date());

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SarasTech//Schedule a Call//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@sarastech.co.in`,
    `DTSTAMP:${now}`,
    `DTSTART:${formatUtc(startsAt)}`,
    `DTEND:${formatUtc(endsAt)}`,
    `SUMMARY:${escapeText(summary)}`,
    `DESCRIPTION:${escapeText(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

module.exports = { buildIcsEvent };
