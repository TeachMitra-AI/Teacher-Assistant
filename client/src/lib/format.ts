import { renderMathSegments } from './math';

// Escapes HTML, then applies a small safe subset of Markdown so AI responses render with basic formatting without XSS risk.
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

  // Math (lib/math.ts) is rendered first: the line-pattern transforms below could otherwise collide with or mangle
  // LaTeX backslashes, braces, ^ and _ before KaTeX sees them.
  text = renderMathSegments(text);

  // Headings (# through ######).
  text = text.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes: string, content: string) => {
    const level = hashes.length;
    // Tag the answer-key heading (same shapes lib/assessment.ts splits on) so print CSS can start it on its own page.
    const isAnswerKey = /^(?:teacher(?:'s)?\s+)?answer\s*keys?\b/i.test(content.trim());
    return `<h${level}${isAnswerKey ? ' class="fmt-answer-key"' : ''}>${content}</h${level}>`;
  });

  // Pipe tables, for the Lesson Plan's Presentation section where the teacher/student activity pairing is the information.
  // Runs before the option and list passes, since a cell can begin with "A. " or "1. " and those line-anchored passes would
  // shred the row; it also keeps bare "|" lines away from the paragraph pass. Strict on purpose: a header row, a dash
  // separator, then body rows. Anything else stays text rather than half-rendered. Escaped pipes (\|) in a cell are
  // unescaped after splitting.
  text = text.replace(
    /^\|(.+)\|[ \t]*\n\|[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|[ \t]*\n((?:\|.*\|[ \t]*\n?)+)/gm,
    (_m, headerRow: string, bodyRows: string) => {
      const cells = (row: string) =>
        row
          .replace(/^\||\|[ \t]*$/g, '')
          // Split on unescaped pipes, then unescape the rest.
          .split(/(?<!\\)\|/)
          .map((c) => c.replace(/\\\|/g, '|').trim());

      const head = cells(headerRow)
        .map((c) => `<th>${c}</th>`)
        .join('');

      const body = bodyRows
        .split('\n')
        .filter((r) => r.trim().startsWith('|'))
        .map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join('')}</tr>`)
        .join('');

      return `<table class="fmt-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>\n`;
    }
  );

  // MCQ option lines ("A. ...") and lettered sub-parts ("(a) ..."). Rendered as block elements, not list items, so they
  // aren't swept into the numbered question <ol> and renumbered, and always land on their own line.
  // The model sometimes puts all four options on one line ("A. 6 cm B. 10 cm C. 12 cm D. 18 cm"); split that first.
  text = text.replace(
    /^(.*?)\bA\.\s+(.*?)\s+B\.\s+(.*?)\s+C\.\s+(.*?)\s+D\.\s+(.*)$/gm,
    (_m, lead: string, a: string, b: string, c: string, d: string) => {
      const prefix = lead.trim() ? `${lead.trim()}\n` : '';
      return `${prefix}<div class="fmt-option">A. ${a}</div><div class="fmt-option">B. ${b}</div><div class="fmt-option">C. ${c}</div><div class="fmt-option">D. ${d}</div>`;
    }
  );
  text = text.replace(/^([A-D])\.\s+(.+)$/gm, '<div class="fmt-option">$1. $2</div>');
  text = text.replace(/^\(([a-z])\)\s+(.+)$/gm, '<div class="fmt-subpart">($1) $2</div>');

  // Group each run of option lines into one container so a question's options lay out as a unit (two-column grid on the
  // printed paper) and stay together across page breaks. Options hold no nested <div>s (KaTeX output is spans), so the
  // non-greedy match closes at the option's own </div>.
  text = text.replace(
    /(?:<div class="fmt-option">[\s\S]*?<\/div>\n?)+/g,
    (run) => `<div class="fmt-options">${run}</div>`
  );

  // Numbered and bulleted items become <li> (tagged by origin) and are wrapped in a single pass; two separate passes made
  // the second re-wrap the already-<ol> items in a nested <ul>, rendering every numbered question as a bullet.
  // The numeral stays in the <li> text (marker hidden in CSS) instead of relying on the <ol> counter: each numbered
  // question is followed by <div class="fmt-option"> blocks, which break the consecutive-<li> run, so every question would be
  // its own single-item <ol> and show "1.". The source numbering is already sequential (assigned server-side). The number is
  // wrapped in a span so the paper styles can bold it and hang it into the margin.
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
