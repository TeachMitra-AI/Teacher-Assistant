import { formatResponseHtml } from '../formatHtml';

describe('formatResponseHtml', () => {
  it('escapes HTML special characters', () => {
    expect(formatResponseHtml('<script>alert("x")</script>')).toContain(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
  });

  it('renders headings 1-6, tagging an answer-key heading for print page-breaks', () => {
    expect(formatResponseHtml('# Title')).toContain('<h1>Title</h1>');
    expect(formatResponseHtml('###### Deep')).toContain('<h6>Deep</h6>');
    expect(formatResponseHtml('## Answer Key')).toContain('<h2 class="fmt-answer-key">Answer Key</h2>');
    expect(formatResponseHtml('## Teacher Answer Key')).toContain('<h2 class="fmt-answer-key">Teacher Answer Key</h2>');
  });

  it('renders bold segments', () => {
    expect(formatResponseHtml('**bold**')).toContain('<strong>bold</strong>');
  });

  it('groups MCQ option lines into a fmt-options container', () => {
    const html = formatResponseHtml('1. What is 2+2?\nA. 3\nB. 4\nC. 5\nD. 6');
    expect(html).toContain('<div class="fmt-options">');
    expect(html).toContain('<div class="fmt-option">A. 3</div>');
    expect(html).toContain('<div class="fmt-option">D. 6</div>');
  });

  it('renders a numbered list as an <ol> of tagged <li> items, preserving the literal number', () => {
    const html = formatResponseHtml('1. First\n2. Second');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li class="fmt-li-ol"><span class="fmt-qnum">1.</span> First</li>');
    expect(html).toContain('<li class="fmt-li-ol"><span class="fmt-qnum">2.</span> Second</li>');
  });

  it('renders a bulleted list as a <ul>', () => {
    const html = formatResponseHtml('- one\n- two');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li class="fmt-li-ul">one</li>');
  });

  it('renders a strict pipe table', () => {
    const html = formatResponseHtml('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(html).toContain('<table class="fmt-table">');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('wraps the whole document in a <p> and converts blank lines to paragraph breaks', () => {
    const html = formatResponseHtml('Para one.\n\nPara two.');
    expect(html).toBe('<p>Para one.</p><p>Para two.</p>');
  });
});
