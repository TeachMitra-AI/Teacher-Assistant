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
});
