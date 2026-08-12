// Phase 5 — taxonomy seed correctness/idempotency/isolation tests.
const { prisma } = require('./helpers/testApp');
const {
  seedBoardMathTaxonomy, BOARDS, MATH_CLASS_10_CHAPTERS,
} = require('../src/pyqSyllabusSeed');

const TOTAL_TOPICS = MATH_CLASS_10_CHAPTERS.reduce((n, c) => n + c.topics.length, 0);

afterAll(async () => {
  // Cleanup — this is the only test file that seeds the REAL CBSE/BSEB
  // codes (other PYQ test files create their own differently-coded fixture
  // boards), so a full teardown here can't affect any other suite.
  for (const b of BOARDS) {
    const board = await prisma.board.findUnique({ where: { code: b.code } });
    if (!board) continue;
    const subjects = await prisma.subject.findMany({ where: { boardId: board.id } });
    for (const s of subjects) {
      const chapters = await prisma.chapter.findMany({ where: { subjectId: s.id } });
      for (const c of chapters) await prisma.topic.deleteMany({ where: { chapterId: c.id } });
      await prisma.chapter.deleteMany({ where: { subjectId: s.id } });
    }
    await prisma.subject.deleteMany({ where: { boardId: board.id } });
  }
  for (const b of BOARDS) await prisma.board.deleteMany({ where: { code: b.code } });
});

describe('seedBoardMathTaxonomy', () => {
  test('seeds every chapter and topic from the source data for CBSE', async () => {
    const result = await seedBoardMathTaxonomy(BOARDS[0]);
    expect(result.board.code).toBe('CBSE');
    expect(result.subject.classLevel).toBe('10');
    expect(result.subject.name).toBe('Mathematics');
    expect(result.chapterCount).toBe(MATH_CLASS_10_CHAPTERS.length);
    expect(result.topicCount).toBe(TOTAL_TOPICS);
  });

  test('is idempotent — re-running never creates a duplicate Board/Subject/Chapter/Topic row', async () => {
    const first = await seedBoardMathTaxonomy(BOARDS[1]); // Bihar Board
    const second = await seedBoardMathTaxonomy(BOARDS[1]);
    expect(second.board.id).toBe(first.board.id);
    expect(second.subject.id).toBe(first.subject.id);

    expect(await prisma.board.count({ where: { code: 'BSEB' } })).toBe(1);
    expect(await prisma.subject.count({ where: { boardId: first.board.id } })).toBe(1);
    expect(await prisma.chapter.count({ where: { subjectId: first.subject.id } })).toBe(MATH_CLASS_10_CHAPTERS.length);
    expect(await prisma.topic.count({ where: { chapter: { subjectId: first.subject.id } } })).toBe(TOTAL_TOPICS);
  });

  test('re-running a third time still does not duplicate rows (idempotent beyond a single re-run)', async () => {
    await seedBoardMathTaxonomy(BOARDS[1]);
    await seedBoardMathTaxonomy(BOARDS[1]);
    const board = await prisma.board.findUnique({ where: { code: 'BSEB' } });
    expect(await prisma.chapter.count({ where: { subjectId: (await prisma.subject.findFirst({ where: { boardId: board.id } })).id } })).toBe(
      MATH_CLASS_10_CHAPTERS.length
    );
  });

  test('CBSE and Bihar Board get completely independent Chapter rows, even with identical names — never merged', async () => {
    const cbse = await seedBoardMathTaxonomy(BOARDS[0]);
    const bseb = await seedBoardMathTaxonomy(BOARDS[1]);
    const cbseTriangles = await prisma.chapter.findUnique({
      where: { subjectId_name: { subjectId: cbse.subject.id, name: 'Triangles' } },
    });
    const bsebTriangles = await prisma.chapter.findUnique({
      where: { subjectId_name: { subjectId: bseb.subject.id, name: 'Triangles' } },
    });
    expect(cbseTriangles).not.toBeNull();
    expect(bsebTriangles).not.toBeNull();
    expect(cbseTriangles.id).not.toBe(bsebTriangles.id);
  });

  test('"Constructions" is seeded for both boards (historical-only for CBSE, current for Bihar Board)', async () => {
    const cbse = await seedBoardMathTaxonomy(BOARDS[0]);
    const bseb = await seedBoardMathTaxonomy(BOARDS[1]);
    const cbseConstructions = await prisma.chapter.findUnique({
      where: { subjectId_name: { subjectId: cbse.subject.id, name: 'Constructions' } },
    });
    const bsebConstructions = await prisma.chapter.findUnique({
      where: { subjectId_name: { subjectId: bseb.subject.id, name: 'Constructions' } },
    });
    expect(cbseConstructions).not.toBeNull();
    expect(bsebConstructions).not.toBeNull();
  });

  test('every seeded topic belongs to exactly the chapter the source data assigns it to', async () => {
    const cbse = await seedBoardMathTaxonomy(BOARDS[0]);
    const trig = await prisma.chapter.findUnique({
      where: { subjectId_name: { subjectId: cbse.subject.id, name: 'Introduction to Trigonometry' } },
      include: { topics: true },
    });
    expect(trig.topics.map((t) => t.name).sort()).toEqual(
      ['Ratios of 30°/45°/60°', 'Trigonometric Identities', 'Trigonometric Ratios'].sort()
    );
  });

  test('Chapter.sequence follows the source data (syllabus order)', async () => {
    const cbse = await seedBoardMathTaxonomy(BOARDS[0]);
    const realNumbers = await prisma.chapter.findUnique({
      where: { subjectId_name: { subjectId: cbse.subject.id, name: 'Real Numbers' } },
    });
    const probability = await prisma.chapter.findUnique({
      where: { subjectId_name: { subjectId: cbse.subject.id, name: 'Probability' } },
    });
    expect(realNumbers.sequence).toBe(1);
    expect(probability.sequence).toBe(15);
  });
});
