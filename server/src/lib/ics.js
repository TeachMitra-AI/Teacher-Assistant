// Minimal .ics (iCalendar) builder for Schedule a Call confirmations. A handful of BEGIN/END lines, so no `ics`
// package. Supports only the fields this feature needs.

function formatUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// Escapes per RFC 5545 just enough for text we generate; commas and semicolons in an org name or notes are plausible.
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
