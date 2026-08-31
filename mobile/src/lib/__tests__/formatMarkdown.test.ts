import { parseMarkdownBlocks } from '../formatMarkdown';

describe('parseMarkdownBlocks', () => {
  it('parses a plain paragraph with no markdown', () => {
    expect(parseMarkdownBlocks('Just a plain sentence.')).toEqual([
      { type: 'paragraph', segments: [{ text: 'Just a plain sentence.' }] },
    ]);
  });

  it('splits on blank lines into separate paragraphs', () => {
    const blocks = parseMarkdownBlocks('First paragraph.\n\nSecond paragraph.');
    expect(blocks).toEqual([
      { type: 'paragraph', segments: [{ text: 'First paragraph.' }] },
      { type: 'paragraph', segments: [{ text: 'Second paragraph.' }] },
    ]);
  });

  it('joins consecutive non-blank lines into one paragraph with an embedded newline', () => {
    const blocks = parseMarkdownBlocks('Line one\nLine two');
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        segments: [{ text: 'Line one' }, { text: '\n' }, { text: 'Line two' }],
      },
    ]);
  });

  it('parses **bold** spans inline, preserving the surrounding plain text', () => {
    const blocks = parseMarkdownBlocks('This is **very** important.');
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        segments: [{ text: 'This is ' }, { text: 'very', bold: true }, { text: ' important.' }],
      },
    ]);
  });

  it('parses headings 1 through 6 with their level', () => {
    expect(parseMarkdownBlocks('# Title')).toEqual([{ type: 'heading', level: 1, segments: [{ text: 'Title' }] }]);
    expect(parseMarkdownBlocks('### Sub-heading')).toEqual([
      { type: 'heading', level: 3, segments: [{ text: 'Sub-heading' }] },
    ]);
  });

  it('groups consecutive numbered lines into one ordered list block', () => {
    const blocks = parseMarkdownBlocks('1. First\n2. Second\n3. Third');
    expect(blocks).toEqual([
      {
        type: 'list',
        ordered: true,
        items: [[{ text: 'First' }], [{ text: 'Second' }], [{ text: 'Third' }]],
      },
    ]);
  });

  it('groups consecutive bulleted lines (-, *, •) into one unordered list block', () => {
    const blocks = parseMarkdownBlocks('- First\n* Second\n• Third');
    expect(blocks).toEqual([
      {
        type: 'list',
        ordered: false,
        items: [[{ text: 'First' }], [{ text: 'Second' }], [{ text: 'Third' }]],
      },
    ]);
  });

  it('starts a new list block when the marker type switches mid-run', () => {
    const blocks = parseMarkdownBlocks('1. First\n- Second');
    expect(blocks).toEqual([
      { type: 'list', ordered: true, items: [[{ text: 'First' }]] },
      { type: 'list', ordered: false, items: [[{ text: 'Second' }]] },
    ]);
  });

  it('handles a realistic multi-block Coach answer', () => {
    const raw = '## Steps\n\n1. Introduce the topic\n2. **Demonstrate** an example\n\nThat wraps it up.';
    const blocks = parseMarkdownBlocks(raw);
    expect(blocks).toEqual([
      { type: 'heading', level: 2, segments: [{ text: 'Steps' }] },
      {
        type: 'list',
        ordered: true,
        items: [
          [{ text: 'Introduce the topic' }],
          [{ text: 'Demonstrate', bold: true }, { text: ' an example' }],
        ],
      },
      { type: 'paragraph', segments: [{ text: 'That wraps it up.' }] },
    ]);
  });

  it('returns no blocks for empty input', () => {
    expect(parseMarkdownBlocks('')).toEqual([]);
    expect(parseMarkdownBlocks('   \n\n  ')).toEqual([]);
  });

  // Ported from client/src/lib/format.ts / mobile/src/lib/formatHtml.ts's
  // already-ported pipe-table handling — see format.table.test.ts for the
  // web equivalents of these cases.
  describe('pipe tables', () => {
    const table = [
      '| # | Teacher Activity | Student Activity |',
      '|---|---|---|',
      '| 1 | Cut the roti in half | Name each part |',
      '| 2 | Write on the board | Copy into notebooks |',
    ].join('\n');

    it('parses a table block with header and rows', () => {
      expect(parseMarkdownBlocks(table)).toEqual([
        {
          type: 'table',
          header: ['#', 'Teacher Activity', 'Student Activity'],
          rows: [
            ['1', 'Cut the roti in half', 'Name each part'],
            ['2', 'Write on the board', 'Copy into notebooks'],
          ],
        },
      ]);
    });

    it('a cell starting with a numeral is not turned into a list item', () => {
      const blocks = parseMarkdownBlocks('| # | Step |\n|---|---|\n| 1 | 1. First do this |\n');
      expect(blocks).toEqual([{ type: 'table', header: ['#', 'Step'], rows: [['1', '1. First do this']] }]);
    });

    it('a cell starting with an option letter is not turned into an option block', () => {
      const blocks = parseMarkdownBlocks('| # | Step |\n|---|---|\n| 1 | A. Ask the class |\n');
      expect(blocks).toEqual([{ type: 'table', header: ['#', 'Step'], rows: [['1', 'A. Ask the class']] }]);
    });

    it('an escaped pipe stays inside its cell', () => {
      const blocks = parseMarkdownBlocks('| A | B |\n|---|---|\n| x \\| y | z |\n');
      expect(blocks).toEqual([{ type: 'table', header: ['A', 'B'], rows: [['x | y', 'z']] }]);
    });

    it('leaves a pipe line with no separator row as a plain paragraph', () => {
      const blocks = parseMarkdownBlocks('| not | a table |\njust text');
      expect(blocks.some((b) => b.type === 'table')).toBe(false);
    });
  });

  describe('MCQ options', () => {
    it('groups consecutive A./B./C./D. lines into one options block', () => {
      const blocks = parseMarkdownBlocks('1. What is 2+2?\nA. 3\nB. 4\nC. 5\nD. 6');
      expect(blocks).toEqual([
        { type: 'list', ordered: true, items: [[{ text: 'What is 2+2?' }]] },
        {
          type: 'options',
          items: [
            { letter: 'A', segments: [{ text: '3' }] },
            { letter: 'B', segments: [{ text: '4' }] },
            { letter: 'C', segments: [{ text: '5' }] },
            { letter: 'D', segments: [{ text: '6' }] },
          ],
        },
      ]);
    });

    it('splits four options given on a single line', () => {
      const blocks = parseMarkdownBlocks('A. 6 cm B. 10 cm C. 12 cm D. 18 cm');
      expect(blocks).toEqual([
        {
          type: 'options',
          items: [
            { letter: 'A', segments: [{ text: '6 cm' }] },
            { letter: 'B', segments: [{ text: '10 cm' }] },
            { letter: 'C', segments: [{ text: '12 cm' }] },
            { letter: 'D', segments: [{ text: '18 cm' }] },
          ],
        },
      ]);
    });

    it('parses lettered sub-parts as their own block', () => {
      const blocks = parseMarkdownBlocks('(a) Define photosynthesis.\n(b) Name its by-products.');
      expect(blocks).toEqual([
        { type: 'subpart', letter: 'a', segments: [{ text: 'Define photosynthesis.' }] },
        { type: 'subpart', letter: 'b', segments: [{ text: 'Name its by-products.' }] },
      ]);
    });
  });
});
