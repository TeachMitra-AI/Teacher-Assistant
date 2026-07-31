// Deterministic vocabulary recovery (Alternative A).
//
// The balance of this file is deliberate: there are more NEGATIVE cases than
// positive ones, because the whole risk of this stage sits on one side. A missed
// recovery leaves today's behaviour — a blank field the teacher fills in. A false
// recovery prefills a confident WRONG class or subject that a teacher may not
// notice until the worksheet is printed, and it arrives wearing the same badge a
// correct one would.
//
// The negative table is also the reason the module exists in this shape at all:
// handing the whole utterance to `mapGrade` (the obvious implementation) maps
// "I have 5 students" to Class 3-5, and `mapSubject` maps "Math teacher" to
// Mathematics. Those two lines are pinned below so nobody re-simplifies the
// module back into the bug.

const { generateAssessment } = require('../../src/actions/descriptors/generateAssessment');
const { openGenerator } = require('../../src/actions/descriptors/openGenerator');
const { mapGrade } = require('../../src/actions/vocab/grades');
const { mapSubject } = require('../../src/actions/vocab/subjects');
const {
  RECOVERABLE_SLOTS,
  recoverSlots,
} = require('../../src/assistant/slotRecovery');

/** The realistic call: the one action that declares grade and subject. */
const recover = (utterance, alreadyFilled = []) =>
  recoverSlots({ descriptor: generateAssessment, utterance, alreadyFilled });

describe('grade — positive, across the scripts teachers actually type', () => {
  const cases = [
    // English
    ['Class 5', 'Class 3-5'],
    ['class 5', 'Class 3-5'],
    ['Grade 6', 'Class 6-8'],
    ['grade 2 worksheet', 'Class 1-2'],
    ['5th class', 'Class 3-5'],
    ['class five', 'Class 3-5'],
    ['Standard VII', 'Class 6-8'],
    ['Std VIII', 'Class 6-8'],
    ['std 10 quiz', 'Class 9-10'],
    // The number sits two tokens from the keyword — the proximity boundary.
    ['I have 40 students in class 5', 'Class 3-5'],
    // Hindi (Devanagari), including Devanagari digits
    ['कक्षा 5', 'Class 3-5'],
    ['कक्षा ५', 'Class 3-5'],
    ['पाँचवीं कक्षा', 'Class 3-5'],
    ['आठवीं कक्षा के लिए', 'Class 6-8'],
    // Hinglish
    ['class 5 ke liye worksheet banao', 'Class 3-5'],
    ['kaksha 6 ka paper', 'Class 6-8'],
    ['panchvi class', 'Class 3-5'],
    // Realistic full utterances
    ['Generate a Class 5 Mathematics worksheet on Fractions', 'Class 3-5'],
    ['Create a Science paper for Class 8', 'Class 6-8'],
  ];

  test.each(cases)('%s -> %s', (utterance, expected) => {
    expect(recover(utterance).recovered.grade).toBe(expected);
  });
});

describe('grade — NEGATIVE: a number is only a class when the sentence says so', () => {
  // Every one of these contains a number and no class word. The class-keyword
  // anchor is the entire false-positive control, and this is its test.
  const cases = [
    'I have 5 students',
    'Five questions',
    'Chapter 5',
    '5 marks',
    'Roll No. 5',
    'Section 5',
    '5 days',
    '5 lessons',
    '10 questions on fractions',
    'page 7 of the textbook',
    'a 5 minute activity',
    'worksheet with 12 questions',
  ];

  test.each(cases)('%s recovers no grade', (utterance) => {
    expect(recover(utterance).recovered.grade).toBeUndefined();
  });

  test('the whole-utterance shortcut this module exists to avoid IS broken', () => {
    // Not testing our code — testing the premise. If these ever stop mapping,
    // the span machinery could be simplified, and this test is how anyone would
    // find that out rather than assuming it.
    expect(mapGrade('I have 5 students').value).toBe('Class 3-5');
    expect(mapGrade('Chapter 5').value).toBe('Class 3-5');
    expect(mapSubject('Math teacher').value).toBe('Mathematics');
  });

  test('a number outside 1-12 is not a class even with the keyword', () => {
    expect(recover('class of 40 students').recovered.grade).toBeUndefined();
  });

  test('a bare roman numeral is not read as a class', () => {
    // "I" is a valid numeral and the commonest English word. grades.js gates
    // this already; the span must not hand it a context that ungates it.
    expect(recover('I want a worksheet').recovered.grade).toBeUndefined();
  });
});

describe('subject — positive', () => {
  const cases = [
    ['Maths', 'Mathematics'],
    ['Mathematics', 'Mathematics'],
    ['maths worksheet', 'Mathematics'],
    ['Science', 'Science'],
    ['English', 'English'],
    ['Hindi', 'Hindi'],
    ['विज्ञान', 'Science'],
    ['गणित का worksheet', 'Mathematics'],
    ['ganit ka paper', 'Mathematics'],
    ['social studies worksheet', 'Social Studies'],
    ['environmental studies quiz', 'Science'],
    // The phrasing a role-noun set that included "class" would have broken.
    ['science for class 5', 'Science'],
  ];

  test.each(cases)('%s -> %s', (utterance, expected) => {
    expect(recover(utterance).recovered.subject).toBe(expected);
  });
});

describe('subject — NEGATIVE: the word names a person, not the worksheet', () => {
  const cases = [
    'Math teacher',
    'Science teacher',
    'English teacher',
    'Maths faculty',
    'Science department',
    'I am a maths teacher',
    // The mention matches on "social" alone, so the giveaway sits two tokens
    // out — the case that sets ROLE_LOOKAHEAD.
    'social studies teacher',
  ];

  test.each(cases)('%s recovers no subject', (utterance) => {
    expect(recover(utterance).recovered.subject).toBeUndefined();
  });

  test('a refusal is reported as rejected, not as skipped', () => {
    // The distinction is the false-positive gate's only visible evidence.
    const result = recover('Math teacher');
    expect(result.rejected).toContain('subject');
    expect(result.skipped).not.toContain('subject');
  });
});

describe('subject — NEGATIVE: governed by a preposition, so it names something else', () => {
  // ALL FIVE OF THESE ARE REAL CORPUS CASES. They were found by the replay gate
  // after the role-noun guard was already in place, and together they were the
  // whole of this change's hallucination regression (subject 0/58 -> 5/58).
  // They are pinned verbatim so the guard cannot be quietly narrowed later.

  test.each([
    // The output LANGUAGE, not the subject — English word order.
    ['cmd.en.029', 'Generate a worksheet on verbs for class 4 and write it in Hindi'],
    ['mem.008#1', 'Make a worksheet on nouns for class 3 and write it in Hindi'],
    // …and the Hindi/Hinglish postposition, which sits AFTER the word.
    ['cmd.hi.010', 'कक्षा 3 के लिए वर्कशीट बनाओ और हिंदी में लिखो'],
    ['cmd.hin.015', 'Decimals par worksheet banao aur hindi mein likho'],
    // The TOPIC, not the subject: subjects.js maps "algebra" to Mathematics, so
    // without the guard this recovers a subject INFERRED FROM THE TOPIC — which
    // this stage is explicitly forbidden to do.
    ['cmd.hin.020', 'Ek hard worksheet banao algebra par class 10 ke liye'],
  ])('%s recovers no subject', (_id, utterance) => {
    expect(recover(utterance).recovered.subject).toBeUndefined();
  });

  test('the grade in those same utterances is still recovered', () => {
    // The guard must be surgical: it demotes the subject and nothing else.
    expect(recover('Make a worksheet on nouns for class 3 and write it in Hindi').recovered.grade)
      .toBe('Class 3-5');
    expect(recover('Ek hard worksheet banao algebra par class 10 ke liye').recovered.grade)
      .toBe('Class 9-10');
  });

  test('a span may never BEGIN on a governing word', () => {
    // `mapSubject('in hindi')` maps, because the mapper ignores tokens it does
    // not recognise. A pair probe starting at "in" therefore swallowed the
    // preposition and the guard looked for it past the span. This is that bug.
    expect(recover('write it in Hindi').recovered.subject).toBeUndefined();
    expect(recover('likho hindi mein').recovered.subject).toBeUndefined();
  });

  test('"for" does NOT demote — it introduces the subject, not another role', () => {
    // The counterweight. Demoting on "for" would trade a rare false positive
    // for a very common false negative.
    expect(recover('a worksheet for maths').recovered.subject).toBe('Mathematics');
    expect(recover('science for class 5').recovered.subject).toBe('Science');
  });
});

describe('never overwrite the model (rule R2)', () => {
  test('a slot the model filled is not touched, even when the utterance says otherwise', () => {
    const result = recover('Class 5 Mathematics worksheet', ['grade', 'subject']);
    expect(result.recovered).toEqual({});
  });

  test('only the unfilled half is recovered', () => {
    const result = recover('Class 5 Mathematics worksheet', ['grade']);
    expect(result.recovered).toEqual({ subject: 'Mathematics' });
  });
});

describe('ambiguity is refused, never voted on', () => {
  test('two distinct bands in one window recover nothing', () => {
    const result = recover('chapter 8 for class 3');
    expect(result.recovered.grade).toBeUndefined();
    expect(result.ambiguous).toContain('grade');
  });

  test('stated alternatives recover nothing', () => {
    const result = recover('class 3 or class 8');
    expect(result.recovered.grade).toBeUndefined();
    expect(result.ambiguous).toContain('grade');
  });

  test('two distinct subjects recover nothing', () => {
    const result = recover('maths and science for class 5');
    expect(result.recovered.subject).toBeUndefined();
    expect(result.ambiguous).toContain('subject');
  });

  test('two spans agreeing on one value DO recover it', () => {
    // "class 5" and "5th standard" are one reading stated twice, not two.
    expect(recover('class 5 worksheet for 5th standard').recovered.grade).toBe('Class 3-5');
  });
});

describe('scope — only grade and subject, ever', () => {
  test('the supported set is exactly grade and subject', () => {
    expect([...RECOVERABLE_SLOTS].sort()).toEqual(['grade', 'subject']);
  });

  test('never fills topic, format, difficulty, questionType, questionCount or language', () => {
    // `topic` is free text with no vocabulary to validate against; `language`
    // must come only from an explicit request (descriptor comment); the rest the
    // model already extracts well. A recovered value in any of them is scope
    // creep that this assertion is here to stop.
    // Deliberately dense: a difficulty, a question type, a topic, a count and a
    // format all sit in this sentence alongside the two recoverable slots.
    // Note the subject is written WITHOUT a governing preposition — "in Hindi"
    // would be the output language, which is a different test above.
    const result = recover(
      'make an easy mcq maths worksheet on fractions with 10 questions for class 5'
    );
    expect(Object.keys(result.recovered).sort()).toEqual(['grade', 'subject']);
    expect(result.recovered).toEqual({ grade: 'Class 3-5', subject: 'Mathematics' });
  });

  test('an action that declares no such slots recovers nothing', () => {
    const result = recoverSlots({
      descriptor: openGenerator,
      utterance: 'open the generator for class 5 maths',
      alreadyFilled: [],
    });
    expect(result.recovered).toEqual({});
  });
});

describe('the length cap that whole-utterance scanning would have hit', () => {
  test('recovers from an utterance well past the mappers’ 120-character bound', () => {
    // shared.js#normalize returns '' above MAX_RAW_LENGTH, so a whole-utterance
    // implementation degrades silently on exactly the long, detailed requests
    // most worth routing. Spans are a few tokens, so the cap is out of reach.
    const long =
      'Please could you generate a printable worksheet for class 5 mathematics ' +
      'on the topic of equivalent fractions, with an answer key for my students';
    expect(long.length).toBeGreaterThan(120);
    expect(recover(long).recovered).toEqual({ grade: 'Class 3-5', subject: 'Mathematics' });
  });
});

describe('outcome reporting', () => {
  test('nothing to consider is skipped, not rejected', () => {
    const result = recover('I want a worksheet');
    expect(result.skipped.sort()).toEqual(['grade', 'subject']);
    expect(result.rejected).toEqual([]);
  });

  test('a number with no class word is rejected, not skipped', () => {
    const result = recover('I have 5 students');
    expect(result.rejected).toContain('grade');
    expect(result.skipped).not.toContain('grade');
  });

  test('every outcome list holds slot NAMES only, never values (G11)', () => {
    const result = recover('Math teacher with 5 students');
    for (const list of [result.skipped, result.rejected, result.ambiguous]) {
      for (const entry of list) expect(RECOVERABLE_SLOTS).toContain(entry);
    }
  });
});

describe('never throws — a defect here costs a recovery and nothing else (G22)', () => {
  const hostile = [
    undefined,
    null,
    '',
    '   ',
    42,
    ['an', 'array'],
    { an: 'object' },
    'x'.repeat(5000),
    '   ',
    'class '.repeat(500),
    '🎓'.repeat(200),
  ];

  test.each(hostile.map((h) => [JSON.stringify(h) ?? String(h), h]))(
    'survives %s',
    (_label, utterance) => {
      expect(() => recover(utterance)).not.toThrow();
      expect(recover(utterance).recovered).toBeInstanceOf(Object);
    }
  );

  test('survives a malformed descriptor', () => {
    for (const descriptor of [undefined, null, {}, { slots: 'not an array' }]) {
      expect(() => recoverSlots({ descriptor, utterance: 'class 5' })).not.toThrow();
      expect(recoverSlots({ descriptor, utterance: 'class 5' }).recovered).toEqual({});
    }
  });

  test('is pure — the same input twice gives the same answer, and nothing is mutated', () => {
    const alreadyFilled = ['subject'];
    const first = recover('class 5 maths', alreadyFilled);
    const second = recover('class 5 maths', alreadyFilled);
    expect(first).toEqual(second);
    expect(alreadyFilled).toEqual(['subject']);
  });
});
