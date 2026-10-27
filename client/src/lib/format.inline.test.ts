import { describe, expect, test } from 'vitest';
import { formatInlineMath, formatResponse } from './format';

// formatInlineMath is formatResponse's escaping + KaTeX maths for one short inline string (structured question cards). It
// must not apply the block passes (lists, options, paragraphs), and it must stay as XSS-safe as formatResponse.
describe('formatInlineMath', () => {
  test('typesets a LaTeX fraction', () => {
    const html = formatInlineMath('Which is equal to $\\frac{1}{2}$?');
    expect(html).toContain('class="katex"');
    expect(html.startsWith('Which is equal to ')).toBe(true);
    expect(html.endsWith('?')).toBe(true);
  });

  test('leaves plain text unchanged', () => {
    expect(formatInlineMath('Name the denominator in four ninths.')).toBe('Name the denominator in four ninths.');
  });

  test('does not apply block formatting to a line that looks like a list item or an option', () => {
    expect(formatInlineMath('1. First step')).toBe('1. First step');
    expect(formatInlineMath('A. Paris')).toBe('A. Paris');
    expect(formatInlineMath('**not bold**')).toBe('**not bold**');
    // formatResponse does transform these, which is why the card can't use it.
    expect(formatResponse('1. First step')).toContain('<li');
  });

  test('escapes HTML outside maths', () => {
    const html = formatInlineMath('<img src=x onerror="alert(1)"> 3 < 5 & 7 > 2');
    expect(html).not.toContain('<img');
    expect(html).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; 3 &lt; 5 &amp; 7 &gt; 2');
  });

  test('HTML inside a maths segment is rendered as maths text, never as markup', () => {
    const html = formatInlineMath('$<img src=x onerror=alert(1)>$');
    // Checked on the parsed DOM, not the string: KaTeX keeps the source in its MathML <annotation> as escaped text
    // ("&lt;img ... onerror=..."), which is safe; what must never exist is an element or an event-handler attribute.
    const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
    expect(doc.querySelector('img')).toBeNull();
    expect(doc.querySelector('[onerror]')).toBeNull();
    expect(html).not.toMatch(/<img/i);
    expect(doc.querySelector('annotation')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  test('renders the same maths markup formatResponse does', () => {
    const inline = formatInlineMath('$\\frac{3}{8}$');
    expect(formatResponse('$\\frac{3}{8}$')).toBe(`<p>${inline}</p>`);
  });
});
