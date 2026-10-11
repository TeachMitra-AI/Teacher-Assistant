import { describe, expect, it } from 'vitest';
import { toSpeechText } from './speechText';
import { chunkSpeechText } from './tts';

// The path ResponseCard takes: Markdown -> toSpeechText -> chunkSpeechText -> one utterance per chunk. The pieces are
// tested alone elsewhere; this checks they work together on a long, realistic response, which is where a numbered
// list or quiz question can end up split from its number.
const noSpace = (s: string) => s.replace(/\s+/g, '');
// A label alone on the last line ("4."), an option letter ending the chunk ("... B."), or a trailing "(a)". A number that merely
// ends a sentence ("... 3 by 16.") is not a label.
const DETACHED_LABEL = /(?:^|\n)(?:\d{1,3}|[०-९]{1,3}|[A-D])\.$|\s[A-D]\.$|\([a-d]\)$/;

const OBJECTIVES = [
  String.raw`विद्यार्थी भिन्न $\frac{1}{2}$ और $\frac{3}{4}$ की तुलना कर सकेंगे।`,
  'विद्यार्थी भिन्नों को चित्र और संख्या रेखा पर दिखा सकेंगे।',
  'विद्यार्थी रोज़मर्रा की चीज़ों में बराबर भाग पहचान सकेंगे, जैसे रोटी, कागज़ और फल।',
  'विद्यार्थी समान हर वाली भिन्नों को जोड़ और घटा सकेंगे।',
  'Students will explain, in their own words, why a larger denominator gives a smaller piece.',
  'Bachon ko roti ka example dekar fractions samjhana, phir paper fold karwana.',
  'विद्यार्थी अपने उत्तर का कारण बता सकेंगे और साथी की मदद कर सकेंगे।',
  'Students will solve three word problems using halves, quarters and thirds.',
];

const STEPS = [
  ['रोटी को बीच से काटकर दिखाएँ और बोर्ड पर लिखें।', 'हर भाग को नाम दें और कॉपी में चित्र बनाएँ।'],
  [String.raw`बोर्ड पर $\frac{1}{4} < \frac{1}{2}$ लिखें और कारण पूछें।`, 'जोड़ी में चर्चा करें और उत्तर बताएँ।'],
  ['Hand out paper strips and ask each pair to fold one into four equal parts.', 'Fold the strip, shade one part, and write the fraction.'],
  ['Aaj ka topic fractions hai. Bachon se poochho: kitne hisse bane, aur har hissa kitna bada hai?', 'Bachche apni copy mein likhte hain aur saathi ko dikhate hain।'],
  [String.raw`Ask: what is $\sqrt{16} + 2^2$? Then link it to the day's lesson.`, 'Answer aloud together, then check with a neighbour.'],
  ['See [the NCERT guide](https://ncert.nic.in/guide) or https://diksha.gov.in/ for more practice.', 'A notebook costs $5 and a pen costs $10, so ask what they pay for both.'],
];

const QUESTIONS = [
  String.raw`What is $\frac{3}{4} + \frac{1}{4}$?` + '\nA. $1$\nB. $\\frac{4}{8}$\nC. $\\frac{3}{16}$\nD. $2$',
  'कौन सी भिन्न सबसे बड़ी है?\nA. आधा\nB. चौथाई\nC. तिहाई\nD. पाँचवाँ भाग',
  'Which fraction is equal to one half?\nA. 2/4\nB. 1/3\nC. 3/4\nD. 1/5',
  'Aaj class mein kitne bachche aaye? (a) gino (b) likho',
  String.raw`If $r = 7$ cm, what is $\pi r^2$?` + '\nA. 154 cm²\nB. 44 cm²\nC. 22 cm²\nD. 14 cm²',
  'कक्षा १२ में ३५ छात्र हैं। सबसे अधिक अंक किसके हैं?\nA. रवि\nB. सीता\nC. मोहन\nD. गीता',
];

const FIXTURE = [
  '# Lesson Plan: भिन्न (Fractions)',
  '',
  '**Class:** Class 5 · **Subject:** Mathematics · **Duration:** 40 minutes',
  '',
  '## Learning Objectives',
  '',
  ...OBJECTIVES.map((o, i) => `${i + 1}. ${o}`),
  '',
  '## Presentation',
  '',
  '| # | Teacher Activity | Student Activity |',
  '|---|---|---|',
  ...STEPS.map(([t, s], i) => `| ${i + 1} | ${t} | ${s} |`),
  '',
  '## Quiz',
  '',
  ...QUESTIONS.map((q, i) => `${i + 1}. ${q}`),
].join('\n');

describe('read-aloud pipeline: toSpeechText then chunkSpeechText on a long lesson plan and quiz', () => {
  const cleaned = toSpeechText(FIXTURE);
  const chunks = chunkSpeechText(cleaned);

  it('produces many chunks, each close to the 200-character target', () => {
    expect(chunks.length).toBeGreaterThanOrEqual(6);
    // A bare label may ride along with its item, so a chunk can exceed the target by a few characters.
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(206);
    expect(chunks.every((c) => c === c.trim() && c.length > 0)).toBe(true);
  });

  it('keeps all the cleaned text, in order, with nothing duplicated', () => {
    expect(noSpace(chunks.join(''))).toBe(noSpace(cleaned));
  });

  it('keeps the sections in their original order', () => {
    const joined = chunks.join('\n');
    const markers = ['Lesson Plan:', 'Learning Objectives.', 'Step 1,', 'Step 3,', 'Step 6,', 'Quiz.', 'सबसे बड़ी'];
    const positions = markers.map((m) => joined.indexOf(m));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('never ends a chunk on a detached number or option letter', () => {
    for (const chunk of chunks) expect(chunk, JSON.stringify(chunk)).not.toMatch(DETACHED_LABEL);
  });

  it('keeps every quiz question number and option letter with its text', () => {
    const joined = chunks.join('\n');
    for (let n = 1; n <= QUESTIONS.length; n++) {
      expect(joined).toMatch(new RegExp(`(^|\\n)${n}\\. \\S`));
    }
    // Each chunk that begins in the quiz opens on a label or a sentence, never on a lone fragment of an option.
    for (const chunk of chunks) expect(chunk).not.toMatch(/^[A-D]\.\s*$/);
  });

  it('turns the table into step sentences and drops Markdown, pipes and LaTeX', () => {
    const joined = chunks.join('\n');
    expect(joined).toContain('Step 1, Teacher Activity:');
    expect(joined).toContain('Student Activity:');
    expect(joined).not.toMatch(/[*#|\\]/);
    expect(joined).not.toContain('$\\');
    expect(joined).toContain('1 by 2');
    expect(joined).toContain('square root of 16');
  });

  it('keeps Hindi, Devanagari digits, the danda and Hinglish intact', () => {
    const joined = chunks.join('\n');
    expect(joined).toContain('कक्षा १२ में ३५ छात्र हैं।');
    expect(joined).toContain('रोटी को बीच से काटकर दिखाएँ');
    expect(joined).toContain('Aaj ka topic fractions hai.');
    expect(joined).toContain('saathi ko dikhate hain।');
  });

  it('keeps the ordinary prices and reads links as labels', () => {
    const joined = chunks.join('\n');
    expect(joined).toContain('A notebook costs $5 and a pen costs $10');
    expect(joined).toContain('See the NCERT guide or link for more practice.');
    expect(joined).not.toContain('ncert.nic.in');
  });

  it('keeps a short response as a single chunk', () => {
    const short = toSpeechText('## Tip\n1. Cut the roti\n2. Name the parts');
    expect(chunkSpeechText(short)).toEqual([short]);
  });

  it('stays lossless and label-safe at smaller limits too', () => {
    for (const max of [60, 120]) {
      const small = chunkSpeechText(cleaned, max);
      expect(noSpace(small.join(''))).toBe(noSpace(cleaned));
      for (const chunk of small) expect(chunk, JSON.stringify(chunk)).not.toMatch(DETACHED_LABEL);
    }
  });
});
