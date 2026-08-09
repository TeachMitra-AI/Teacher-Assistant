import { describe, expect, test } from 'vitest';
import { formatResponse } from './format';

// Tables were added for the Lesson Plan's Presentation section (Classroom Mode
// P6), where the teacher-activity / student-activity pairing IS the
// information. Before this, the section rendered as raw pipe characters.
describe('formatResponse — pipe tables', () => {
  const table = [
    '| # | Teacher Activity | Student Activity |',
    '|---|---|---|',
    '| 1 | Cut the roti in half | Name each part |',
    '| 2 | Write on the board | Copy into notebooks |',
  ].join('\n');

  test('renders a table, not raw pipes', () => {
    const html = formatResponse(table);
    expect(html).toContain('<table class="fmt-table">');
    expect(html).toContain('<th>Teacher Activity</th>');
    expect(html).toContain('<td>Cut the roti in half</td>');
    expect(html).not.toContain('|---|');
  });

  test('every body row becomes a row, none lost', () => {
    const html = formatResponse(table);
    expect(html.match(/<tr>/g)).toHaveLength(3); // 1 header + 2 body
  });

  // A cell beginning "1." or "A." must not be shredded by the list/option
  // passes — which is exactly why the table pass runs before them.
  test('a cell starting with a numeral is not turned into a list item', () => {
    const html = formatResponse('| # | Step |\n|---|---|\n| 1 | 1. First do this |\n');
    expect(html).toContain('<td>1. First do this</td>');
    expect(html).not.toContain('fmt-li-ol');
  });

  test('a cell starting with an option letter is not turned into an option div', () => {
    const html = formatResponse('| # | Step |\n|---|---|\n| 1 | A. Ask the class |\n');
    expect(html).toContain('<td>A. Ask the class</td>');
    expect(html).not.toContain('fmt-option');
  });

  test('an escaped pipe stays inside its cell', () => {
    const html = formatResponse('| A | B |\n|---|---|\n| x \\| y | z |\n');
    expect(html).toContain('<td>x | y</td>');
    expect(html.match(/<td>/g)).toHaveLength(2);
  });

  // "Never guess" — the rest of format.ts leaves malformed input as text
  // rather than half-rendering it.
  test('leaves a pipe line with no separator row as plain text', () => {
    const html = formatResponse('| not | a table |\njust text');
    expect(html).not.toContain('<table');
  });

  test('table content is still HTML-escaped', () => {
    const html = formatResponse('| A |\n|---|\n| <script>x</script> |\n');
    expect(html).not.toContain('<script>x');
    expect(html).toContain('&lt;script&gt;');
  });

  test('headings and lists around a table still render', () => {
    const html = formatResponse('## Presentation\n\n' + table + '\n\n## Blackboard Summary\n\nWrite it up.');
    expect(html).toContain('<h2>Presentation</h2>');
    expect(html).toContain('<table class="fmt-table">');
    expect(html).toContain('<h2>Blackboard Summary</h2>');
  });
});
