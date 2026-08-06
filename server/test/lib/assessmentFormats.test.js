// Per-format metadata, and the drift guards that keep the three places a
// format is declared from disagreeing.
//
// Why this file exists: before P4 there were exactly two formats, and the
// difference between them was expressed as `format === 'worksheet' ? … : …`
// inside the prompt builder and the renderer. That construct does not fail when
// a third format arrives — it silently labels it "Quiz" and gives it a quiz's
// prompt. These tests make that class of mistake loud.

const fs = require('fs');
const path = require('path');

const { FORMAT_META, formatMeta } = require('../../src/lib/assessmentFormats');
const { FORMATS, ROUTABLE_FORMATS } = require('../../src/actions/schemas/generateAssessment');

describe('ROUTABLE_FORMATS is a safe subset of FORMATS', () => {
  // The direction matters. The router advertising FEWER formats than the
  // endpoint accepts is fine — it just declines to route one, and the teacher
  // uses the Generator page or Classroom Mode. The router advertising MORE
  // would let it confidently propose a payload the endpoint rejects with a 400
  // the teacher cannot act on, which is the exact failure the single-schema
  // design exists to prevent.
  test('every routable format is a real format', () => {
    for (const format of ROUTABLE_FORMATS) {
      expect(FORMATS, `router advertises "${format}", which the endpoint would reject`).toContain(format);
    }
  });

  test('the router may advertise fewer, never more', () => {
    expect(ROUTABLE_FORMATS.length).toBeLessThanOrEqual(FORMATS.length);
  });

  // Widening this list rewrites the classifier prompt, which is pinned
  // byte-for-byte by test/assistant/recoveryIsolation.test.js against the M7a
  // evaluation baseline. That is a deliberate, budgeted change (a full live
  // eval pass), not something to do in passing while adding a format for a
  // different feature. This test is the tripwire.
  test('the routable set is exactly what the frozen classifier prompt was built from', () => {
    expect(ROUTABLE_FORMATS).toEqual(['quiz', 'worksheet']);
  });
});

describe('assessmentFormats — coverage', () => {
  test('every declared format has metadata', () => {
    for (const format of FORMATS) {
      expect(FORMAT_META[format], `FORMATS contains "${format}" with no FORMAT_META entry`).toBeTruthy();
    }
  });

  test('metadata describes no format that is not declared', () => {
    for (const format of Object.keys(FORMAT_META)) {
      expect(FORMATS, `FORMAT_META describes "${format}", which is not a valid format`).toContain(format);
    }
  });

  test('every format has all four fields, non-empty', () => {
    for (const format of FORMATS) {
      const meta = FORMAT_META[format];
      for (const field of ['noun', 'title', 'answerKeyHeading', 'purpose']) {
        expect(typeof meta[field], `${format}.${field}`).toBe('string');
        expect(meta[field].length, `${format}.${field} is empty`).toBeGreaterThan(0);
      }
    }
  });

  // The reason `purpose` exists at all. If two formats share it, they will
  // produce the same document with a different heading — which is precisely
  // what an exit ticket must NOT be relative to a quiz.
  test('no two formats share a purpose', () => {
    const purposes = FORMATS.map((f) => FORMAT_META[f].purpose);
    expect(new Set(purposes).size).toBe(FORMATS.length);
  });

  test('answer-key headings match what the client splits on', () => {
    // client/src/lib/assessment.ts ANSWER_KEY_HEADING — a heading the client
    // cannot recognise means the answer key is printed to students.
    const clientPattern = /^\s{0,3}#{1,6}\s*(?:teacher(?:'s)?\s+)?answer\s*keys?\b.*$/i;
    for (const format of FORMATS) {
      expect(clientPattern.test(FORMAT_META[format].answerKeyHeading), format).toBe(true);
    }
  });
});

describe('assessmentFormats.formatMeta', () => {
  test('returns the right entry for each format', () => {
    expect(formatMeta('exit_ticket').title).toBe('Exit Ticket');
    expect(formatMeta('worksheet').title).toBe('Worksheet');
    expect(formatMeta('quiz').title).toBe('Quiz');
  });

  test('falls back rather than throwing on an unknown format', () => {
    expect(formatMeta('nonsense')).toBe(FORMAT_META.quiz);
    expect(formatMeta(undefined)).toBe(FORMAT_META.quiz);
  });
});

// The pair the repo already warns about in both files' comments. A code-level
// guard beats a comment: the client offering a format the server rejects is a
// 400 the teacher cannot act on, and the server accepting one the client never
// offers is dead code.
describe('client/server format drift', () => {
  test('ASSESSMENT_FORMATS in client/src/config.ts matches FORMATS exactly', () => {
    const configPath = path.join(__dirname, '../../../client/src/config.ts');
    const source = fs.readFileSync(configPath, 'utf8');

    const block = source.slice(source.indexOf('export const ASSESSMENT_FORMATS'));
    // Slice from the opening `[` of the array literal, NOT from the start of
    // the declaration: the TYPE annotation in between is
    // `{ value: 'quiz' | 'worksheet' | ...; ... }[]`, whose `value: 'quiz'`
    // would otherwise be scraped as a fourth entry.
    const arrayLiteral = block.slice(block.indexOf('= ['), block.indexOf('];'));
    const clientFormats = [...arrayLiteral.matchAll(/\{\s*value:\s*'([a-z_]+)'/g)].map((m) => m[1]);

    expect(clientFormats.length).toBeGreaterThan(0);
    expect([...clientFormats].sort()).toEqual([...FORMATS].sort());
  });
});
