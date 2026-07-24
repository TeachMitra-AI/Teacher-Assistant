import { renderMathSegments } from './math';

// Escapes HTML, then applies a small, safe subset of Markdown so the AI
// response can be rendered with basic formatting without XSS risk.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatResponse(raw: string): string {
  let text = escapeHtml(raw);

  // Math ($...$/$$...$$ LaTeX, see lib/math.ts) is rendered FIRST, before any
  // other Markdown-subset transform below — those operate on line patterns
  // (^#, ^\d+\., **bold**) and literal LaTeX (backslashes, braces, ^ and _)
  // could otherwise collide with them or get mangled before KaTeX ever sees it.
  text = renderMathSegments(text);

  // Headings (# through ######). Previously only ### (H3) was handled, so a
  // generated document's "# Title" and "## Questions" headings passed through
  // untouched and rendered as literal hash characters.
  text = text.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes: string, content: string) => {
    const level = hashes.length;
    // Tag the answer-key heading (same shapes lib/assessment.ts splits on) so
    // print CSS can push the answer key onto its own page, separated from the
    // question paper itself.
    const isAnswerKey = /^(?:teacher(?:'s)?\s+)?answer\s*keys?\b/i.test(content.trim());
    return `<h${level}${isAnswerKey ? ' class="fmt-answer-key"' : ''}>${content}</h${level}>`;
  });

  // MCQ option lines ("A. ...", "B. ...", "C. ...", "D. ...") and lettered
  // sub-parts ("(a) ...", "(b) ..."). These are rendered as their own block
  // elements — not list items — so they can't be swept into the numbered
  // question <ol> below (which would wrongly renumber them as questions),
  // and so they always land on their own line instead of running together
  // with adjacent single-newline-separated lines.
  //
  // The model doesn't always put one option per line as instructed — it
  // sometimes emits all four on a single line ("A. 6 cm B. 10 cm C. 12 cm
  // D. 18 cm"). Split that shape into individual options first; genuinely
  // one-per-line options are handled by the line-anchored pass below.
  text = text.replace(
    /^(.*?)\bA\.\s+(.*?)\s+B\.\s+(.*?)\s+C\.\s+(.*?)\s+D\.\s+(.*)$/gm,
    (_m, lead: string, a: string, b: string, c: string, d: string) => {
      const prefix = lead.trim() ? `${lead.trim()}\n` : '';
      return `${prefix}<div class="fmt-option">A. ${a}</div><div class="fmt-option">B. ${b}</div><div class="fmt-option">C. ${c}</div><div class="fmt-option">D. ${d}</div>`;
    }
  );
  text = text.replace(/^([A-D])\.\s+(.+)$/gm, '<div class="fmt-option">$1. $2</div>');
  text = text.replace(/^\(([a-z])\)\s+(.+)$/gm, '<div class="fmt-subpart">($1) $2</div>');

  // Group each run of consecutive option lines into one container, so the
  // options of a question can be laid out as a unit (two-column grid on the
  // printed paper) and kept together across page breaks. Options never
  // contain nested <div>s (KaTeX output is spans), so the non-greedy match
  // always closes at the option's own </div>.
  text = text.replace(
    /(?:<div class="fmt-option">[\s\S]*?<\/div>\n?)+/g,
    (run) => `<div class="fmt-options">${run}</div>`
  );

  // Numbered and bulleted list items. Both are converted to <li> (tagged by
  // origin) and wrapped in a SINGLE pass below. Wrapping numbered and
  // bulleted lines in two separate passes — convert+wrap numbered lines,
  // then convert+wrap bulleted lines — silently broke numbering: the second
  // pass's "skip if already wrapped" check only inspected the matched
  // <li>...</li> text itself, which never includes the surrounding <ol>
  // tag added by the first pass (that tag sits outside the match). So it
  // always re-wrapped the already-<ol>-wrapped items in a spurious nested
  // <ul>, and every numbered question rendered as a bullet instead of "1.".
  //
  // The numeral itself is kept in the <li>'s text (rather than left to the
  // browser's own <ol> auto-counter) and the marker is hidden in CSS
  // (list-style: none). A numbered question is immediately followed by its
  // MCQ option lines — now separate <div class="fmt-option"> blocks, not
  // <li> siblings — which breaks the "consecutive <li>" run each question
  // would need to share ONE <ol> for auto-numbering to stay sequential
  // across questions. Every question ends up in its own single-item <ol>,
  // so auto-numbering would show "1." for every question. Since Phase 1
  // guarantees the source numbering is already correct and sequential
  // (assigned server-side, not by the model), showing that literal number
  // is more reliable here than relying on <ol>'s counter.
  // The question number is wrapped in its own span so the paper styles can
  // bold it and hang it into the margin (professional exam-paper layout)
  // without giving up the literal-number reliability described above.
  text = text.replace(/^(\d+)\.\s+(.+)$/gm, '<li class="fmt-li-ol"><span class="fmt-qnum">$1.</span> $2</li>');
  text = text.replace(/^[•\-*]\s+(.+)$/gm, '<li class="fmt-li-ul">$1</li>');
  text = text.replace(/(<li class="fmt-li-(?:ol|ul)">[\s\S]*?<\/li>\n?)+/g, (run) => {
    const tag = run.includes('fmt-li-ol') ? 'ol' : 'ul';
    return `<${tag}>${run}</${tag}>`;
  });

  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Paragraphs
  text = text.replace(/\n\n/g, '</p><p>');
  return `<p>${text}</p>`;
}
