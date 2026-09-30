// Renders LaTeX segments in AI-generated or teacher-edited text as real notation instead of raw "$\sin\theta$". The
// generation prompt (server/src/routes/resources.js) tells Gemini to delimit all math with $...$ or $$...$$ and never
// use Unicode symbols, so there's one convention.
import katex from 'katex';

// Block math first so a $$...$$ pair isn't mis-split by the inline pattern into two bare "$" delimiters.
const BLOCK_MATH = /\$\$([\s\S]+?)\$\$/g;
// Inline math never spans a line and must start and end with a non-space, so "costs $5 and $10" doesn't pair into one bogus
// segment. A lone "$" with no close on the line is left alone.
const INLINE_MATH = /\$(\S(?:[^$\n]*?\S)?)\$/g;

// escapeHtml (format.ts) runs first, so captured math may contain HTML entities; undo that since KaTeX expects real LaTeX.
function unescapeHtml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

// Repairs LaTeX mangled by JSON escaping before it was saved. Gemini emitted single-backslash LaTeX, and JSON.parse turned
// a leading "\t"/"\f"/"\b"/"\n"/"\r" into control characters ("\tan" → TAB+"an"); where the escape was invalid JSON (e.g.
// "\s") it produced degenerate forms like "\text{sin }". The server repairs new generations
// (server/src/lib/assessmentSchema.js; keep the two in sync) but older saved content still needs it.
// It runs on the whole text before the math patterns match, since a mangled segment can fail the delimiter match itself.
// Control-char repair is safe globally; newline repair and degenerate-form normalization run only inside $...$ segments,
// where an eaten "\n" in \neq is unambiguous but a real newline in prose isn't. Backspace (from \beta/\binom) uses a string
// scan because a regex would need a control-character escape, which the no-control-regex rule forbids.
function repairBackspaceLatex(text: string): string {
  if (!text.includes('\b')) return text;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\b' && /[a-z]/.test(text[i + 1] || '')) out += '\\b';
    else out += ch;
  }
  return out;
}

function repairMangledLatex(text: string): string {
  const repaired = repairBackspaceLatex(
    text
      .replace(/\t(?=[a-z])/g, '\\t')
      .replace(/\f(?=[a-z])/g, '\\f')
      .replace(/\r(?=[a-z])/g, '\\r')
  );
  return repaired.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g, (segment) =>
    segment
      .replace(/\n(?=[a-z])/g, '\\n')
      .replace(/\\text\{\s*(sin|cos|tan|sec|cot|csc|log|ln)\s*\}/g, '\\$1 ')
      .replace(/\\text\{\s*(cosec|arcsin|arccos|arctan)\s*\}/g, '\\operatorname{$1} ')
      .replace(/\\text\{\s*sqrt\s*\}\s*\(([^()]*)\)/g, '\\sqrt{$1}')
      // Braced and unbraced forms are separate alternatives so braces are consumed only as a pair; a lone \}? would eat
      // the closing brace of an enclosing \frac{...}.
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
    // KaTeX output can contain literal newlines (e.g. an SVG \sqrt glyph's path data). This result is spliced in before
    // format.ts's line-anchored passes, which would treat that newline as a line boundary and inject stray "</li>" tags into
    // the path. Collapsing to spaces is safe for HTML and SVG path data.
    return html.replace(/\n/g, ' ');
  } catch {
    // A malformed expression must not break the page: fall back to the source, which is still HTML-escaped and safe.
    // Unescaping here would re-open the XSS hole escapeHtml closes.
    return source;
  }
}

/** Replaces $...$/$$...$$ segments in already-escaped text with KaTeX markup. Runs before other Markdown transforms so they can't mangle LaTeX. */
export function renderMathSegments(escapedText: string): string {
  let text = repairMangledLatex(escapedText);
  text = text.replace(BLOCK_MATH, (_m, src: string) => renderMath(src, true));
  text = text.replace(INLINE_MATH, (_m, src: string) => renderMath(src, false));
  return text;
}
