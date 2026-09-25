// Ported from client/src/lib/math.ts (see that file's own header for the
// full rationale) — renders LaTeX math segments embedded in AI-generated /
// teacher-edited text ($...$ inline, $$...$$ block) into real KaTeX
// notation instead of leaving raw delimiters visible.
//
// Consumed by lib/formatHtml.ts (the HTML-string pipeline shared by the
// PDF-export document handed to expo-print AND, for any text containing
// math, the on-screen preview — see components/FormattedHtmlView.tsx for why
// on-screen math renders through the same HTML+KaTeX-CSS pipeline as print
// rather than a per-expression native approximation).
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

// Repairs LaTeX that was mangled by JSON escaping before it was saved (same
// bug and same fix as client/src/lib/math.ts and
// server/src/lib/assessmentSchema.js — keep all three in sync).
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
      .replace(/\^(?:\{\\text\{\s*o\s*\}\}|\\text\{\s*o\s*\})/g, '^{\\circ}')
  );
}

// Backspace (the "\b" of a JSON-eaten \beta/\binom) is handled with a plain
// string scan rather than a regex: a regex can only express that character
// as a control-character escape, which the no-control-regex lint rule
// forbids (same approach as the client/server twins of this function).
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

function renderMath(source: string, displayMode: boolean): string {
  try {
    const html = katex.renderToString(unescapeHtml(source).trim(), {
      throwOnError: false,
      displayMode,
      output: 'htmlAndMathml',
    });
    // KaTeX's own output can contain literal newlines (e.g. an SVG \sqrt
    // glyph's path data) — collapse to spaces so a downstream line-anchored
    // pass never mistakes one for a line boundary. See client/src/lib/math.ts's
    // renderMath for the full explanation.
    return html.replace(/\n/g, ' ');
  } catch {
    // Never let a malformed expression break the whole page — fall back to
    // the source text, which is still HTML-escaped and therefore safe to
    // splice back into the page.
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

// Cheap pre-check for whether text contains any $...$/$$...$$ delimiters at
// all, so callers that render two different ways (a fast native path vs. the
// full KaTeX-capable HTML pipeline — see MarkdownText.tsx) can skip the HTML
// path entirely for the common math-free case. Intentionally permissive: a
// false positive (e.g. a lone currency "$5") just costs an unnecessary HTML
// render, never an incorrect one, since renderMathSegments leaves genuinely
// non-math "$" text untouched.
export function containsMath(text: string): boolean {
  return text.includes('$');
}
