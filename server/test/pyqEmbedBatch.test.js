// PYQ embedding batch — Phase 6. DB-touching tests for
// findNextUnembeddedQuestion / embedAndPersistQuestion / runPyqEmbedBatch.
// No global fetch stubbing needed — embedText/runPyqEmbedBatch accept an
// injectable fetchImpl, so these tests pass a plain mock function directly.
//
// runPyqEmbedBatch is GLOBAL BY DESIGN (no chapter/paper scoping — a real
// production batch script should sweep every eligible question system-wide,
// same as pyqClusterBatch.js's own chapter-discovery step). That means it
// can see OTHER test files' leftover eligible-but-unembedded fixture rows
// in this shared test database. Every test below verifies outcomes for its
// OWN rows specifically (never a raw total count), and drains the full
// backlog with a generous maxQuestions rather than assuming "the next
// globally-eligible row is mine" — the only way to stay correct regardless
// of what else exists in the shared DB or what order test files run in.
const { prisma } = require('./helpers/testApp');
const { runPyqEmbedBatch, findNextUnembeddedQuestion } = require('../src/pyqEmbedBatch');

let board;
let subject;
let chapter;
let examPaper;
let seq = 0;

beforeAll(async () => {
  seq += 1;
  board = await prisma.board.create({ data: { name: 'Embed Board', code: `EMBEDBRD${seq}` } });
  subject = await prisma.subject.create({ data: { boardId: board.id, classLevel: '10', name: 'Mathematics' } });
  chapter = await prisma.chapter.create({ data: { subjectId: subject.id, name: 'Real Numbers', sequence: 1 } });
  examPaper = await prisma.examPaper.create({
    data: { boardId: board.id, subjectId: subject.id, classLevel: '10', year: 2021, examType: 'annual', setLabel: 'embedtest' },
  });
});

afterEach(async () => {
  await prisma.question.deleteMany({ where: { examPaperId: examPaper.id } });
});

let qSeq = 0;
async function makeQuestion(overrides = {}) {
  qSeq += 1;
  return prisma.question.create({
    data: {
      examPaperId: examPaper.id,
      boardId: board.id,
      subjectId: subject.id,
      classLevel: '10',
      year: 2021,
      questionNumber: String(qSeq),
      language: 'en',
      type: 'short_answer',
      text: `pyqEmbedBatch fixture question ${seq}-${qSeq}`,
      marks: 2,
      rawExtraction: '{}',
      reviewStatus: 'approved',
      chapterId: chapter.id,
      ...overrides,
    },
  });
}

/** Every call succeeds with the SAME embedding, regardless of which question it's for. */
function fetchAlwaysSucceeds(values) {
  return async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ embedding: { values } }),
    text: async () => '{}',
  });
}

/** Drains the full global backlog (this file's rows + any other file's leftovers) so per-row assertions are order-independent. */
async function drainBacklog(fetchImpl, overrides = {}) {
  return runPyqEmbedBatch({
    prismaClient: prisma, apiKey: 'k', fetchImpl, intervalMs: 0, maxQuestions: 500,
    logger: { log() {}, warn() {}, error() {} },
    ...overrides,
  });
}

describe('findNextUnembeddedQuestion', () => {
  test('never returns a not-approved, not-classified, or already-embedded row', async () => {
    const notApproved = await makeQuestion({ reviewStatus: 'extracted' });
    const notClassified = await makeQuestion({ chapterId: null });
    const alreadyEmbedded = await makeQuestion({ embedding: JSON.stringify([1, 2, 3]) });

    // Drain whatever else is currently eligible (from this or other files) so
    // we can assert cleanly on what's left: nothing eligible remains, and
    // none of the three ineligible rows above were ever touched.
    await drainBacklog(fetchAlwaysSucceeds([0, 0]));

    const next = await findNextUnembeddedQuestion(prisma);
    expect(next).toBeNull();
    const stillNotApproved = await prisma.question.findUnique({ where: { id: notApproved.id } });
    const stillNotClassified = await prisma.question.findUnique({ where: { id: notClassified.id } });
    const stillEmbedded = await prisma.question.findUnique({ where: { id: alreadyEmbedded.id } });
    expect(stillNotApproved.embedding).toBeNull();
    expect(stillNotClassified.embedding).toBeNull();
    expect(JSON.parse(stillEmbedded.embedding)).toEqual([1, 2, 3]); // untouched
  });
});

describe('runPyqEmbedBatch', () => {
  test('embeds every eligible question and persists Question.embedding', async () => {
    const q1 = await makeQuestion();
    const q2 = await makeQuestion();

    await drainBacklog(fetchAlwaysSucceeds([0.5, 0.5]));

    const updated1 = await prisma.question.findUnique({ where: { id: q1.id } });
    const updated2 = await prisma.question.findUnique({ where: { id: q2.id } });
    expect(JSON.parse(updated1.embedding)).toEqual([0.5, 0.5]);
    expect(JSON.parse(updated2.embedding)).toEqual([0.5, 0.5]);
  });

  test('is idempotent — a question that already has an embedding is never re-embedded', async () => {
    const q = await makeQuestion({ embedding: JSON.stringify([9, 9, 9]) });
    await drainBacklog(fetchAlwaysSucceeds([1, 1, 1]));
    const unchanged = await prisma.question.findUnique({ where: { id: q.id } });
    expect(JSON.parse(unchanged.embedding)).toEqual([9, 9, 9]); // untouched, not overwritten
  });

  test('stops (never retries against the wall) on 429 and reports stoppedOnQuota', async () => {
    await makeQuestion();
    const fetchImpl = async () => ({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({}), text: async () => 'rate limited' });
    const result = await drainBacklog(fetchImpl);
    expect(result.stoppedOnQuota).toBe(true);
  });

  test('a permanently malformed response is tombstoned (empty embedding) so it never blocks the rest of the batch or loops forever', async () => {
    const bad = await makeQuestion({ text: `TOMBSTONE-MARKER-BAD-${seq}-${qSeq}` });
    const good = await makeQuestion({ text: `TOMBSTONE-MARKER-GOOD-${seq}-${qSeq}` });

    // Branch on the REQUEST CONTENT, not call order — robust to any other
    // eligible rows from other test files being interleaved into the batch.
    const fetchImpl = async (endpoint, options) => {
      const body = JSON.parse(options.body);
      const text = body.content.parts[0].text;
      if (text.includes('TOMBSTONE-MARKER-BAD')) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ notAnEmbedding: true }), text: async () => '{}' };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ embedding: { values: [1, 2] } }), text: async () => '{}' };
    };

    await drainBacklog(fetchImpl);

    const badRow = await prisma.question.findUnique({ where: { id: bad.id } });
    const goodRow = await prisma.question.findUnique({ where: { id: good.id } });
    expect(JSON.parse(badRow.embedding)).toEqual([]); // tombstoned, not left null (would loop forever)
    expect(JSON.parse(goodRow.embedding)).toEqual([1, 2]);
  });
});
