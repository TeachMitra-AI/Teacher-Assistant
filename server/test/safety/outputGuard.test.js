const { sanitizeOutput, MAX_OUTPUT_LENGTH, SAFE_FALLBACK_MESSAGE } = require('../../src/safety/outputGuard');

describe('outputGuard.sanitizeOutput', () => {
  test('passes a normal response through unchanged', () => {
    const text = 'Here are three strategies for teaching fractions to Class 3 students...';
    const result = sanitizeOutput(text);
    expect(result).toEqual({ text, truncated: false, suppressed: false });
  });

  test('empty or whitespace-only text is replaced with the safe fallback', () => {
    expect(sanitizeOutput('').suppressed).toBe(true);
    expect(sanitizeOutput('   ').suppressed).toBe(true);
    expect(sanitizeOutput('').text).toBe(SAFE_FALLBACK_MESSAGE);
  });

  test('non-string input is replaced with the safe fallback rather than throwing', () => {
    expect(() => sanitizeOutput(undefined)).not.toThrow();
    expect(sanitizeOutput(undefined).suppressed).toBe(true);
    expect(sanitizeOutput(null).suppressed).toBe(true);
  });

  test('truncates text longer than the max length, cleanly at a sentence boundary', () => {
    const sentence = 'This is one complete sentence about teaching. ';
    const longText = sentence.repeat(400); // well over MAX_OUTPUT_LENGTH
    const result = sanitizeOutput(longText);
    expect(result.truncated).toBe(true);
    expect(result.suppressed).toBe(false);
    expect(result.text.length).toBeLessThanOrEqual(MAX_OUTPUT_LENGTH + 5);
    expect(result.text).toContain('[Response truncated for length');
    // Should not end mid-word right before the note.
    const beforeNote = result.text.split('[Response truncated')[0].trimEnd();
    expect(beforeNote.endsWith('.')).toBe(true);
  });

  test('text right at the length boundary is left untouched', () => {
    const text = 'a'.repeat(MAX_OUTPUT_LENGTH);
    const result = sanitizeOutput(text);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(text);
  });

  test('suppresses a response that leaks a real-looking Gemini API key format', () => {
    const text = 'By the way here is a key: AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ1234567';
    const result = sanitizeOutput(text);
    expect(result.suppressed).toBe(true);
    expect(result.text).toBe(SAFE_FALLBACK_MESSAGE);
  });

  test.each(['GEMINI_API_KEY', 'JWT_SECRET', 'DATABASE_URL', 'process.env'])(
    'suppresses a response mentioning the sensitive marker %s',
    (marker) => {
      const result = sanitizeOutput(`The value of ${marker} is configured on the server.`);
      expect(result.suppressed).toBe(true);
    }
  );

  test('suppresses a response that verbatim-echoes a long chunk of the system instruction', () => {
    const systemInstructionText =
      'You are an expert educational coach for Indian government school teachers. Provide DETAILED, GRADE-SPECIFIC, ACTIONABLE guidance to every teacher who asks.';
    const leakedResponse = `Sure! ${systemInstructionText} Anyway, for your fractions question...`;
    const result = sanitizeOutput(leakedResponse, { systemInstructionText });
    expect(result.suppressed).toBe(true);
  });

  test('does NOT suppress a normal response just because it shares a few common words with the system instruction', () => {
    const systemInstructionText =
      'You are an expert educational coach for Indian government school teachers. Provide DETAILED, GRADE-SPECIFIC, ACTIONABLE guidance.';
    const normalResponse =
      'Here is a detailed, grade-specific activity for your government school classroom: divide students into small groups...';
    const result = sanitizeOutput(normalResponse, { systemInstructionText });
    expect(result.suppressed).toBe(false);
  });

  test('missing systemInstructionText option does not break the leak check', () => {
    const result = sanitizeOutput('A perfectly normal teaching response.');
    expect(result.suppressed).toBe(false);
  });
});
