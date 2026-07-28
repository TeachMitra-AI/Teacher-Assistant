import { describe, expect, it } from 'vitest';
import { GATE_MAX_TOKENS, GATE_PROXIMITY_TOKENS, isCommand, normalizeUtterance } from './intentGate';

// The gate's acceptance criterion is PRECISION, not recall (amendment CHANGE-2),
// so this file is deliberately lopsided: the negative table is the one that
// matters. A false positive costs a coaching question the full classifier budget
// on top of its own answer, on the app's busiest path. A false negative costs
// one manual navigation — today's experience.
//
// The negatives are therefore written as the app's REAL traffic: coaching
// questions, classroom descriptions, and the follow-up phrasings that already
// exist in config.ts. Anything ambiguous belongs in the negative table.
//
// The recall gap this leaves is real and is NOT fixed here. M7's labelled corpus
// measures it; widening the vocabulary on the strength of one remembered
// phrasing is how thresholds stop being evidence-based.

const REFERRED = [
  // ---- English: produce something ----
  'Generate a Class 5 fractions worksheet',
  'Create a Science paper for Class 8',
  'Make a quiz on photosynthesis',
  'make a worksheet',
  'Build a test for class 7 maths',
  'Prepare an assessment on decimals',
  'Draft a quiz about the water cycle',
  'Design a worksheet for grade 3',
  'Generate mcqs on the solar system',
  'Make an exam paper for class 10',
  'Create a printable worksheet with an answer key',
  'give me 10 questions on algebra',
  'Give me a quiz on fractions',
  'Start a quiz for class 4',
  'Set a test for class 5',
  'make a short class 5 maths quiz',
  'generate two worksheets on shapes',
  'prepare an assessment for the chapter on light',
  // ---- English: navigate ----
  'Open the generator',
  'open the worksheet generator',
  'Show me the quiz generator',
  'launch the generator',
  'open the quiz maker',
  // ---- Hinglish ----
  'Class 3 ke liye maths quiz banao',
  'Worksheet generator kholo',
  'class 5 ka worksheet bana do',
  'mujhe class 5 ke liye quiz chahiye',
  'ek test banaiye class 6 ke liye',
  'prashn patra banao',
  'sawaal banao fractions par',
  'quiz bnao class 4 ke liye',
  'class 8 science ka paper taiyar karo',
  'worksheet dikhao',
  'pariksha ke liye prashn banaiye',
  'maths ka test banado',
  // ---- Hindi (Devanagari) ----
  'कक्षा 5 के लिए गणित की क्विज़ बनाओ',
  'गणित का पेपर बनाओ',
  'वर्कशीट बनाइए',
  'विज्ञान के प्रश्न बनाओ',
  'कक्षा 6 के लिए परीक्षा तैयार करो',
  'प्रश्नपत्र दिखाइए',
];

const NOT_REFERRED = [
  // ---- Coaching questions: the traffic this gate exists to protect ----
  'how do I manage a noisy class?',
  'How do I make a worksheet?',
  'how do I make a worksheet',
  'What worksheet should I make',
  'Can you make a quiz?',
  'should I give a test this week',
  'why are my students not doing the worksheet',
  'when should I set a test',
  'which questions work best for revision',
  'is a quiz better than a worksheet',
  'What is the best way to teach fractions',
  'How can I explain photosynthesis simply',
  'Explain this concept simply: photosynthesis',
  'Suggest a classroom activity for fractions',
  'Create a lesson plan for class 5',
  'Create an activity about the water cycle',
  'I need help with classroom management',
  'my students are not engaged in maths class',
  'my students take a test tomorrow',
  'the test results were poor this term',
  'give me some ideas for teaching fractions',
  'do my students need a test',
  'does a quiz help with revision',
  'a student is unconscious',
  'one of my students is being bullied',
  'How do I handle a large class of 45 students',
  // ---- Follow-up chip phrasings (these reach submitTurn directly today, but
  //      must not become routable if that ever changes) ----
  'Make it simpler',
  'Explain this more simply, in easy words.',
  'Suggest a quick 5-minute classroom activity for this.',
  // ---- Hinglish / Hindi questions ----
  'Kya main quiz bana sakta hoon',
  'kaise ek worksheet banaye',
  'kyun mere students test me fail hote hain',
  'kitne questions rakhne chahiye',
  'क्या मैं क्विज़ बना सकता हूँ',
  'कैसे वर्कशीट बनाऊँ',
  'क्यों बच्चे परीक्षा में कमजोर हैं',
  // ---- Verb with no domain noun ----
  'Create a lesson plan for ',
  'make a seating chart',
  'open the settings page',
  'show me my library',
  'generate some ideas for a school assembly',
  // ---- Domain noun with no verb ----
  'worksheet for class 5',
  'the quiz was too hard',
  'fractions',
  'class 5 maths',
  // ---- Verb and noun too far apart ----
  'make sure the students have finished their homework before the test',
  'show the class how to solve this and then let them try the paper next week',
];

describe('isCommand — referred to the classifier', () => {
  it.each(REFERRED)('refers %j', (utterance) => {
    expect(isCommand(utterance)).toBe(true);
  });
});

describe('isCommand — kept on the coach path (precision)', () => {
  it.each(NOT_REFERRED)('does not refer %j', (utterance) => {
    expect(isCommand(utterance)).toBe(false);
  });
});

describe('isCommand — structural rules', () => {
  it('rejects empty and whitespace-only input', () => {
    expect(isCommand('')).toBe(false);
    expect(isCommand('   ')).toBe(false);
    expect(isCommand('​​')).toBe(false);
  });

  it('rejects a non-string without throwing', () => {
    expect(isCommand(undefined as unknown as string)).toBe(false);
    expect(isCommand(null as unknown as string)).toBe(false);
    expect(isCommand(42 as unknown as string)).toBe(false);
  });

  it('rejects an utterance the server would answer with a 400', () => {
    // Envelope validation caps the utterance at MAX_UTTERANCE_LENGTH, so
    // referring a longer one is a guaranteed wasted round trip.
    const tooLong = `make a quiz on ${'fractions '.repeat(80)}`;
    expect(tooLong.length).toBeGreaterThan(500);
    expect(isCommand(tooLong)).toBe(false);
  });

  it('rejects prose beyond the token ceiling even when it contains both signals', () => {
    const filler = Array.from({ length: GATE_MAX_TOKENS }, (_, i) => `word${i}`).join(' ');
    expect(isCommand(`make a quiz ${filler}`)).toBe(false);
  });

  it('honours the proximity window in both directions', () => {
    const gap = (distance: number) => 'x '.repeat(distance).trim();
    expect(isCommand(`make ${gap(GATE_PROXIMITY_TOKENS - 1)} quiz`)).toBe(true);
    expect(isCommand(`quiz ${gap(GATE_PROXIMITY_TOKENS - 1)} banao`)).toBe(true);
    expect(isCommand(`make ${gap(GATE_PROXIMITY_TOKENS)} quiz`)).toBe(false);
  });

  it('treats a question mark as disqualifying whatever else is present', () => {
    expect(isCommand('make a quiz on fractions')).toBe(true);
    expect(isCommand('make a quiz on fractions?')).toBe(false);
  });

  it('matches vocabulary as whole tokens, never as substrings', () => {
    // "generate" contains "gene"; "protest" contains "test". Neither may fire.
    expect(isCommand('the gene protest was on the news')).toBe(false);
    expect(isCommand('degenerate contested results')).toBe(false);
  });
});

describe('normalizeUtterance', () => {
  it('lowercases, collapses whitespace and trims', () => {
    expect(normalizeUtterance('  Make   A  QUIZ  ')).toBe('make a quiz');
  });

  it('is stable across the spellings that must share a cache entry', () => {
    expect(normalizeUtterance('Make a Quiz')).toBe(normalizeUtterance('make a quiz'));
    expect(normalizeUtterance('make  a\tquiz')).toBe(normalizeUtterance('make a quiz'));
  });

  it('applies NFKC so compatibility forms do not fork the cache', () => {
    // Fullwidth Latin normalizes to ASCII under NFKC.
    expect(normalizeUtterance('ｍａｋｅ ａ ｑｕｉｚ')).toBe('make a quiz');
  });

  it('returns empty for a non-string rather than throwing', () => {
    expect(normalizeUtterance(undefined as unknown as string)).toBe('');
  });
});
