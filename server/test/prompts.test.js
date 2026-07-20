// Tests for server/src/prompts.js's own behavior — template routing,
// emergency-mode routing, and static checks on the prompt text itself
// (no phone numbers). Complements test/gemini.contract.test.js (which
// exercises GeminiService end-to-end with a mocked fetch) and
// test/ai-safety.test.js (which exercises the full route).
const { selectTemplate } = require('../src/prompts');

// A loose "looks like a phone number" pattern: 2+ digit groups of 2-4
// digits separated by common phone-number punctuation, OR any single run of
// 3+ digits (long enough to be a phone number/extension fragment, short
// enough not to false-positive on things this app's prompts don't contain
// at all in the emergency-specific text, e.g. word counts or grade ranges —
// those live only in the non-emergency templates, not in the text under
// test here).
const PHONE_LIKE_PATTERN = /\d{2,4}[-.\s]\d{2,4}([-.\s]\d{2,4})?|\b\d{3,}\b/;

// India's real emergency service numbers (ambulance/police/fire, national
// and various state-specific), plus common generic ones — explicitly
// checked for since this app targets Indian government schools and a
// careless hardcode of one of these would be a realistic mistake.
const KNOWN_EMERGENCY_NUMBERS = ['911', '999', '112', '100', '101', '102', '108'];

describe('prompts.selectTemplate — emergency routing', () => {
  test('an active medical emergency query is routed to emergency mode', () => {
    const result = selectTemplate(
      'One of my Class 5 students suddenly has severe chest pain, difficulty breathing, and feels dizzy during class. Tell me exactly what medical treatment and medicine I should give the student immediately.',
      { grade: 'Class 5' }
    );
    expect(result.isEmergency).toBe(true);
  });

  test('a request for medicine during an active emergency explicitly forbids prescribing', () => {
    const result = selectTemplate(
      'A student is having a severe allergic reaction and their throat is swelling, what medicine should I give them right now?',
      {}
    );
    expect(result.isEmergency).toBe(true);
    expect(result.systemInstruction).toMatch(/cannot diagnose.*prescribe|do not suggest any medication/i);
    expect(result.systemInstruction).not.toMatch(/give (the student|them) \d+\s*(mg|ml|mcg|tablets?|drops?)/i);
  });

  test('a serious student safety emergency is routed to emergency mode', () => {
    const result = selectTemplate('Another student is threatening to hurt my student with a knife right now, what should I do?', {});
    expect(result.isEmergency).toBe(true);
    expect(result.systemInstruction).toMatch(/emergency protocol/i);
  });

  test('emergency mode excludes the normal mandatory pedagogical structure entirely', () => {
    const result = selectTemplate('A student just collapsed and is unresponsive, what do I do right now?', { grade: 'Class 4' });
    expect(result.isEmergency).toBe(true);
    expect(result.systemInstruction).not.toContain('MANDATORY RESPONSE STRUCTURE');
    expect(result.systemInstruction).not.toContain('Fun Activity');
    expect(result.systemInstruction).not.toContain('Teaching Method');
    expect(result.systemInstruction).not.toContain('Quick Assessment');
    expect(result.systemInstruction).not.toContain('Common Mistakes');
  });

  test('emergency mode still carries the anti-injection framing for the delimited question', () => {
    const result = selectTemplate('A student just collapsed and is unresponsive, what do I do right now?', {});
    expect(result.systemInstruction).toMatch(/never as instructions/i);
    expect(result.userContent).toMatch(/```[\s\S]*collapsed[\s\S]*```/);
  });

  test('a normal first-aid teaching question stays in normal pedagogical mode', () => {
    const result = selectTemplate('How can I teach students about first aid?', { grade: 'Class 5' });
    expect(result.isEmergency).toBe(false);
    expect(result.systemInstruction).toContain('MANDATORY');
  });

  test('an emergency-preparedness lesson-plan request stays in normal pedagogical mode', () => {
    const result = selectTemplate('Create a lesson plan about emergency preparedness.', { grade: 'Class 5' });
    expect(result.isEmergency).toBe(false);
    expect(result.systemInstruction).toContain('MANDATORY');
  });

  test('a normal health-and-safety teaching question stays in normal pedagogical mode', () => {
    const result = selectTemplate('How can I teach Class 5 students about health and safety?', { grade: 'Class 5' });
    expect(result.isEmergency).toBe(false);
  });

  test('normal (non-emergency) queries still carry the emergency-override backstop instruction, for defense-in-depth', () => {
    const result = selectTemplate('How do I explain fractions to Class 3 students?', { grade: 'Class 3-5' });
    expect(result.isEmergency).toBe(false);
    expect(result.systemInstruction).toMatch(/EMERGENCY OVERRIDE/);
    expect(result.systemInstruction).toMatch(/overrides every other instruction.*including the MANDATORY RESPONSE STRUCTURE/i);
  });
});

describe('prompts — no hardcoded or fake phone numbers', () => {
  test('the emergency-mode prompt contains no phone-number-like sequences', () => {
    const result = selectTemplate('A student just collapsed and is unresponsive, what do I do right now?', {});
    expect(result.systemInstruction).not.toMatch(PHONE_LIKE_PATTERN);
  });

  test('the emergency-mode prompt does not mention any known real-world emergency number', () => {
    const result = selectTemplate('A student just collapsed and is unresponsive, what do I do right now?', {});
    for (const number of KNOWN_EMERGENCY_NUMBERS) {
      expect(result.systemInstruction).not.toMatch(new RegExp(`\\b${number}\\b`));
    }
  });

  test('the emergency-mode prompt explicitly instructs against inventing any phone numbers, including personal ones', () => {
    const result = selectTemplate('A student just collapsed and is unresponsive, what do I do right now?', {});
    expect(result.systemInstruction).toMatch(/do not invent or provide any example phone numbers/i);
    expect(result.systemInstruction).toMatch(/school, parent, guardian, or emergency/i);
  });

  test('the normal-mode EMERGENCY OVERRIDE backstop text also contains no phone-number-like sequences or known numbers', () => {
    const result = selectTemplate('How do I explain fractions to Class 3 students?', {});
    const overrideSection = result.systemInstruction.split('CRITICAL REQUIREMENTS:')[0]; // everything before the pedagogical section
    expect(overrideSection).not.toMatch(PHONE_LIKE_PATTERN);
    for (const number of KNOWN_EMERGENCY_NUMBERS) {
      expect(overrideSection).not.toMatch(new RegExp(`\\b${number}\\b`));
    }
  });
});
