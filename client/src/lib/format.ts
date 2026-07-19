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

  // Headings (###)
  text = text.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');

  // Numbered list items
  text = text.replace(/^(\d+)\.\s+(.+)$/gm, '<li>$2</li>');
  text = text.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => `<ol>${m}</ol>`);

  // Bullet list items (avoid re-wrapping ordered lists)
  text = text.replace(/^[•\-*]\s+(.+)$/gm, '<li>$1</li>');
  text = text.replace(/(<li>[\s\S]*?<\/li>\n?)+/g, (m) => (m.includes('<ol>') ? m : `<ul>${m}</ul>`));

  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Paragraphs
  text = text.replace(/\n\n/g, '</p><p>');
  return `<p>${text}</p>`;
}
