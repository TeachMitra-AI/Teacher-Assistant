import { describe, expect, it } from 'vitest';
import { toSpeechText } from './speechText';

describe('toSpeechText: Markdown', () => {
  it('strips heading markers and gives the heading its own sentence', () => {
    expect(toSpeechText('## Learning Objectives\nStudents will add.')).toBe('Learning Objectives.\nStudents will add.');
  });

  it('does not add a stop after a bold heading that already ends in a colon', () => {
    expect(toSpeechText('1. **Heading (x):**')).toBe('1. Heading (x):');
    expect(toSpeechText('## **Heading:**')).toBe('Heading:');
    expect(toSpeechText('- **Remediate:**')).toBe('Remediate:');
    expect(toSpeechText('3. **C** (0.75) **How to Check:**')).toBe('3. C (0.75) How to Check:');
  });

  it('still ends a bold heading or item that has no stop of its own', () => {
    expect(toSpeechText('1. **Heading**')).toBe('1. Heading.');
    expect(toSpeechText('## **Heading**')).toBe('Heading.');
  });

  it('keeps an existing heading stop instead of doubling it', () => {
    expect(toSpeechText('# Why?')).toBe('Why?');
  });

  it('removes bullet markers of every kind and ends each item', () => {
    expect(toSpeechText('• one\n- two\n* three')).toBe('one.\ntwo.\nthree.');
  });

  it('keeps numbered-list numbers, ASCII and Devanagari', () => {
    expect(toSpeechText('1. Add 2 and 3\n२. जोड़ें')).toBe('1. Add 2 and 3.\n२. जोड़ें.');
  });

  it('keeps MCQ option and sub-part labels', () => {
    expect(toSpeechText('A. 6 cm\nB. 10 cm\n(a) first part')).toBe('A. 6 cm.\nB. 10 cm.\n(a) first part.');
  });

  it('removes bold, italics, underscore emphasis and inline code', () => {
    expect(toSpeechText('This is **very** *important* and __key__ and _also_ `x`.')).toBe(
      'This is very important and key and also x.'
    );
  });

  it('does not strip underscores inside identifiers', () => {
    expect(toSpeechText('use my_var_name here')).toBe('use my_var_name here');
  });

  it('turns " * " between operands into "times" rather than deleting it', () => {
    expect(toSpeechText('Compute 2 * 3')).toBe('Compute 2 times 3');
  });

  it('drops horizontal rules and code fences but keeps fenced content', () => {
    expect(toSpeechText('Before\n---\n```\nlet x\n```\nAfter')).toBe('Before\n\nlet x\n\nAfter');
  });

  it('unwraps blockquotes', () => {
    expect(toSpeechText('> Remember this')).toBe('Remember this');
  });

  it('strips HTML-like tags', () => {
    expect(toSpeechText('Hello<br>world <b>now</b>')).toBe('Hello world now');
  });

  it('collapses runs of blank lines and trims', () => {
    expect(toSpeechText('\n\nA\n\n\n\n\nB\n\n')).toBe('A\n\nB');
  });

  it('normalizes CRLF line endings', () => {
    expect(toSpeechText('# Title\r\nBody')).toBe('Title.\nBody');
  });

  it('returns an empty string for empty or markup-only input', () => {
    expect(toSpeechText('')).toBe('');
    expect(toSpeechText('   \n\n  ')).toBe('');
    expect(toSpeechText('---\n**\n>\n')).toBe('');
  });
});

describe('toSpeechText: links and URLs', () => {
  it('keeps a link label and drops the URL', () => {
    expect(toSpeechText('See [the NCERT page](https://ncert.nic.in/book.html) today.')).toBe('See the NCERT page today.');
  });

  it('keeps image alt text only', () => {
    expect(toSpeechText('![A triangle](https://x.in/t.png)')).toBe('A triangle');
  });

  it('keeps a danda that follows a URL, with or without a space', () => {
    expect(toSpeechText('देखें https://diksha.gov.in/।')).toBe('देखें link।');
    expect(toSpeechText('देखें https://diksha.gov.in/ और')).toBe('देखें link और');
  });

  it('replaces a bare URL with the word link and keeps the sentence stop', () => {
    expect(toSpeechText('Visit https://example.com/a?b=1.')).toBe('Visit link.');
    expect(toSpeechText('Visit www.example.com now')).toBe('Visit link now');
  });
});

describe('toSpeechText: tables', () => {
  const table = [
    '| Teacher Activity | Student Activity |',
    '|---|---|',
    '| Shows a chart | Observes |',
    '| Asks questions | Answers |',
    '',
    'Next paragraph.',
  ].join('\n');

  it('reads each row as "Header: value" pairs with no pipes or separators', () => {
    expect(toSpeechText(table)).toBe(
      'Teacher Activity: Shows a chart, Student Activity: Observes.\nTeacher Activity: Asks questions, Student Activity: Answers.\n\nNext paragraph.'
    );
  });

  it('handles a table that ends the text without a trailing newline', () => {
    const out = toSpeechText('| A | B |\n|:--|--:|\n| 1 | 2 |');
    expect(out).toBe('A: 1, B: 2.');
  });

  it('keeps an escaped \\| inside its cell but reads it as a pause, never as a literal pipe', () => {
    const out = toSpeechText('| Op |\n|---|\n| a \\| b |');
    expect(out).toBe('Op: a, b.');
    expect(out).not.toContain('|');
  });

  // The lesson plan renderer (server/src/lib/lessonPlanPrompt.js) always heads its step column "#".
  it('reads the lesson-plan "#" column as a step number, not "#: 1"', () => {
    const out = toSpeechText('| # | Teacher Activity | Student Activity |\n|---|---|---|\n| 1 | Cut the roti | Name the parts |');
    expect(out).toBe('Step 1, Teacher Activity: Cut the roti, Student Activity: Name the parts.');
  });

  it('drops the label of a header that has no letters or digits', () => {
    expect(toSpeechText('| — | Note |\n|---|---|\n| x | y |')).toBe('x, Note: y.');
  });

  it('handles the Hindi lesson-plan table with an escaped pipe in a cell', () => {
    const out = toSpeechText('| # | Teacher Activity | Student Activity |\n|---|---|---|\n| 1 | रोटी काटें | चर्चा करें \\| उत्तर बताएँ |');
    expect(out).toBe('Step 1, Teacher Activity: रोटी काटें, Student Activity: चर्चा करें, उत्तर बताएँ.');
  });

  it('keeps Hindi headers and cells intact', () => {
    expect(toSpeechText('| शिक्षक | छात्र |\n|---|---|\n| दिखाता है | देखते हैं |')).toBe(
      'शिक्षक: दिखाता है, छात्र: देखते हैं.'
    );
  });

  it('reads a non-strict pipe row as a comma list and drops its separator', () => {
    expect(toSpeechText('| a | b |\n|---|---|')).toBe('a, b.');
  });
});

describe('toSpeechText: math', () => {
  it('speaks a numeric mixed number with "and"', () => {
    expect(toSpeechText('Add (or $1\\frac{1}{4}$) now.')).toBe('Add (or 1 and 1 by 4) now.');
    expect(toSpeechText('$12\\dfrac{3}{8}$')).toBe('12 and 3 by 8');
  });

  it('does not treat a whole number before a symbolic fraction as a mixed number', () => {
    expect(toSpeechText('$2\\frac{x}{y}$')).toBe('2 x by y');
  });

  it('speaks fractions, roots and powers', () => {
    expect(toSpeechText('Find $\\frac{3}{4}$.')).toBe('Find 3 by 4.');
    expect(toSpeechText('Then $x^2$ and $y^3$.')).toBe('Then x squared and y cubed.');
    expect(toSpeechText('Use $\\sqrt{16}$.')).toBe('Use square root of 16.');
  });

  it('speaks operators and relations', () => {
    expect(toSpeechText('$2 \\times 3 = 6$')).toBe('2 times 3 equals 6');
    expect(toSpeechText('$a \\le b$')).toBe('a less than or equal to b');
    expect(toSpeechText('$x + 1 - 2$')).toBe('x plus 1 minus 2');
  });

  it('speaks degrees and percent', () => {
    expect(toSpeechText('The angle is $90^\\circ$.')).toBe('The angle is 90 degrees.');
    expect(toSpeechText('Gain $20\\%$.')).toBe('Gain 20 percent.');
  });

  it('resolves a fraction nested in a root', () => {
    expect(toSpeechText('$\\sqrt{\\frac{1}{4}}$')).toBe('square root of 1 by 4');
  });

  it('reads display math too', () => {
    expect(toSpeechText('Area:\n$$A = \\pi r^2$$\nDone.')).toBe('Area:\nA equals pi r squared\nDone.');
  });

  it('keeps letters and digits from unknown commands but drops the backslash', () => {
    const out = toSpeechText('$\\foo{bar} + 1$');
    expect(out).toBe('bar plus 1');
    expect(out).not.toMatch(/[\\${}]/);
  });

  it('says nothing for a symbol-only segment', () => {
    expect(toSpeechText('Before $\\,\\!$ after')).toBe('Before after');
  });

  it('leaves leftover LaTeX out of the output', () => {
    const out = toSpeechText('$\\left( \\frac{a}{b} \\right)^{n+1}$');
    expect(out).not.toMatch(/[\\^{}$]/);
    expect(out).toContain('a by b');
  });
});

describe('toSpeechText: currency and standalone dollar', () => {
  it('does not pair two prices into a math segment', () => {
    expect(toSpeechText('It costs $5 and $10 each.')).toBe('It costs $5 and $10 each.');
  });

  it('leaves a lone dollar sign alone', () => {
    expect(toSpeechText('Pay $5 today.')).toBe('Pay $5 today.');
  });

  it('preserves the rupee sign', () => {
    expect(toSpeechText('कीमत ₹500 है')).toBe('कीमत ₹500 है');
  });

  it('still reads real math that sits beside a price', () => {
    expect(toSpeechText('Cost $5, where $x^2$ grows.')).toBe('Cost $5, where x squared grows.');
  });
});

describe('toSpeechText: Hindi, Devanagari digits and Hinglish', () => {
  it('leaves Hindi text with the danda byte-identical', () => {
    const hindi = 'यह एक वाक्य है। दूसरा वाक्य है॥';
    expect(toSpeechText(hindi)).toBe(hindi);
  });

  it('preserves Devanagari digits', () => {
    expect(toSpeechText('कक्षा १२ में ३५ छात्र हैं')).toBe('कक्षा १२ में ३५ छात्र हैं');
  });

  it('does not add a period after a heading that already ends in a danda', () => {
    expect(toSpeechText('## परिचय।')).toBe('परिचय।');
  });

  it('keeps Hinglish untouched apart from markup', () => {
    expect(toSpeechText('**Aaj** ka topic hai fractions. Bachon ko samjhao.')).toBe(
      'Aaj ka topic hai fractions. Bachon ko samjhao.'
    );
  });

  it('keeps Indic joiners inside words (ZWJ/ZWNJ) but drops stranded ones', () => {
    const word = 'क्\u200Dष';
    expect(toSpeechText(`${word} \u200D x`)).toBe(`${word} x`);
  });

  it('keeps other Indian scripts', () => {
    expect(toSpeechText('**தமிழ்** மொழி')).toBe('தமிழ் மொழி');
  });

  it('keeps a Hindi list and bold together', () => {
    expect(toSpeechText('• **पहला** बिंदु\n• दूसरा बिंदु')).toBe('पहला बिंदु.\nदूसरा बिंदु.');
  });
});

describe('toSpeechText: symbols', () => {
  it('removes emoji without touching surrounding text', () => {
    expect(toSpeechText('Great job 🎉 class! 📚')).toBe('Great job class!');
  });

  it('keeps digits when a keycap emoji wraps them', () => {
    expect(toSpeechText('1\uFE0F\u20E3 First')).toBe('1 First');
  });

  it('keeps ordinary punctuation', () => {
    expect(toSpeechText('Why, then? Because (reasons): yes; "quoted" — fine.')).toBe(
      'Why, then? Because (reasons): yes; "quoted" — fine.'
    );
  });
});
