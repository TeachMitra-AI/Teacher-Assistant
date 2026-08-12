// PYQ clustering batch — Phase 6. End-to-end DB tests for
// runPyqClusterBatch: exact/lexical/semantic pass integration, board/
// subject/class/chapter isolation, review-status eligibility, idempotency,
// and cluster-membership/recurrence correctness. No Gemini calls are made
// by this script (embeddings are pre-set directly on fixture rows, exactly
// as pyqEmbedBatch.js would have already persisted them) — deterministic
// fixtures throughout, per the plan's own "no bulk real-world processing"
// instruction.
const { prisma } = require('./helpers/testApp');
const { runPyqClusterBatch } = require('../src/pyqClusterBatch');

let seq = 0;

async function makeTaxonomy(prefix) {
  seq += 1;
  const board = await prisma.board.create({ data: { name: `${prefix} Board`, code: `${prefix}BRD${seq}`.toUpperCase().slice(0, 24) } });
  const subject = await prisma.subject.create({ data: { boardId: board.id, classLevel: '10', name: 'Mathematics' } });
  const chapter = await prisma.chapter.create({ data: { subjectId: subject.id, name: 'Quadratic Equations', sequence: 1 } });
  return { board, subject, chapter };
}

async function makeExamPaper({ board, subject, year = 2020, examType = 'annual', setLabel = '' }) {
  seq += 1;
  return prisma.examPaper.create({
    data: { boardId: board.id, subjectId: subject.id, classLevel: subject.classLevel, year, examType, setLabel: setLabel || `s${seq}` },
  });
}

let qSeq = 0;
async function makeQuestion({ examPaper, chapter, text, reviewStatus = 'approved', embedding = null }) {
  qSeq += 1;
  return prisma.question.create({
    data: {
      examPaperId: examPaper.id,
      boardId: examPaper.boardId,
      subjectId: examPaper.subjectId,
      classLevel: examPaper.classLevel,
      year: examPaper.year,
      questionNumber: String(qSeq),
      language: 'en',
      type: 'short_answer',
      text,
      marks: 2,
      rawExtraction: '{}',
      reviewStatus,
      chapterId: chapter ? chapter.id : null,
      embedding: embedding ? JSON.stringify(embedding) : null,
    },
  });
}

async function membersOf(clusterId) {
  return prisma.questionClusterMember.findMany({ where: { clusterId } });
}

describe('runPyqClusterBatch — exact pass', () => {
  test('two exact-duplicate (numeric-masked) questions form one exact cluster', async () => {
    const { board, subject, chapter } = await makeTaxonomy('exact');
    const paperA = await makeExamPaper({ board, subject, year: 2018 });
    const paperB = await makeExamPaper({ board, subject, year: 2021 });
    const q1 = await makeQuestion({ examPaper: paperA, chapter, text: 'force = 20N, mass = 4kg. Find acceleration.' });
    const q2 = await makeQuestion({ examPaper: paperB, chapter, text: 'force = 15N, mass = 3kg. Find acceleration.' });

    const result = await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    expect(result.newClusters).toBeGreaterThanOrEqual(1);

    const cluster = await prisma.questionCluster.findFirst({ where: { chapterId: chapter.id, method: 'exact' } });
    expect(cluster).not.toBeNull();
    const members = await membersOf(cluster.id);
    expect(members.map((m) => m.questionId).sort()).toEqual([q1.id, q2.id].sort());
    expect(members.every((m) => m.similarity === null)).toBe(true);
  });

  test('formatting-only differences (case/punctuation/whitespace) still collapse via the exact pass', async () => {
    const { board, subject, chapter } = await makeTaxonomy('fmt');
    const paperA = await makeExamPaper({ board, subject, year: 2019 });
    const paperB = await makeExamPaper({ board, subject, year: 2022 });
    await makeQuestion({ examPaper: paperA, chapter, text: 'Find the roots of x^2 - 5x + 6.' });
    await makeQuestion({ examPaper: paperB, chapter, text: '  find   THE roots of x^2-5x+6  ' });

    await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    const cluster = await prisma.questionCluster.findFirst({ where: { chapterId: chapter.id } });
    expect(cluster.method).toBe('exact');
    expect(await membersOf(cluster.id)).toHaveLength(2);
  });

  test('a same-template, different-numbers pair clusters (approved §9 design) — a structurally different question with different numbers does not', async () => {
    const { board, subject, chapter } = await makeTaxonomy('numsig');
    const paperA = await makeExamPaper({ board, subject, year: 2017 });
    const paperB = await makeExamPaper({ board, subject, year: 2020 });
    const paperC = await makeExamPaper({ board, subject, year: 2023 });
    await makeQuestion({ examPaper: paperA, chapter, text: 'Find the roots of x^2 - 5x + 6.' });
    await makeQuestion({ examPaper: paperB, chapter, text: 'Find the roots of x^2 - 7x + 10.' }); // same template, different coefficients
    await makeQuestion({ examPaper: paperC, chapter, text: 'Solve for y: 2y + 3 = 11.' }); // structurally different question

    await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    const clusters = await prisma.questionCluster.findMany({ where: { chapterId: chapter.id }, include: { members: true } });
    expect(clusters).toHaveLength(1); // only the two "find the roots of ax^2+bx+c" questions
    expect(clusters[0].members).toHaveLength(2);
  });

  test('missing/empty question text never clusters with anything', async () => {
    const { board, subject, chapter } = await makeTaxonomy('emptytext');
    const paper = await makeExamPaper({ board, subject });
    await makeQuestion({ examPaper: paper, chapter, text: '' });
    await makeQuestion({ examPaper: paper, chapter, text: '   ' });

    const result = await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    const clusters = await prisma.questionCluster.findMany({ where: { chapterId: chapter.id } });
    expect(clusters).toHaveLength(0);
    expect(result.newClusters).toBe(0);
  });
});

describe('runPyqClusterBatch — lexical pass', () => {
  test('near-identical wording ("roots" vs "zeroes") clusters via the lexical pass', async () => {
    const { board, subject, chapter } = await makeTaxonomy('lex');
    const paperA = await makeExamPaper({ board, subject, year: 2017 });
    const paperB = await makeExamPaper({ board, subject, year: 2019 });
    await makeQuestion({ examPaper: paperA, chapter, text: 'Find the roots of x^2 - 5x + 6.' });
    await makeQuestion({ examPaper: paperB, chapter, text: 'Determine the zeroes of x^2 - 5x + 6.' });

    await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    const cluster = await prisma.questionCluster.findFirst({ where: { chapterId: chapter.id } });
    expect(cluster.method).toBe('lexical');
  });
});

describe('runPyqClusterBatch — semantic pass', () => {
  test('semantically-equivalent (embedding-close) questions with unrelated wording cluster via the semantic pass', async () => {
    const { board, subject, chapter } = await makeTaxonomy('sem');
    const paperA = await makeExamPaper({ board, subject, year: 2016 });
    const paperB = await makeExamPaper({ board, subject, year: 2023 });
    await makeQuestion({ examPaper: paperA, chapter, text: "State Newton's second law.", embedding: [1, 0, 0] });
    await makeQuestion({ examPaper: paperB, chapter, text: 'Derive the relationship between force, mass and acceleration.', embedding: [0.99, 0.14, 0] });

    await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    const cluster = await prisma.questionCluster.findFirst({ where: { chapterId: chapter.id } });
    expect(cluster.method).toBe('semantic');
    const members = await membersOf(cluster.id);
    expect(members.some((m) => m.similarity !== null && m.similarity > 0.85)).toBe(true);
  });

  test('genuinely different questions with unrelated embeddings never cluster', async () => {
    const { board, subject, chapter } = await makeTaxonomy('semdiff');
    const paperA = await makeExamPaper({ board, subject, year: 2016 });
    const paperB = await makeExamPaper({ board, subject, year: 2023 });
    // Deliberately different WORDS too (not just different embeddings) —
    // text differing by only one character would risk a spurious LEXICAL
    // match regardless of embeddings, which would defeat the point of this
    // test (isolating the semantic pass's own behavior).
    await makeQuestion({ examPaper: paperA, chapter, text: 'Explain the process of photosynthesis in plants.', embedding: [1, 0, 0] });
    await makeQuestion({ examPaper: paperB, chapter, text: 'Calculate the volume of a rectangular prism.', embedding: [0, 1, 0] });

    await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    const clusters = await prisma.questionCluster.findMany({ where: { chapterId: chapter.id } });
    expect(clusters).toHaveLength(0);
  });
});

describe('runPyqClusterBatch — isolation boundaries', () => {
  test('identical text under DIFFERENT chapters is never clustered together, even when each chapter has its own real match', async () => {
    const { board, subject } = await makeTaxonomy('diffchap');
    const chapterA = await prisma.chapter.create({ data: { subjectId: subject.id, name: 'Real Numbers', sequence: 1 } });
    const chapterB = await prisma.chapter.create({ data: { subjectId: subject.id, name: 'Polynomials', sequence: 2 } });
    const paper1 = await makeExamPaper({ board, subject, year: 2019 });
    const paper2 = await makeExamPaper({ board, subject, year: 2021 });
    // Same identical text appears twice under EACH chapter — a real
    // within-chapter match exists on both sides, so if chapter-scoping were
    // broken, all four rows would end up in ONE cross-chapter cluster.
    const a1 = await makeQuestion({ examPaper: paper1, chapter: chapterA, text: 'Identical question text here.' });
    const a2 = await makeQuestion({ examPaper: paper2, chapter: chapterA, text: 'Identical question text here.' });
    const b1 = await makeQuestion({ examPaper: paper1, chapter: chapterB, text: 'Identical question text here.' });
    const b2 = await makeQuestion({ examPaper: paper2, chapter: chapterB, text: 'Identical question text here.' });

    await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    const clustersA = await prisma.questionCluster.findMany({ where: { chapterId: chapterA.id }, include: { members: true } });
    const clustersB = await prisma.questionCluster.findMany({ where: { chapterId: chapterB.id }, include: { members: true } });
    expect(clustersA).toHaveLength(1);
    expect(clustersB).toHaveLength(1);
    expect(clustersA[0].members.map((m) => m.questionId).sort()).toEqual([a1.id, a2.id].sort());
    expect(clustersB[0].members.map((m) => m.questionId).sort()).toEqual([b1.id, b2.id].sort());
  });

  test('CBSE and Bihar Board never cluster together even with byte-identical text and the same chapter NAME', async () => {
    seq += 1;
    const cbseBoard = await prisma.board.create({ data: { name: 'CBSE', code: `CBSETEST${seq}` } });
    const bsebBoard = await prisma.board.create({ data: { name: 'Bihar Board', code: `BSEBTEST${seq}` } });
    const cbseSubject = await prisma.subject.create({ data: { boardId: cbseBoard.id, classLevel: '10', name: 'Mathematics' } });
    const bsebSubject = await prisma.subject.create({ data: { boardId: bsebBoard.id, classLevel: '10', name: 'Mathematics' } });
    const cbseChapter = await prisma.chapter.create({ data: { subjectId: cbseSubject.id, name: 'Triangles', sequence: 1 } });
    const bsebChapter = await prisma.chapter.create({ data: { subjectId: bsebSubject.id, name: 'Triangles', sequence: 1 } });
    const cbsePaper = await makeExamPaper({ board: cbseBoard, subject: cbseSubject });
    const bsebPaper = await makeExamPaper({ board: bsebBoard, subject: bsebSubject });
    await makeQuestion({ examPaper: cbsePaper, chapter: cbseChapter, text: 'Prove the Basic Proportionality Theorem.' });
    await makeQuestion({ examPaper: bsebPaper, chapter: bsebChapter, text: 'Prove the Basic Proportionality Theorem.' });

    await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    expect(await prisma.questionCluster.findMany({ where: { chapterId: cbseChapter.id } })).toHaveLength(0);
    expect(await prisma.questionCluster.findMany({ where: { chapterId: bsebChapter.id } })).toHaveLength(0);
  });

  test('different classLevels never clustered together (separate Subject/Chapter rows)', async () => {
    seq += 1;
    const board = await prisma.board.create({ data: { name: 'ClassBoard', code: `CLASSBRD${seq}` } });
    const subject10 = await prisma.subject.create({ data: { boardId: board.id, classLevel: '10', name: 'Mathematics' } });
    const subject12 = await prisma.subject.create({ data: { boardId: board.id, classLevel: '12', name: 'Mathematics' } });
    const chapter10 = await prisma.chapter.create({ data: { subjectId: subject10.id, name: 'Integrals', sequence: 1 } });
    const chapter12 = await prisma.chapter.create({ data: { subjectId: subject12.id, name: 'Integrals', sequence: 1 } });
    const paper10 = await makeExamPaper({ board, subject: subject10 });
    const paper12 = await makeExamPaper({ board, subject: subject12 });
    await makeQuestion({ examPaper: paper10, chapter: chapter10, text: 'Evaluate the integral.' });
    await makeQuestion({ examPaper: paper12, chapter: chapter12, text: 'Evaluate the integral.' });

    await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    expect(await prisma.questionCluster.findMany({ where: { chapterId: chapter10.id } })).toHaveLength(0);
    expect(await prisma.questionCluster.findMany({ where: { chapterId: chapter12.id } })).toHaveLength(0);
  });
});

describe('runPyqClusterBatch — review-status eligibility', () => {
  test('a rejected question is never included in any cluster', async () => {
    const { board, subject, chapter } = await makeTaxonomy('rejected');
    const paperA = await makeExamPaper({ board, subject, year: 2018 });
    const paperB = await makeExamPaper({ board, subject, year: 2021 });
    const approved = await makeQuestion({ examPaper: paperA, chapter, text: 'Identical rejected-test text.' });
    const rejected = await makeQuestion({ examPaper: paperB, chapter, text: 'Identical rejected-test text.', reviewStatus: 'rejected' });

    await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    const clusters = await prisma.questionCluster.findMany({ where: { chapterId: chapter.id } });
    expect(clusters).toHaveLength(0); // the approved one has nothing eligible to match — the rejected twin doesn't count
    const rejectedMembership = await prisma.questionClusterMember.findFirst({ where: { questionId: rejected.id } });
    expect(rejectedMembership).toBeNull();
    expect(approved.id).toBeTruthy();
  });

  test('an unreviewed ("extracted") or merely-reviewed question is never included — only "approved"', async () => {
    const { board, subject, chapter } = await makeTaxonomy('unreviewed');
    const paperA = await makeExamPaper({ board, subject, year: 2018 });
    const paperB = await makeExamPaper({ board, subject, year: 2021 });
    await makeQuestion({ examPaper: paperA, chapter, text: 'Identical unreviewed-test text.', reviewStatus: 'approved' });
    const extracted = await makeQuestion({ examPaper: paperB, chapter, text: 'Identical unreviewed-test text.', reviewStatus: 'extracted' });

    await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    const membership = await prisma.questionClusterMember.findFirst({ where: { questionId: extracted.id } });
    expect(membership).toBeNull();
  });
});

describe('runPyqClusterBatch — multi-paper / multi-year clustering & membership', () => {
  test('the same question repeated across 3 different exam papers/years all join ONE cluster', async () => {
    const { board, subject, chapter } = await makeTaxonomy('multiyear');
    const p2015 = await makeExamPaper({ board, subject, year: 2015 });
    const p2019 = await makeExamPaper({ board, subject, year: 2019 });
    const p2024 = await makeExamPaper({ board, subject, year: 2024 });
    const q1 = await makeQuestion({ examPaper: p2015, chapter, text: 'A recurring question, asked every few years.' });
    const q2 = await makeQuestion({ examPaper: p2019, chapter, text: 'A recurring question, asked every few years.' });
    const q3 = await makeQuestion({ examPaper: p2024, chapter, text: 'A recurring question, asked every few years.' });

    await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    const clusters = await prisma.questionCluster.findMany({ where: { chapterId: chapter.id }, include: { members: true } });
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.questionId).sort()).toEqual([q1.id, q2.id, q3.id].sort());
  });

  test('two occurrences of the same question WITHIN one paper still cluster together', async () => {
    const { board, subject, chapter } = await makeTaxonomy('inpaper');
    const paper = await makeExamPaper({ board, subject });
    const q1 = await makeQuestion({ examPaper: paper, chapter, text: 'Duplicated within the same paper.' });
    const q2 = await makeQuestion({ examPaper: paper, chapter, text: 'Duplicated within the same paper.' });

    await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    const cluster = await prisma.questionCluster.findFirst({ where: { chapterId: chapter.id } });
    expect(cluster).not.toBeNull();
    const members = await membersOf(cluster.id);
    expect(members.map((m) => m.questionId).sort()).toEqual([q1.id, q2.id].sort());
  });
});

describe('runPyqClusterBatch — idempotency', () => {
  test('running twice never creates duplicate members or duplicate clusters', async () => {
    const { board, subject, chapter } = await makeTaxonomy('idempotent');
    const paperA = await makeExamPaper({ board, subject, year: 2018 });
    const paperB = await makeExamPaper({ board, subject, year: 2021 });
    await makeQuestion({ examPaper: paperA, chapter, text: 'Idempotency test question text.' });
    await makeQuestion({ examPaper: paperB, chapter, text: 'Idempotency test question text.' });

    const first = await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    expect(first.newClusters).toBe(1);
    const second = await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    expect(second.newClusters).toBe(0);
    expect(second.joins).toBe(0);

    const clusters = await prisma.questionCluster.findMany({ where: { chapterId: chapter.id } });
    expect(clusters).toHaveLength(1);
    expect(await membersOf(clusters[0].id)).toHaveLength(2);
  });

  test('a CONFIRMED cluster is never reclassified by a rerun, but a genuinely new matching question CAN join it', async () => {
    const { board, subject, chapter } = await makeTaxonomy('confirmed');
    const paperA = await makeExamPaper({ board, subject, year: 2018 });
    const paperB = await makeExamPaper({ board, subject, year: 2021 });
    await makeQuestion({ examPaper: paperA, chapter, text: 'Confirmed-cluster test question text.' });
    await makeQuestion({ examPaper: paperB, chapter, text: 'Confirmed-cluster test question text.' });
    await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });

    const cluster = await prisma.questionCluster.findFirst({ where: { chapterId: chapter.id } });
    await prisma.questionCluster.update({ where: { id: cluster.id }, data: { status: 'confirmed', confirmedById: 'admin-1', confirmedAt: new Date() } });

    const paperC = await makeExamPaper({ board, subject, year: 2024 });
    const q3 = await makeQuestion({ examPaper: paperC, chapter, text: 'Confirmed-cluster test question text.' });

    const result = await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    expect(result.newClusters).toBe(0); // no NEW cluster — it joined the existing confirmed one
    expect(result.joins).toBe(1);

    const stillConfirmed = await prisma.questionCluster.findUnique({ where: { id: cluster.id } });
    expect(stillConfirmed.status).toBe('confirmed'); // untouched by the rerun
    const members = await membersOf(cluster.id);
    expect(members.map((m) => m.questionId)).toContain(q3.id);
  });

  test('a REJECTED cluster never silently re-absorbs a new matching question', async () => {
    const { board, subject, chapter } = await makeTaxonomy('rejectedcluster');
    const paperA = await makeExamPaper({ board, subject, year: 2018 });
    const paperB = await makeExamPaper({ board, subject, year: 2021 });
    await makeQuestion({ examPaper: paperA, chapter, text: 'Rejected-cluster test question text.' });
    await makeQuestion({ examPaper: paperB, chapter, text: 'Rejected-cluster test question text.' });
    await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });

    const cluster = await prisma.questionCluster.findFirst({ where: { chapterId: chapter.id } });
    await prisma.questionCluster.update({ where: { id: cluster.id }, data: { status: 'rejected', confirmedById: 'admin-1', confirmedAt: new Date() } });

    const paperC = await makeExamPaper({ board, subject, year: 2024 });
    await makeQuestion({ examPaper: paperC, chapter, text: 'Rejected-cluster test question text.' });

    const result = await runPyqClusterBatch({ prismaClient: prisma, logger: { log() {} } });
    // The rejected cluster is excluded from matching entirely, so the new
    // question forms its own fresh (still-unclustered-relative-to-it)
    // proposal rather than silently joining the rejected one.
    expect(result.joins).toBe(0);
    const rejectedMembers = await membersOf(cluster.id);
    expect(rejectedMembers).toHaveLength(2); // unchanged
  });
});
