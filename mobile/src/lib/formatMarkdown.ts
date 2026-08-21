// A React Native analogue of client/src/lib/format.ts's formatResponse().
//
// The web version builds an HTML string (dangerouslySetInnerHTML) with a
// hand-rolled Markdown-subset-to-HTML transform. React Native has no HTML
// renderer, so this parses the same Coach-response shape (headings, **bold**,
// numbered/bulleted lists, paragraphs) into a small block structure that a
// component renders as native Text/View — same subset, different output.
//
// Deliberately NOT ported: pipe tables and the MCQ "A./B./C./D." option
// layout (client/src/lib/format.ts:35-103) — both exist for the
// Generator/Library exam-paper print layout, not for an ordinary Coach chat
// answer; §26 Phase 4 scopes this phase to the chat loop, not the print
// layout. LaTeX math ($...$/$$...$$ via KaTeX) is also not ported — flagged
// as an open risk in docs/mobile-app-plan.md §26 Phase 4/§28, deferred
// per that section's own "ship without math rendering first if necessary"
// guidance rather than guessed at here.

export interface InlineSegment {
  text: string;
  bold?: boolean;
}

export type MarkdownBlock =
  | { type: 'heading'; level: number; segments: InlineSegment[] }
  | { type: 'paragraph'; segments: InlineSegment[] }
  | { type: 'list'; ordered: boolean; items: InlineSegment[][] };

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const NUMBERED_RE = /^\d+\.\s+(.+)$/;
const BULLETED_RE = /^[•\-*]\s+(.+)$/;

/** Splits one line of text into plain/bold segments on **bold** markers. */
function parseInline(line: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) {
    if (match.index > lastIndex) segments.push({ text: line.slice(lastIndex, match.index) });
    segments.push({ text: match[1], bold: true });
    lastIndex = re.lastIndex;
  }
  if (lastIndex < line.length) segments.push({ text: line.slice(lastIndex) });
  return segments;
}

/** Joins per-line inline segments into one run, with an explicit newline
 *  segment between lines — RN's <Text> renders embedded "\n" as a line break,
 *  unlike HTML's whitespace-collapsing, so multi-line paragraphs stay legible
 *  without the web version's needing "\n\n" specifically. */
function joinLines(lines: string[]): InlineSegment[] {
  const out: InlineSegment[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push({ text: '\n' });
    out.push(...parseInline(line));
  });
  return out;
}

export function parseMarkdownBlocks(raw: string): MarkdownBlock[] {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];

  let paragraphLines: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  function flushParagraph() {
    if (paragraphLines.length === 0) return;
    blocks.push({ type: 'paragraph', segments: joinLines(paragraphLines) });
    paragraphLines = [];
  }

  function flushList() {
    if (listItems.length === 0) return;
    blocks.push({ type: 'list', ordered: listOrdered, items: listItems.map((item) => parseInline(item)) });
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (line.trim().length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'heading', level: heading[1].length, segments: parseInline(heading[2]) });
      continue;
    }

    const numbered = line.match(NUMBERED_RE);
    if (numbered) {
      flushParagraph();
      if (listItems.length > 0 && !listOrdered) flushList();
      listOrdered = true;
      listItems.push(numbered[1]);
      continue;
    }

    const bulleted = line.match(BULLETED_RE);
    if (bulleted) {
      flushParagraph();
      if (listItems.length > 0 && listOrdered) flushList();
      listOrdered = false;
      listItems.push(bulleted[1]);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return blocks;
}
