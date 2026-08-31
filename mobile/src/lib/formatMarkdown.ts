// A React Native analogue of client/src/lib/format.ts's formatResponse().
//
// The web version builds an HTML string (dangerouslySetInnerHTML) with a
// hand-rolled Markdown-subset-to-HTML transform. React Native has no HTML
// renderer, so this parses the same shape (headings, **bold**, pipe tables,
// MCQ "A./B./C./D." options, lettered "(a)" sub-parts, numbered/bulleted
// lists, paragraphs) into a small block structure that a component renders
// as native Text/View — same subset, different output. Pipe tables and MCQ
// option layout are ported from client/src/lib/format.ts:35-103 (mirroring
// mobile/src/lib/formatHtml.ts's already-ported version for the PDF export
// path) so the Generator's legacy/fallback preview and Coach chat both match
// web's table/option rendering.
//
// Deliberately NOT ported: LaTeX math ($...$/$$...$$ via KaTeX) — flagged as
// an open risk in docs/mobile-app-plan.md §26 Phase 4/§28, deferred per that
// section's own "ship without math rendering first if necessary" guidance
// rather than guessed at here.

export interface InlineSegment {
  text: string;
  bold?: boolean;
}

export type MarkdownBlock =
  | { type: 'heading'; level: number; segments: InlineSegment[] }
  | { type: 'paragraph'; segments: InlineSegment[] }
  | { type: 'list'; ordered: boolean; items: InlineSegment[][] }
  | { type: 'options'; items: { letter: string; segments: InlineSegment[] }[] }
  | { type: 'subpart'; letter: string; segments: InlineSegment[] }
  | { type: 'table'; header: string[]; rows: string[][] };

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const NUMBERED_RE = /^\d+\.\s+(.+)$/;
const BULLETED_RE = /^[•\-*]\s+(.+)$/;

// Strict pipe-table shape: header row, dash separator row, then body rows —
// same regex as client/src/lib/format.ts:51 / mobile/src/lib/formatHtml.ts:35.
const TABLE_RE =
  /^\|(.+)\|[ \t]*\n\|[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|[ \t]*\n((?:\|.*\|[ \t]*\n?)+)/gm;
const MULTI_OPTION_RE = /^(.*?)\bA\.\s+(.*?)\s+B\.\s+(.*?)\s+C\.\s+(.*?)\s+D\.\s+(.*)$/gm;
const SINGLE_OPTION_RE = /^([A-D])\.\s+(.+)$/gm;
const SUBPART_RE = /^\(([a-z])\)\s+(.+)$/gm;

// Sentinel markers substituted for a table/options/subpart block extracted
// ahead of the line-by-line paragraph/list scan below, so that scan never
// sees (and never shreds) a table cell or option line. U+E000-U+E002 are
// Unicode Private Use Area code points — never produced by real
// teacher/AI-generated text — so they're safe, unambiguous delimiters.
const BLOCK_MARK_RE = /^(\d+)$/;
const blockMark = (i: number) => `${i}`;
const OPTION_START = '';
const OPTION_END = '';
const OPTION_UNIT_RE = /([A-D])([\s\S]*?)/g;
const OPTION_RUN_RE = /(?:[A-D][\s\S]*?\n?)+/g;

function tableCells(row: string): string[] {
  return row
    .replace(/^\||\|[ \t]*$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
}

/** Extracts tables, MCQ options, and lettered sub-parts out of the raw text
 *  into `pending` blocks, replacing each with a sentinel marker so the
 *  line-by-line scan below can treat the rest of the text exactly as before
 *  (order mirrors format.ts: tables, then options, then sub-parts, then
 *  grouping consecutive options into one block). */
function extractStructuralBlocks(raw: string): { text: string; pending: MarkdownBlock[] } {
  const pending: MarkdownBlock[] = [];
  let text = raw;

  text = text.replace(TABLE_RE, (_m, headerRow: string, bodyRows: string) => {
    const header = tableCells(headerRow);
    const rows = bodyRows
      .split('\n')
      .filter((r) => r.trim().startsWith('|'))
      .map(tableCells);
    pending.push({ type: 'table', header, rows });
    return `${blockMark(pending.length - 1)}\n`;
  });

  // The model doesn't always put one option per line — sometimes it emits
  // all four on one line ("A. 6 cm B. 10 cm C. 12 cm D. 18 cm"). Expand that
  // shape into individually-tagged option units first; genuinely
  // one-per-line options are handled by the line-anchored pass below.
  text = text.replace(MULTI_OPTION_RE, (_m, lead: string, a: string, b: string, c: string, d: string) => {
    const prefix = lead.trim() ? `${lead.trim()}\n` : '';
    return (
      `${prefix}${OPTION_START}A${a}${OPTION_END}${OPTION_START}B${b}${OPTION_END}` +
      `${OPTION_START}C${c}${OPTION_END}${OPTION_START}D${d}${OPTION_END}`
    );
  });
  text = text.replace(SINGLE_OPTION_RE, `${OPTION_START}$1$2${OPTION_END}`);
  text = text.replace(SUBPART_RE, (_m, letter: string, content: string) => {
    pending.push({ type: 'subpart', letter, segments: parseInline(content) });
    return blockMark(pending.length - 1);
  });

  // Group each run of consecutive option units into one options block, same
  // as format.ts's fmt-options grid grouping.
  text = text.replace(OPTION_RUN_RE, (run) => {
    const items: { letter: string; segments: InlineSegment[] }[] = [];
    for (const m of run.matchAll(OPTION_UNIT_RE)) {
      items.push({ letter: m[1], segments: parseInline(m[2]) });
    }
    pending.push({ type: 'options', items });
    return `${blockMark(pending.length - 1)}\n`;
  });

  return { text, pending };
}

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
  const { text: extracted, pending } = extractStructuralBlocks(raw);
  const lines = extracted.replace(/\r\n/g, '\n').split('\n');
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

    const blockRef = line.match(BLOCK_MARK_RE);
    if (blockRef) {
      flushParagraph();
      flushList();
      blocks.push(pending[Number(blockRef[1])]);
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
