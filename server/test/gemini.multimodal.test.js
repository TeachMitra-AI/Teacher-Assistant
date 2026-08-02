// GeminiService's optional multimodal `attachments` extension (server/src/gemini.js).
// Verifies the inlineData parts are added correctly for one or many files —
// all in the SAME contents block, in a SINGLE call — and — just as
// importantly — that every existing caller which never passes `attachments`
// sees byte-for-byte the same request shape as before this feature existed.
const { GeminiService } = require('../src/gemini');
const { mockGeminiFetch, geminiSuccess } = require('./helpers/geminiMock');

function makeService(overrides = {}) {
  return new GeminiService({
    apiKey: 'test-fake-key',
    endpoint: 'https://example.invalid/generate',
    timeoutMs: 5000,
    maxRetries: 3,
    sleep: () => Promise.resolve(),
    ...overrides,
  });
}

describe('GeminiService — multimodal attachments support', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('generateContent WITHOUT attachments sends a single text part — unchanged from before this feature', async () => {
    const { mock, calls } = mockGeminiFetch([geminiSuccess('An answer.')]);
    const service = makeService();

    await service.generateContent({ systemInstruction: 'Be helpful.', userText: '```\nhello\n```' });

    expect(mock).toHaveBeenCalledTimes(1);
    expect(calls[0].body.contents).toEqual([{ role: 'user', parts: [{ text: '```\nhello\n```' }] }]);
  });

  test('generateContent with an EMPTY attachments array behaves exactly like no attachments at all', async () => {
    const { calls } = mockGeminiFetch([geminiSuccess('An answer.')]);
    const service = makeService();

    await service.generateContent({ systemInstruction: 'Be helpful.', userText: '```\nhello\n```', attachments: [] });

    expect(calls[0].body.contents[0].parts).toEqual([{ text: '```\nhello\n```' }]);
  });

  test('generateContent with ONE attachment adds a single inlineData part (backward-compatible single-file shape)', async () => {
    const { calls } = mockGeminiFetch([geminiSuccess('Question 5 is solved by...')]);
    const service = makeService();

    await service.generateContent({
      systemInstruction: 'Answer the question about the attached file.',
      userText: '```\nSolve Question 5\n```',
      attachments: [{ mimeType: 'image/jpeg', data: 'ZmFrZS1iYXNlNjQ=' }],
    });

    expect(calls[0].body.contents).toEqual([
      {
        role: 'user',
        parts: [
          { text: '```\nSolve Question 5\n```' },
          { inlineData: { mimeType: 'image/jpeg', data: 'ZmFrZS1iYXNlNjQ=' } },
        ],
      },
    ]);
  });

  test('generateContent with MULTIPLE attachments puts every one in the SAME contents block, in a SINGLE call', async () => {
    const { mock, calls } = mockGeminiFetch([geminiSuccess('Looking at all three files together...')]);
    const service = makeService();

    await service.generateContent({
      systemInstruction: 'Answer the question about the attached files.',
      userText: '```\nSummarize these\n```',
      attachments: [
        { mimeType: 'image/jpeg', data: 'aW1hZ2Ux' },
        { mimeType: 'image/png', data: 'aW1hZ2Uy' },
        { mimeType: 'application/pdf', data: 'cGRmMQ==' },
      ],
    });

    // ONE logical call for the whole batch — never one call per file.
    expect(mock).toHaveBeenCalledTimes(1);
    expect(calls[0].body.contents).toHaveLength(1);
    expect(calls[0].body.contents[0].parts).toEqual([
      { text: '```\nSummarize these\n```' },
      { inlineData: { mimeType: 'image/jpeg', data: 'aW1hZ2Ux' } },
      { inlineData: { mimeType: 'image/png', data: 'aW1hZ2Uy' } },
      { inlineData: { mimeType: 'application/pdf', data: 'cGRmMQ==' } },
    ]);
  });

  test('a MAX_TOKENS continuation after a multi-attachment call does not re-attach any file', async () => {
    const { calls } = mockGeminiFetch([
      geminiSuccess('Part one of the answer...', 'MAX_TOKENS'),
      geminiSuccess('...and the rest of it.', 'STOP'),
    ]);
    const service = makeService({ maxContinuations: 2 });

    const result = await service.generateContent({
      systemInstruction: 'Answer the question about the attached files.',
      userText: '```\nSummarize this\n```',
      attachments: [
        { mimeType: 'application/pdf', data: 'ZmFrZS1wZGYx' },
        { mimeType: 'image/png', data: 'ZmFrZS1pbWFnZQ==' },
      ],
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].body.contents[0].parts).toHaveLength(3); // text + 2 inlineData
    expect(calls[1].body.contents[0].parts).toHaveLength(1); // continuation: text only
    expect(result.text).toBe('Part one of the answer... ...and the rest of it.');
  });

  test('buildRequestBody omits inlineData entirely when attachments is undefined (no empty parts entries)', () => {
    const service = makeService();
    const body = service.buildRequestBody({ systemInstruction: 'x', userText: 'y' });
    expect(body.contents[0].parts).toEqual([{ text: 'y' }]);
  });
});
