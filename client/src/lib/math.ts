// Renders LaTeX math segments embedded in AI-generated / teacher-edited text
// into real mathematical notation, instead of leaving raw "$\sin\theta$"
// syntax visible in the rendered page (Phase 2 of the quiz/worksheet
// generator rework — see the architecture review this implements).
//
// The generation prompt (server/src/routes/resources.js) instructs Gemini to
// delimit ALL math with $...$ (inline) or $$...$$ (block), and to never use
// Unicode math symbols or plain-text approximations — one single convention,
// applied consistently, rather than leaving notation to the model's
// per-question judgement.
import katex from 'katex';

// Block math first (greedier, may span the input) so a $$...$$ pair is never
// first mis-split by the inline pattern into two bare "$" delimiters.
const BLOCK_MATH = /\$\$([\s\S]+?)\$\$/g;
// Inline math never spans a line, and its content must start AND end with a
// non-space character — so two currency amounts in prose ("costs $5 and $10")
// don't pair up as one bogus math segment ("5 and ") that swallows the text
// between them. A lone "$" with no close on the same line is left alone too.
const INLINE_MATH = /\$(\S(?:[^$\n]*?\S)?)\$/g;

// format.ts's escapeHtml runs before this, so a captured math source may
// contain HTML entities (&amp; &lt; &gt; &quot; &#039;) in place of the
// literal characters — undo that before handing the source to KaTeX, which
// expects real LaTeX, not HTML-escaped text.
function unescapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

// Repairs LaTeX that was mangled by JSON escaping before it was saved. Gemini
// historically emitted single-backslash LaTeX inside its JSON response, and
// JSON.parse silently turned the commands' leading "\t"/"\f"/"\b"/"\n"/"\r"
// into control characters ("\tan" → TAB+"an", "\frac" → FORMFEED+"rac");
// where the escape would have been INVALID JSON (e.g. "\s"), the model dodged
// into degenerate forms like "\text{sin }", "\text{sqrt}(3)", "60^\text{o}".
// The server now repairs new generations before saving (see
// server/src/lib/assessmentSchema.js — keep the two in sync), but content
// saved before that fix still carries the damage, so the same repair runs
// here too, on the WHOLE text before the math patterns match — a mangled
// segment like "$<TAB>an ...$" would otherwise fail the delimiter match
// itself (its first character isn't the "\" of "\tan" yet) and never reach
// KaTeX at all. Control-char repair is safe globally (a control character
// followed by a lowercase letter has no legitimate meaning in this content);
// newline repair and degenerate-form normalization run only inside
// $...$/$$...$$ segments, where a "\n"-eaten \neq is unambiguous but a real
// newline in prose is not.
function repairMangledLatex(text: string): string {
  const repaired = text
    .replace(/\t(?=[a-z])/g, '\\t')
    .replace(/\f(?=[a-z])/g, '\\f')
    .replace(/[\b](?=[a-z])/g, '\\b')
    .replace(/\r(?=[a-z])/g, '\\r');
  return repaired.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g, (segment) =>
    segment
      .replace(/\n(?=[a-z])/g, '\\n')
      .replace(/\\text\{\s*(sin|cos|tan|sec|cot|csc|log|ln)\s*\}/g, '\\$1 ')
      .replace(/\\text\{\s*(cosec|arcsin|arccos|arctan)\s*\}/g, '\\operatorname{$1} ')
      .replace(/\\text\{\s*sqrt\s*\}\s*\(([^()]*)\)/g, '\\sqrt{$1}')
      // Braced/unbraced degree forms are separate alternatives so the outer
      // braces are only consumed as a PAIR — a lone \}? would eat the closing
      // brace of an enclosing \frac{...} argument.
      .replace(/\^(?:\{\\text\{\s*o\s*\}\}|\\text\{\s*o\s*\})/g, '^{\\circ}')
  );
}

function renderMath(source: string, displayMode: boolean): string {
  try {
    const html = katex.renderToString(unescapeHtml(source).trim(), {
      throwOnError: false,
      displayMode,
      output: 'htmlAndMathml',
    });
    // KaTeX's own output can contain literal newlines — e.g. an SVG \sqrt
    // glyph's `d="M95,702\nc-2.7,0,..."` path data is valid SVG with an
    // embedded newline as a coordinate separator. This function's result is
    // spliced back into the surrounding text BEFORE format.ts's line-anchored
    // (/gm, ^/$) passes (headings, numbered lists, bullets) run, and those
    // treat any '\n' as a line boundary — including one sitting in the
    // middle of an SVG attribute — which was splicing stray "</li>"/"</ol>"
    // tags into path data and breaking the glyph. Collapsing to spaces is
    // safe for HTML content and for SVG path data (whitespace is just a
    // coordinate separator there) and keeps every rendered segment on one
    // logical line, immune to that downstream splitting.
    return html.replace(/\n/g, ' ');
  } catch {
    // Never let a malformed expression break the whole page — fall back to
    // the source text, which is still HTML-escaped (escapeHtml ran before
    // renderMathSegments) and therefore safe to splice back into the page.
    // Unescaping here would re-open the XSS hole escapeHtml closed.
    return source;
  }
}

/**
 * Replaces $...$/$$...$$ math segments in already-HTML-escaped text with
 * rendered KaTeX markup. Must run on the escaped text BEFORE any other
 * Markdown-subset transform (headings, lists, bold) so those never see —
 * and can't accidentally mangle — literal LaTeX commands/braces.
 */
export function renderMathSegments(escapedText: string): string {
  let text = repairMangledLatex(escapedText);
  text = text.replace(BLOCK_MATH, (_m, src: string) => renderMath(src, true));
  text = text.replace(INLINE_MATH, (_m, src: string) => renderMath(src, false));
  return text;
}
