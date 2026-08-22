// Ported from client/src/lib/format.ts's formatResponse() (docs/mobile-app-plan.md
// §19/§26 Phase 5) — used ONLY to build the HTML document handed to
// expo-print for a resource's PDF export (mobile/src/lib/buildResourcePdfHtml.ts).
// On-screen viewing/editing renders through MarkdownText (lib/formatMarkdown.ts)
// instead, same split Phase 4 established for Coach.
//
// Deliberately NOT ported: LaTeX math rendering (renderMathSegments/KaTeX) —
// same open risk/deferral as Phase 4 (docs/mobile-app-plan.md §28): a
// resource containing $...$/$$...$$ math exports with the literal delimiters
// rather than typeset math. Everything else (headings, pipe tables, MCQ
// option layout, numbered/bulleted lists, bold, paragraphs) is a faithful
// port since the exam-paper print layout depends on it (§26 Phase 5's own
// risk note).
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatResponseHtml(raw: string): string {
  let text = escapeHtml(raw);

  // Headings (# through ######).
  text = text.replace(/^(#{1,6})\s+(.+)$/gm, (_m, hashes: string, content: string) => {
    const level = hashes.length;
    const isAnswerKey = /^(?:teacher(?:'s)?\s+)?answer\s*keys?\b/i.test(content.trim());
    return `<h${level}${isAnswerKey ? ' class="fmt-answer-key"' : ''}>${content}</h${level}>`;
  });

  // Pipe tables — strict shape: header row, dash separator row, body rows.
  text = text.replace(
    /^\|(.+)\|[ \t]*\n\|[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|[ \t]*\n((?:\|.*\|[ \t]*\n?)+)/gm,
    (_m, headerRow: string, bodyRows: string) => {
      const cells = (row: string) =>
        row
          .replace(/^\||\|[ \t]*$/g, '')
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

  // MCQ option lines ("A. ...".."D. ...", possibly all on one line) and
  // lettered sub-parts ("(a) ...").
  text = text.replace(
    /^(.*?)\bA\.\s+(.*?)\s+B\.\s+(.*?)\s+C\.\s+(.*?)\s+D\.\s+(.*)$/gm,
    (_m, lead: string, a: string, b: string, c: string, d: string) => {
      const prefix = lead.trim() ? `${lead.trim()}\n` : '';
      return `${prefix}<div class="fmt-option">A. ${a}</div><div class="fmt-option">B. ${b}</div><div class="fmt-option">C. ${c}</div><div class="fmt-option">D. ${d}</div>`;
    }
  );
  text = text.replace(/^([A-D])\.\s+(.+)$/gm, '<div class="fmt-option">$1. $2</div>');
  text = text.replace(/^\(([a-z])\)\s+(.+)$/gm, '<div class="fmt-subpart">($1) $2</div>');

  text = text.replace(
    /(?:<div class="fmt-option">[\s\S]*?<\/div>\n?)+/g,
    (run) => `<div class="fmt-options">${run}</div>`
  );

  // Numbered and bulleted list items.
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
