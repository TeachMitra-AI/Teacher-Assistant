// PYQ taxonomy seed — Phase 5 (docs/pyq-implementation-plan.md §9/§20).
// Idempotent Board -> Subject -> Chapter -> Topic seed for the locked MVP
// slice (Phase 0): CBSE + Bihar Board, Class 10, Mathematics only. Mirrors
// seed.js's own upsert-by-unique-key idempotency exactly — safe to re-run
// any number of times; never creates a duplicate row.
// Run with: npm run seed:pyq
//
// SOURCING (see docs/pyq-implementation-plan.md's Phase 5 completion record
// for the full per-chapter breakdown):
//
// CBSE chapter/topic names below are taken from SIX official CBSE curriculum
// PDFs (cbseacademic.nic.in), sessions 2019-20 through 2024-25, downloaded
// and read directly during Phase 5's research — not from a secondary source.
//
// Bihar Board (BSEB) data is SECONDARY-SOURCE ONLY. BSEB's own site
// (biharboardonline.bihar.gov.in) was unreachable from the environment this
// seed was authored in, despite a genuine multi-method attempt (direct
// fetch, curl with/without SSL verification, plain HTTP, the Wayback
// Machine). BSEB is seeded with the SAME 15 chapter names as CBSE because
// secondary sources describe BSEB's Class 10 Maths structure as closely
// NCERT-aligned — but this is a documented assumption, not an official
// confirmation, and a reviewer correcting a chapter/topic assignment later
// (routes/adminPyq.js's PATCH .../questions/:id) is the expected, designed
// safety net for exactly this kind of gap (§9: "reviewer manually assigns or
// creates the missing chapter as an explicit admin action").
//
// "Constructions" is seeded for BOTH boards, but means something different
// per board:
//   - CBSE: HISTORICAL ONLY. Officially present in every CBSE curriculum PDF
//     read through the 2021-22 session; absent from 2022-23 onward. Since
//     the PYQ corpus spans 2015-2024 (Phase 0), older CBSE papers (exam
//     years <= 2022) may contain genuine Constructions questions even though
//     it is not in CBSE's CURRENT syllabus. Chapter existence here is not a
//     claim that it's taught every year — Question.year (already on the
//     schema) is what actually varies per row.
//   - Bihar Board: a CURRENT chapter per secondary sources, not historical.
//
// Chapter `sequence` follows the real NCERT "Mathematics - Class X" textbook
// chapter order (1-15) for both boards, for a consistent, recognizable admin
// UI ordering — not a claim that Bihar Board's own textbook numbers chapters
// identically (unconfirmed; BSEB uses its own state textbook, not NCERT's).
//
// Trigonometric Identities is seeded as a TOPIC under "Introduction to
// Trigonometry", not a separate Chapter — this matches the real NCERT
// textbook's chapter boundary (Ch. 8), which is what an actual exam paper's
// mark scheme references, even though CBSE's own curriculum document lists
// it as a separately numbered unit-item. A deliberate design decision, not
// an oversight — see the Phase 5 completion record.
require('dotenv').config();

const { prisma } = require('./lib/db');

const BOARDS = Object.freeze([
  { name: 'CBSE', code: 'CBSE', region: 'National' },
  { name: 'Bihar Board', code: 'BSEB', region: 'Bihar' },
]);

const CLASS_LEVEL = '10';
const SUBJECT_NAME = 'Mathematics';

// Shared Class 10 Mathematics chapter/topic taxonomy — seeded independently
// under each board's own Subject row (schema.prisma's @@unique([boardId,
// classLevel, name]) on Subject and @@unique([subjectId, name]) on Chapter
// already guarantee CBSE's and Bihar Board's rows are two completely
// separate trees, never merged, even though the names below are identical).
const MATH_CLASS_10_CHAPTERS = Object.freeze([
  { name: 'Real Numbers', sequence: 1, topics: ['Fundamental Theorem of Arithmetic', 'Irrationality Proofs'] },
  { name: 'Polynomials', sequence: 2, topics: ['Zeroes and Coefficients of a Quadratic Polynomial'] },
  {
    name: 'Pair of Linear Equations in Two Variables',
    sequence: 3,
    topics: ['Graphical Method', 'Algebraic Methods (Substitution/Elimination)', 'Situational (Word) Problems'],
  },
  {
    name: 'Quadratic Equations',
    sequence: 4,
    topics: ['Solution by Factorization', 'Solution by Quadratic Formula', 'Nature of Roots (Discriminant)'],
  },
  { name: 'Arithmetic Progressions', sequence: 5, topics: ['nth Term of an A.P.', 'Sum of First n Terms'] },
  { name: 'Triangles', sequence: 6, topics: ['Similar Triangles / Basic Proportionality', 'Criteria for Similarity (AA/SSS/SAS)'] },
  { name: 'Coordinate Geometry', sequence: 7, topics: ['Distance Formula', 'Section Formula (Internal Division)'] },
  {
    name: 'Introduction to Trigonometry',
    sequence: 8,
    topics: ['Trigonometric Ratios', 'Ratios of 30°/45°/60°', 'Trigonometric Identities'],
  },
  { name: 'Some Applications of Trigonometry', sequence: 9, topics: ['Angle of Elevation', 'Angle of Depression'] },
  { name: 'Circles', sequence: 10, topics: ['Tangent Perpendicular to Radius', 'Lengths of Tangents from an External Point'] },
  {
    name: 'Constructions',
    sequence: 11,
    topics: ['Division of a Line Segment in a Given Ratio', 'Tangents to a Circle from an External Point', 'Triangle Similar to a Given Triangle'],
  },
  { name: 'Areas Related to Circles', sequence: 12, topics: ['Area of Sector', 'Area of Segment'] },
  {
    name: 'Surface Areas and Volumes',
    sequence: 13,
    topics: ['Combination of Solids — Surface Area', 'Combination of Solids — Volume', 'Conversion of One Solid into Another'],
  },
  { name: 'Statistics', sequence: 14, topics: ['Mean of Grouped Data', 'Median of Grouped Data', 'Mode of Grouped Data'] },
  { name: 'Probability', sequence: 15, topics: ['Classical Definition of Probability', 'Simple Problems on Probability'] },
]);

async function upsertBoard({ name, code, region }) {
  return prisma.board.upsert({
    where: { code },
    update: { name, region },
    create: { name, code, region },
  });
}

async function upsertSubject({ boardId, classLevel, name }) {
  return prisma.subject.upsert({
    where: { boardId_classLevel_name: { boardId, classLevel, name } },
    update: {},
    create: { boardId, classLevel, name },
  });
}

async function upsertChapter({ subjectId, name, sequence }) {
  return prisma.chapter.upsert({
    where: { subjectId_name: { subjectId, name } },
    update: { sequence },
    create: { subjectId, name, sequence },
  });
}

async function upsertTopic({ chapterId, name }) {
  return prisma.topic.upsert({
    where: { chapterId_name: { chapterId, name } },
    update: {},
    create: { chapterId, name },
  });
}

/** Seeds one board's full Class 10 Mathematics taxonomy. Exported for tests — safe to call repeatedly. */
async function seedBoardMathTaxonomy(boardConfig) {
  const board = await upsertBoard(boardConfig);
  const subject = await upsertSubject({ boardId: board.id, classLevel: CLASS_LEVEL, name: SUBJECT_NAME });

  let chapterCount = 0;
  let topicCount = 0;
  for (const chapterDef of MATH_CLASS_10_CHAPTERS) {
    const chapter = await upsertChapter({ subjectId: subject.id, name: chapterDef.name, sequence: chapterDef.sequence });
    chapterCount += 1;
    for (const topicName of chapterDef.topics) {
      await upsertTopic({ chapterId: chapter.id, name: topicName });
      topicCount += 1;
    }
  }

  return { board, subject, chapterCount, topicCount };
}

async function main() {
  for (const boardConfig of BOARDS) {
    const result = await seedBoardMathTaxonomy(boardConfig);
    console.log(
      `Seeded ${result.board.name} (${result.board.code}) -> Class ${CLASS_LEVEL} ${SUBJECT_NAME}: ` +
        `${result.chapterCount} chapters, ${result.topicCount} topics.`
    );
  }
  console.log('PYQ syllabus seed complete.');
}

/* istanbul ignore if -- real CLI entry point, exercised via seedBoardMathTaxonomy in tests, not this block */
if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = { BOARDS, CLASS_LEVEL, SUBJECT_NAME, MATH_CLASS_10_CHAPTERS, seedBoardMathTaxonomy };
