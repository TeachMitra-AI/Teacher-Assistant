// Turns an AI Coach response (the raw Markdown/LaTeX string ResponseCard renders through format.ts) into plain text a
// speech engine can read. Engines vary in what they do with "**", "#", "|" and "\frac", so none of that should reach them.
// Only the Markdown subset format.ts renders is handled on purpose, plus a few forms the model sometimes emits anyway
// (italics, links, code), which format.ts shows literally. Indic scripts, Devanagari digits and Roman-script Hinglish pass
// through untouched: every rule below targets ASCII markup, never letters.

// Same delimiters as math.ts, so "costs $5 and $10" is never paired into one bogus segment and a lone "$" is left alone.
const BLOCK_MATH = /\$\$([\s\S]+?)\$\$/g;
const INLINE_MATH = /\$(\S(?:[^$\n]*?\S)?)\$/g;

// Same strict shape as the table pass in format.ts: header row, dash separator, body rows. Anything looser is not a table.
const TABLE = /^\|(.+)\|[ \t]*\n\|[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|[ \t]*\n((?:\|.*\|[ \t]*\n?)+)/gm;

// A sentence-ending mark (Latin or Devanagari danda), optionally followed by a closing quote or bracket, or by the
// "**" / "_" of bold or italic text that wraps it ("**Heading:**"), which is stripped only after this test.
const ENDS_SENTENCE = /[.!?:;,…।॥]["')\]”’*_]*$/;

const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

const MATH_WORDS: Record<string, string> = {
  times: 'times', cdot: 'times', div: 'divided by', pm: 'plus or minus', mp: 'minus or plus',
  pi: 'pi', theta: 'theta', alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', Delta: 'delta',
  sigma: 'sigma', mu: 'mu', lambda: 'lambda', omega: 'omega', phi: 'phi',
  le: 'less than or equal to', leq: 'less than or equal to', ge: 'greater than or equal to', geq: 'greater than or equal to',
  neq: 'not equal to', ne: 'not equal to', approx: 'approximately equal to', infty: 'infinity',
  sin: 'sine', cos: 'cosine', tan: 'tangent', log: 'log', ln: 'natural log',
  to: 'gives', rightarrow: 'gives', Rightarrow: 'implies', sum: 'sum', angle: 'angle', triangle: 'triangle',
  therefore: 'therefore', degree: 'degrees', circ: 'degrees',
};

// Spoken English for a LaTeX segment. Common notation is mapped to words; anything unknown loses its backslash command and
// braces but keeps its letters and digits. The wording is English even in a Hindi answer, a known limitation.
function mathToSpeech(src: string): string {
  let s = src.replace(/\\\\/g, ' ');

  // Innermost-first, repeated, so simple nesting (a fraction inside a root) resolves.
  // A whole number directly before a numeric fraction is a mixed number ("1\frac{1}{4}"); "2\frac{x}{y}" is not.
  s = s.replace(/(\d+)\s*\\[dt]?frac\s*\{(\d+)\}\s*\{(\d+)\}/g, ' $1 and $2 by $3 ');

  for (let i = 0; i < 4; i++) {
    s = s
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, ' $1 by $2 ')
      .replace(/\\sqrt\s*\[3\]\s*\{([^{}]*)\}/g, ' cube root of $1 ')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, ' square root of $1 ')
      .replace(/\\(?:text|mathrm|mathbf|textbf|operatorname)\s*\{([^{}]*)\}/g, ' $1 ');
  }
  s = s.replace(/\\sqrt\s*(\w)/g, ' square root of $1 ');

  // Powers and subscripts before braces are stripped, since the braces say what the exponent covers.
  s = s
    .replace(/\^\s*\{?\s*\\circ\s*\}?/g, ' degrees ')
    .replace(/\^\s*\{?\s*2\s*\}?/g, ' squared ')
    .replace(/\^\s*\{?\s*3\s*\}?/g, ' cubed ')
    .replace(/\^\s*\{([^{}]*)\}/g, ' to the power $1 ')
    .replace(/\^\s*(\w)/g, ' to the power $1 ')
    .replace(/_\s*\{([^{}]*)\}/g, ' sub $1 ')
    .replace(/_\s*(\w)/g, ' sub $1 ');

  s = s
    .replace(/\\%/g, ' percent ')
    .replace(/\\([$&#_{}])/g, ' ')
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\\([a-zA-Z]+)/g, (_m, name: string) => (MATH_WORDS[name] ? ` ${MATH_WORDS[name]} ` : ' '));

  s = s
    .replace(/[{}]/g, ' ')
    .replace(/=/g, ' equals ')
    .replace(/\+/g, ' plus ')
    .replace(/[-−]/g, ' minus ')
    .replace(/</g, ' less than ')
    .replace(/>/g, ' greater than ')
    .replace(/\*/g, ' times ')
    .replace(/\//g, ' divided by ')
    .replace(/%/g, ' percent ')
    .replace(/[|^_~&]/g, ' ');

  s = s.replace(/\s+/g, ' ').trim();
  // Nothing readable left (pure symbols): say nothing rather than letting the engine spell out punctuation.
  return HAS_WORD_CHAR.test(s) ? s : '';
}

// Replaces each math segment with its speech, padding with a space only against a word character on that side, so
// "Find $x$." doesn't become "Find x ." (a stray space before the stop).
function spokenMath(text: string, pattern: RegExp): string {
  return text.replace(pattern, (_m, src: string, offset: number, whole: string) => {
    const speech = mathToSpeech(src);
    const before = offset > 0 && /[\p{L}\p{N}]/u.test(whole[offset - 1]) ? ' ' : '';
    const end = offset + _m.length;
    const after = end < whole.length && /[\p{L}\p{N}]/u.test(whole[end]) ? ' ' : '';
    return `${before}${speech}${after}`;
  });
}

function tableCells(row: string): string[] {
  return row
    .replace(/^\||\|[ \t]*$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|').trim());
}

// The lesson plan's step column is headed "#", which would be read as "#: 1". A header with no letters or digits is no
// label at all, and "#" specifically means a step number.
function labelledCell(header: string | undefined, cell: string): string {
  if (!cell) return '';
  if (header === '#') return `Step ${cell}`;
  return header && HAS_WORD_CHAR.test(header) ? `${header}: ${cell}` : cell;
}

// Each body row becomes one sentence ("Teacher Activity: ..., Student Activity: ...") so the pairing a table carries
// survives without reading pipes or the dash separator.
function tableToSentences(headerRow: string, bodyRows: string): string {
  const headers = tableCells(headerRow);
  const sentences = bodyRows
    .split('\n')
    .filter((r) => r.trim().startsWith('|'))
    .map((r) => {
      const parts = tableCells(r)
        // A literal "|" left by an escaped \| would be read as "pipe" or "bar"; a comma pauses instead.
        .map((cell, i) => labelledCell(headers[i], cell.replace(/\s*\|\s*/g, ', ')))
        .filter(Boolean);
      return ensureEnd(parts.join(', '));
    })
    .filter((line) => HAS_WORD_CHAR.test(line));
  return `${sentences.join('\n')}\n`;
}

// Gives a list item or heading its own pause: engines run unpunctuated lines together.
function ensureEnd(line: string): string {
  const trimmed = line.trim();
  return !trimmed || ENDS_SENTENCE.test(trimmed) ? trimmed : `${trimmed}.`;
}

function lineByLine(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) return '';
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return '';
      // A "|" row that wasn't a strict table: drop dash separators, read other cells as a comma list.
      if (/^\s*\|/.test(line)) {
        if (/^[\s|:-]+$/.test(line)) return '';
        return ensureEnd(tableCells(line.trim()).filter(Boolean).join(', '));
      }
      let m = line.match(/^\s*#{1,6}\s+(.+)$/);
      if (m) return ensureEnd(m[1]);
      m = line.match(/^\s*>\s?(.*)$/);
      if (m) line = m[1];
      m = line.match(/^\s*[•\-*]\s+(.+)$/);
      if (m) return ensureEnd(m[1]);
      // Numbers stay: they identify the question. Devanagari digits too, even though format.ts only numbers ASCII ones.
      m = line.match(/^\s*([0-9०-९]+\.\s+.+)$/);
      if (m) return ensureEnd(m[1]);
      m = line.match(/^\s*(?:[A-D]\.|\([a-z]\))\s+.+$/);
      if (m) return ensureEnd(line);
      return line;
    })
    .join('\n');
}

function stripInlineMarkup(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)\s]+(?:\s+"[^"]*")?\)/g, '$1')
    // Never read a URL aloud. The final class excludes trailing sentence punctuation so "see https://x.in." keeps its stop.
    // ASCII only, so a danda or Hindi word that follows the URL isn't swallowed with it.
    .replace(/\b(?:https?:\/\/|www\.)[^\s\u0080-\uFFFF)\]]*[^\s\u0080-\uFFFF).,;:!?\]]/g, 'link')
    .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
    .replace(/`+([^`\n]*)`+/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(\S[^*\n]*?)\*/g, '$1')
    .replace(/(?<!\w)_(\S[^_\n]*?)_(?!\w)/g, '$1')
    .replace(/ \* /g, ' times ')
    .replace(/\*+/g, '')
    // Emoji and their selectors. ZWJ/ZWNJ are real Indic joiners, so a joiner is only dropped when it is stranded.
    .replace(/\p{Extended_Pictographic}|[\uFE0F\u20E3]/gu, '')
    .replace(/(^|\s)[\u200D\u200C]+|[\u200D\u200C]+(?=\s|$)/g, '$1');
}

export function toSpeechText(markdown: string): string {
  let text = markdown.replace(/\r\n?/g, '\n');

  // Math first, before any pass that would treat its "_", "*", "|" or "\" as markup.
  text = spokenMath(text, BLOCK_MATH);
  text = spokenMath(text, INLINE_MATH);

  text = text.replace(TABLE, (_m, headerRow: string, bodyRows: string) => tableToSentences(headerRow, bodyRows));
  text = lineByLine(text);
  text = stripInlineMarkup(text);

  // Lines left with no letter or digit (a stray "—", a symbol-only math segment) would only produce noise.
  const lines = text.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim());
  return lines
    .map((l) => (HAS_WORD_CHAR.test(l) ? l : ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
