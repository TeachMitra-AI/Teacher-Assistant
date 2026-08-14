// selectPyqPaper() — Phase 8 (docs/pyq-implementation-plan.md §10). Pure,
// deterministic, DB-free unit tests over fixed fixture pools — same style as
// test/lib/pyqClustering.test.js: fixed pool in, exact expected selection
// out, including the exact-marks-repair boundary and the Failure path, per
// Phase 8's own Definition of Done.
const { selectPyqPaper, explainShortfall } = require('../../src/lib/pyqSelection');

let seq = 0;
/** A minimal, fully-overridable PyqCandidate fixture. */
function candidate(overrides = {}) {
  seq += 1;
  return {
    id: `q${seq}`,
    examPaperId: `paper-${seq}`,
    year: 2020,
    chapterId: `ch${seq}`,
    type: 'short_answer',
    marks: 2,
    questionNumber: String(seq),
    parentQuestionId: null,
    requiresGroupSelection: false,
    partIds: [],
    confirmedClusterId: null,
    pageNumber: 1,
    text: `Question text ${seq}`,
    options: null,
    correctAnswer: 'A model answer.',
    hasOfficialAnswer: true,
    hasDiagram: false,
    hasTable: false,
    ...overrides,
  };
}

function baseRequest(overrides = {}) {
  return {
    yearFrom: 2015,
    yearTo: 2024,
    totalMarks: 10,
    questionCount: 3,
    questionType: undefined,
    prioritizeRecurring: false,
    ...overrides,
  };
}

describe('selectPyqPaper — candidate pool edge cases (§10 step 1)', () => {
  test('an empty pool fails with NO_CANDIDATES, distinct from an insufficient pool', () => {
    const result = selectPyqPaper({ candidates: [], request: baseRequest() });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NO_CANDIDATES');
    expect(result.error).toMatch(/No published PYQ content/);
  });

  test('null/undefined candidates is treated the same as an empty pool, never throws', () => {
    const result = selectPyqPaper({ candidates: null, request: baseRequest() });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NO_CANDIDATES');
  });
});

describe('selectPyqPaper — success path, exact marks/count (§10 steps 2-6)', () => {
  test('selects exactly questionCount questions summing to exactly totalMarks', () => {
    const candidates = [
      candidate({ marks: 2, year: 2016 }),
      candidate({ marks: 2, year: 2018 }),
      candidate({ marks: 2, year: 2020 }),
      candidate({ marks: 2, year: 2022 }), // extra, should not all be needed
    ];
    const result = selectPyqPaper({ candidates, request: baseRequest({ totalMarks: 6, questionCount: 3 }) });
    expect(result.ok).toBe(true);
    expect(result.marksUsed).toBe(6);
    expect(result.questionCount).toBe(3);
    expect(result.questions).toHaveLength(3);
    // Every returned row carries §9's reproducibility fields.
    for (const q of result.questions) {
      expect(typeof q.score).toBe('number');
      expect(typeof q.recurrenceScore).toBe('number');
      expect(typeof q.recencyScore).toBe('number');
      expect(typeof q.recurrenceCount).toBe('number');
    }
  });

  test('is deterministic: identical input produces an identical result on a second call', () => {
    const candidates = [
      candidate({ marks: 3, year: 2017 }),
      candidate({ marks: 3, year: 2019 }),
      candidate({ marks: 4, year: 2021 }),
      candidate({ marks: 2, year: 2023 }),
    ];
    const request = baseRequest({ totalMarks: 10, questionCount: 3 });
    const first = selectPyqPaper({ candidates: candidates.map((c) => ({ ...c })), request });
    const second = selectPyqPaper({ candidates: candidates.map((c) => ({ ...c })), request });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.questions.map((q) => q.id)).toEqual(first.questions.map((q) => q.id));
    expect(second.marksUsed).toBe(first.marksUsed);
  });
});

describe('selectPyqPaper — insufficient pool (§10 step 6 / §19)', () => {
  test('fails with INSUFFICIENT_PYQ_POOL and an accurate found-vs-requested diagnostic', () => {
    const candidates = [candidate({ marks: 2, year: 2020 })]; // only 1 available, questionCount asks for 3
    const result = selectPyqPaper({ candidates, request: baseRequest({ totalMarks: 6, questionCount: 3 }) });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INSUFFICIENT_PYQ_POOL');
    expect(result.diagnostic.found.questions).toBe(1);
    expect(result.diagnostic.requested.questions).toBe(3);
    expect(result.diagnostic.requested.marks).toBe(6);
    expect(result.diagnostic.candidatePoolSize).toBe(1);
  });

  test('never returns a paper with the wrong total marks or count — validated even when count is satisfiable but marks are not', () => {
    // Two candidates, both fit questionCount=1, but NEITHER has marks===totalMarks
    // and no swap combination can hit it exactly (bounded repair must give up cleanly).
    const candidates = [
      candidate({ marks: 4, year: 2020, chapterId: 'a' }),
      candidate({ marks: 3, year: 2019, chapterId: 'b' }),
      candidate({ marks: 6, year: 2018, chapterId: 'c' }),
      candidate({ marks: 2, year: 2017, chapterId: 'd' }),
    ];
    const result = selectPyqPaper({ candidates, request: baseRequest({ totalMarks: 5, questionCount: 1 }) });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INSUFFICIENT_PYQ_POOL');
    expect(result.diagnostic.requested.marks).toBe(5);
  });
});

describe('selectPyqPaper — cluster-based duplicate prevention (§10 usedClusters)', () => {
  test('at most one member of a CONFIRMED cluster is ever selected, even with extra pool depth', () => {
    const clusterMembers = new Map([
      ['c1', [
        { boardId: 'b', subjectId: 's', year: 2016, examType: 'annual', translationOfId: null },
        { boardId: 'b', subjectId: 's', year: 2020, examType: 'annual', translationOfId: null },
      ]],
    ]);
    const candidates = [
      candidate({ marks: 2, year: 2016, confirmedClusterId: 'c1', chapterId: 'ch1' }),
      candidate({ marks: 2, year: 2020, confirmedClusterId: 'c1', chapterId: 'ch1' }),
      candidate({ marks: 2, year: 2017, chapterId: 'ch2' }),
      candidate({ marks: 2, year: 2018, chapterId: 'ch3' }),
    ];
    const result = selectPyqPaper({ candidates, clusterMembers, request: baseRequest({ totalMarks: 6, questionCount: 3 }) });
    expect(result.ok).toBe(true);
    const clusterIds = result.questions.filter((q) => q.confirmedClusterId === 'c1');
    expect(clusterIds).toHaveLength(1); // never both c1 members in the same paper
  });

  test('two candidates with NO confirmed cluster (confirmedClusterId: null) are never treated as duplicates of each other', () => {
    const candidates = [
      candidate({ marks: 2, year: 2016, confirmedClusterId: null, chapterId: 'ch1' }),
      candidate({ marks: 2, year: 2017, confirmedClusterId: null, chapterId: 'ch2' }),
    ];
    const result = selectPyqPaper({ candidates, request: baseRequest({ totalMarks: 4, questionCount: 2 }) });
    expect(result.ok).toBe(true);
    expect(result.questions).toHaveLength(2);
  });
});

describe('selectPyqPaper — chapter-share cap (§10: MAX_SHARE_PER_CHAPTER = ceil(questionCount * 0.4))', () => {
  test('no single chapter exceeds its cap, even when it has enough marks-eligible candidates to fill the whole paper', () => {
    // questionCount=4 -> cap = ceil(4*0.4) = 2. All recurrenceScore ties at 1
    // (no clusters), so score is purely recency-driven and monotonic in
    // year — chA's newer years sort strictly above chB's older years.
    const candidates = [
      candidate({ marks: 1, year: 2020, chapterId: 'chA' }),
      candidate({ marks: 1, year: 2019, chapterId: 'chA' }),
      candidate({ marks: 1, year: 2018, chapterId: 'chA' }),
      candidate({ marks: 1, year: 2017, chapterId: 'chA' }),
      candidate({ marks: 1, year: 2016, chapterId: 'chB' }),
      candidate({ marks: 1, year: 2015, chapterId: 'chB' }),
    ];
    const result = selectPyqPaper({
      candidates,
      request: baseRequest({
        yearFrom: 2013, yearTo: 2020, totalMarks: 4, questionCount: 4, prioritizeRecurring: false,
      }),
    });
    expect(result.ok).toBe(true);
    const byChapter = {};
    for (const q of result.questions) byChapter[q.chapterId] = (byChapter[q.chapterId] || 0) + 1;
    expect(byChapter.chA).toBe(2);
    expect(byChapter.chB).toBe(2);
    // The two highest-recency chA rows win the cap slots (2020, 2019).
    expect(result.questions.filter((q) => q.chapterId === 'chA').map((q) => q.year).sort()).toEqual([2019, 2020]);
  });

  test('a question with no chapter classification (chapterId: null) still counts against a shared "unclassified" cap bucket', () => {
    const candidates = [
      candidate({ marks: 1, year: 2020, chapterId: null }),
      candidate({ marks: 1, year: 2019, chapterId: null }),
      candidate({ marks: 1, year: 2018, chapterId: null }),
      candidate({ marks: 1, year: 2017, chapterId: 'chB' }),
    ];
    const result = selectPyqPaper({
      candidates,
      request: baseRequest({
        yearFrom: 2013, yearTo: 2020, totalMarks: 3, questionCount: 3, prioritizeRecurring: false,
      }),
    });
    expect(result.ok).toBe(true);
    const unclassifiedCount = result.questions.filter((q) => q.chapterId === null).length;
    // cap = ceil(3*0.4) = 2 — at most 2 of the 3 unclassified rows, the rest
    // filled from chB.
    expect(unclassifiedCount).toBe(2);
  });
});

describe('selectPyqPaper — recurrence vs recency weighting (§10 step 2)', () => {
  test('prioritizeRecurring: true favors a highly-recurring older question over a non-recurring newer one', () => {
    const clusterMembers = new Map([
      ['recurring-cluster', [
        { boardId: 'b', subjectId: 's', year: 2013, examType: 'annual', translationOfId: null },
        { boardId: 'b', subjectId: 's', year: 2016, examType: 'annual', translationOfId: null },
        { boardId: 'b', subjectId: 's', year: 2019, examType: 'annual', translationOfId: null },
        { boardId: 'b', subjectId: 's', year: 2013, examType: 'annual', translationOfId: null }, // duplicate sitting, collapses
      ]],
    ]);
    const candidates = [
      candidate({ id: 'newNonRecurring', marks: 4, year: 2020, chapterId: 'a', confirmedClusterId: null }),
      candidate({ id: 'oldRecurring', marks: 4, year: 2013, chapterId: 'b', confirmedClusterId: 'recurring-cluster' }),
    ];
    const request = baseRequest({
      yearFrom: 2013, yearTo: 2020, totalMarks: 4, questionCount: 1,
    });

    const recurring = selectPyqPaper({ candidates, clusterMembers, request: { ...request, prioritizeRecurring: true } });
    expect(recurring.ok).toBe(true);
    expect(recurring.questions[0].id).toBe('oldRecurring');

    const recent = selectPyqPaper({ candidates, clusterMembers, request: { ...request, prioritizeRecurring: false } });
    expect(recent.ok).toBe(true);
    expect(recent.questions[0].id).toBe('newNonRecurring');
  });
});

describe('selectPyqPaper — questionType filter', () => {
  test('only selects questions matching the requested type when one is given', () => {
    const candidates = [
      candidate({ type: 'mcq', marks: 2, year: 2020, chapterId: 'a' }),
      candidate({ type: 'short_answer', marks: 2, year: 2019, chapterId: 'b' }),
      candidate({ type: 'mcq', marks: 2, year: 2018, chapterId: 'c' }),
    ];
    const result = selectPyqPaper({
      candidates, request: baseRequest({ totalMarks: 4, questionCount: 2, questionType: 'mcq' }),
    });
    expect(result.ok).toBe(true);
    expect(result.questions.every((q) => q.type === 'mcq')).toBe(true);
  });

  test('fails cleanly (never substitutes a different type) when too few questions match the requested type', () => {
    const candidates = [
      candidate({ type: 'mcq', marks: 2, year: 2020 }),
      candidate({ type: 'short_answer', marks: 2, year: 2019 }),
      candidate({ type: 'short_answer', marks: 2, year: 2018 }),
    ];
    const result = selectPyqPaper({
      candidates, request: baseRequest({ totalMarks: 6, questionCount: 3, questionType: 'mcq' }),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('INSUFFICIENT_PYQ_POOL');
  });
});

describe('selectPyqPaper — bounded exact-marks repair (§10 step 5)', () => {
  test('a single swap corrects a greedy fill that lands short of the exact marks target', () => {
    // Sorted purely by recency (all recurrenceScore ties at 1): A(2020) > B(2019) > C(2018) > D(2017).
    // Greedy naturally picks A(3) + C(1) = 4 (B doesn't fit: 3+3=6>5), then
    // stops at questionCount=2 with marksUsed=4 != totalMarks=5. The bounded
    // swap must replace C(1) with D(2) to land exactly on 5.
    const A = candidate({
      id: 'A', marks: 3, year: 2020, chapterId: 'chA',
    });
    const B = candidate({
      id: 'B', marks: 3, year: 2019, chapterId: 'chB',
    });
    const C = candidate({
      id: 'C', marks: 1, year: 2018, chapterId: 'chC',
    });
    const D = candidate({
      id: 'D', marks: 2, year: 2017, chapterId: 'chD',
    });
    const result = selectPyqPaper({
      candidates: [A, B, C, D],
      request: baseRequest({
        yearFrom: 2017, yearTo: 2020, totalMarks: 5, questionCount: 2, prioritizeRecurring: false,
      }),
    });
    expect(result.ok).toBe(true);
    expect(result.marksUsed).toBe(5);
    expect(result.questions.map((q) => q.id).sort()).toEqual(['A', 'D']);
  });
});

describe('selectPyqPaper — multi-part group selection (§10 allPartsAvailable, §7 requiresGroupSelection)', () => {
  test('a requiresGroupSelection parent and ALL its parts are selected together as one unit', () => {
    const parent = candidate({
      id: 'parent', marks: 2, year: 2020, chapterId: 'g', requiresGroupSelection: true, partIds: ['part1', 'part2'],
    });
    const part1 = candidate({
      id: 'part1', marks: 1, year: 2020, chapterId: 'g', parentQuestionId: 'parent',
    });
    const part2 = candidate({
      id: 'part2', marks: 1, year: 2020, chapterId: 'g', parentQuestionId: 'parent',
    });
    const result = selectPyqPaper({
      candidates: [parent, part1, part2],
      request: baseRequest({ totalMarks: 4, questionCount: 1 }),
    });
    expect(result.ok).toBe(true);
    expect(result.questionCount).toBe(1); // the whole group counts as ONE question
    expect(result.marksUsed).toBe(4); // 2 + 1 + 1 — every row's own marks summed
    expect(result.questions.map((q) => q.id).sort()).toEqual(['parent', 'part1', 'part2']);
  });

  test('a parent missing even one part is skipped entirely, and its available sibling part is never selected standalone', () => {
    const parent = candidate({
      id: 'parent', marks: 2, year: 2020, chapterId: 'g', requiresGroupSelection: true, partIds: ['part1', 'missing-part'],
    });
    const part1 = candidate({
      id: 'part1', marks: 1, year: 2020, chapterId: 'g', parentQuestionId: 'parent',
    });
    const standalone = candidate({
      id: 'standalone', marks: 4, year: 2019, chapterId: 'other',
    });
    const result = selectPyqPaper({
      candidates: [parent, part1, standalone],
      request: baseRequest({ totalMarks: 4, questionCount: 1 }),
    });
    expect(result.ok).toBe(true);
    expect(result.questions.map((q) => q.id)).toEqual(['standalone']);
  });
});

describe('explainShortfall', () => {
  test('produces a specific, teacher-readable counts message', () => {
    const diag = explainShortfall({
      poolSize: 10, selectedCount: 2, marksUsed: 4, questionCount: 5, totalMarks: 10,
    });
    expect(diag.message).toBe('Found 2 of 5 questions and 4 of 10 marks for these filters. Try widening the year range or lowering the question count.');
    expect(diag.found).toEqual({ questions: 2, marks: 4 });
    expect(diag.requested).toEqual({ questions: 5, marks: 10 });
  });
});
