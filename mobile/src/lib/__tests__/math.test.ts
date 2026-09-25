import { renderMathSegments, containsMath } from '../math';

describe('renderMathSegments', () => {
  it('renders an inline $...$ segment as KaTeX markup', () => {
    const html = renderMathSegments('The area is $A = \\pi r^2$ exactly.');
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('$A = \\pi r^2$');
  });

  it('renders a block $$...$$ segment in display mode', () => {
    const html = renderMathSegments('$$x = \\frac{-b}{2a}$$');
    expect(html).toContain('class="katex-display"');
  });

  it('undoes HTML-entity escaping inside the math source before handing it to KaTeX', () => {
    // format.ts's escapeHtml runs before this — "a < b" arrives as "a &lt; b".
    const html = renderMathSegments('$a &lt; b$');
    expect(html).toContain('class="katex"');
  });

  it('does not pair up two unrelated currency amounts as one math segment', () => {
    const html = renderMathSegments('It costs $5 and $10 total.');
    expect(html).toBe('It costs $5 and $10 total.');
  });

  it('leaves non-math text untouched', () => {
    expect(renderMathSegments('No math here.')).toBe('No math here.');
  });

  // Same repair the server applies before saving (server/src/lib/assessmentSchema.js)
  // and client/src/lib/math.ts applies on read — content saved before that fix
  // still carries the damage, so it's repaired here too. Tested indirectly
  // through the rendered output rather than the private repair function.
  it('repairs a JSON-eaten \\tan escape back to a literal backslash before rendering', () => {
    // JSON.parse turns a saved "\tan" into TAB + "an" inside the $...$ segment.
    const mangled = '$\tan(x)$';
    const html = renderMathSegments(mangled);
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('\t');
  });

  it('normalizes a degenerate \\text{sin} form back to \\sin before rendering', () => {
    // \text{sin} and \sin should now render identically — the repair turns
    // the plain-text-styled degenerate form into the real "sin" operator.
    const repaired = renderMathSegments('$\\text{sin}(x)$');
    const canonical = renderMathSegments('$\\sin (x)$');
    expect(repaired).toBe(canonical);
  });
});

describe('containsMath', () => {
  it('is true for inline $...$ delimiters', () => {
    expect(containsMath('The area is $A = \\pi r^2$.')).toBe(true);
  });

  it('is true for block $$...$$ delimiters', () => {
    expect(containsMath('$$x = 1$$')).toBe(true);
  });

  it('is false for plain text', () => {
    expect(containsMath('No math here.')).toBe(false);
  });

  // Deliberately permissive — a bare currency "$" still counts, trading an
  // occasional unnecessary WebView render for never missing real math (see
  // containsMath's own comment).
  it('is true for a bare currency amount (a false positive, but a safe one)', () => {
    expect(containsMath('It costs $5.')).toBe(true);
  });
});
