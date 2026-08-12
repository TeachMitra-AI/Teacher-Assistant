const {
  normalizeAndMaskNumbers, exactSignature, trigramSimilarity, cosineSimilarity,
  pickReferenceQuestion, runExactPass, runLexicalPass, runSemanticPass, planChapterClustering,
  occurrenceCount, embedText,
} = require('../../src/lib/pyqClustering');
const { mockGeminiFetch, geminiRateLimited } = require('../helpers/geminiMock');

describe('normalizeAndMaskNumbers / exactSignature', () => {
  test('masks numeric literals, per §9\'s approved "force=20N vs force=15N" example', () => {
    const a = normalizeAndMaskNumbers('force = 20N, mass = 4kg');
    const b = normalizeAndMaskNumbers('force = 15N, mass = 3kg');
    expect(a).toBe(b);
  });

  test('is case/punctuation/whitespace insensitive', () => {
    expect(exactSignature('  Find   the ROOTS of x^2 - 5x + 6.  ')).toBe(exactSignature('find the roots of x^2 - 5x + 6'));
  });

  test('genuinely different structure produces a different signature', () => {
    expect(exactSignature('Find the roots of x^2 - 5x + 6.')).not.toBe(exactSignature('Find the area of a circle of radius 7 cm.'));
  });

  test('non-string input never throws', () => {
    expect(normalizeAndMaskNumbers(null)).toBe('');
    expect(normalizeAndMaskNumbers(undefined)).toBe('');
    expect(normalizeAndMaskNumbers(42)).toBe('');
  });
});

describe('trigramSimilarity', () => {
  test('is 1 for identical text and 0 for completely disjoint text', () => {
    expect(trigramSimilarity('abcdef', 'abcdef')).toBe(1);
    expect(trigramSimilarity('abc', 'xyz')).toBe(0);
  });

  test('catches near-identical wording — §9\'s own example', () => {
    const sim = trigramSimilarity(
      exactSignature("State Newton's second law"),
      exactSignature('State the second law of motion given by Newton')
    );
    expect(sim).toBeGreaterThan(0.3);
  });

  test('rewords "roots" vs "zeroes" of the SAME masked quadratic as clearly above the lexical threshold', () => {
    const sim = trigramSimilarity(exactSignature('Find the roots of x^2 - 5x + 6.'), exactSignature('Determine the zeroes of x^2 - 5x + 6.'));
    expect(sim).toBeGreaterThan(0.4);
  });

  test('both-empty is defined as similarity 1, one-empty as 0 (never divides by zero)', () => {
    expect(trigramSimilarity('', '')).toBe(1);
    expect(trigramSimilarity('abc', '')).toBe(0);
  });
});

describe('cosineSimilarity', () => {
  test('is 1 for identical vectors, 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
  });

  test('handles malformed input without throwing', () => {
    expect(cosineSimilarity(null, [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});

describe('pickReferenceQuestion', () => {
  test('picks the earliest year, tie-broken by id', () => {
    const questions = [{ id: 'b', year: 2020 }, { id: 'a', year: 2018 }, { id: 'c', year: 2018 }];
    expect(pickReferenceQuestion(questions).id).toBe('a');
  });

  test('is deterministic and does not mutate its input', () => {
    const questions = [{ id: 'z', year: 2022 }, { id: 'a', year: 2015 }];
    const copy = [...questions];
    pickReferenceQuestion(questions);
    expect(questions).toEqual(copy);
  });
});

describe('runExactPass', () => {
  test('groups two same-masked-signature questions into a new exact cluster', () => {
    const pool = [
      { id: 'q1', text: 'force = 20N, mass = 4kg', year: 2018 },
      { id: 'q2', text: 'force = 15N, mass = 3kg', year: 2020 },
    ];
    const { newClusters, joins, claimed } = runExactPass(pool, []);
    expect(joins).toEqual([]);
    expect(newClusters).toHaveLength(1);
    expect(newClusters[0].method).toBe('exact');
    expect(newClusters[0].members.map((m) => m.questionId).sort()).toEqual(['q1', 'q2']);
    expect(newClusters[0].members.every((m) => m.similarity === null)).toBe(true);
    expect(claimed).toEqual(new Set(['q1', 'q2']));
  });

  test('a lone question with no exact match is left unclaimed', () => {
    const pool = [{ id: 'q1', text: 'Find the area of a circle of radius 7 cm.', year: 2019 }];
    const { newClusters, joins, claimed } = runExactPass(pool, []);
    expect(newClusters).toEqual([]);
    expect(joins).toEqual([]);
    expect(claimed.size).toBe(0);
  });

  test('joins an EXISTING cluster instead of creating a new one when the signature already matches', () => {
    const pool = [{ id: 'q3', text: 'force = 9N, mass = 1kg', year: 2021 }];
    const existingRefs = [{ clusterId: 'cluster-1', text: 'force = 20N, mass = 4kg', year: 2018, id: 'ref' }];
    const { newClusters, joins, claimed } = runExactPass(pool, existingRefs);
    expect(newClusters).toEqual([]);
    expect(joins).toEqual([{ clusterId: 'cluster-1', questionId: 'q3', similarity: null }]);
    expect(claimed.has('q3')).toBe(true);
  });

  test('empty/invalid text never matches anything', () => {
    const pool = [{ id: 'q1', text: '', year: 2020 }, { id: 'q2', text: '   ', year: 2020 }];
    const { newClusters, claimed } = runExactPass(pool, []);
    expect(newClusters).toEqual([]);
    expect(claimed.size).toBe(0);
  });

  test('genuinely different questions never cluster, even with superficially similar length/shape', () => {
    const pool = [
      { id: 'q1', text: 'Find the roots of x^2 - 5x + 6.', year: 2020 },
      { id: 'q2', text: 'Find the area of a circle of radius 7 cm.', year: 2020 },
    ];
    const { newClusters, claimed } = runExactPass(pool, []);
    expect(newClusters).toEqual([]);
    expect(claimed.size).toBe(0);
  });
});

describe('runLexicalPass', () => {
  test('clusters near-identical wording the exact pass would miss ("roots" vs "zeroes")', () => {
    const pool = [
      { id: 'q1', text: 'Find the roots of x^2 - 5x + 6.', year: 2017 },
      { id: 'q2', text: 'Determine the zeroes of x^2 - 5x + 6.', year: 2019 },
    ];
    const { newClusters, claimed } = runLexicalPass(pool, []);
    expect(newClusters).toHaveLength(1);
    expect(newClusters[0].method).toBe('lexical');
    expect(claimed).toEqual(new Set(['q1', 'q2']));
  });

  test('two genuinely different quadratics (different masked signature, low trigram overlap) do not cluster', () => {
    // Different structure entirely, not just different numbers — a real
    // "looks similar but is a different question" case (§9's own concern).
    const pool = [
      { id: 'q1', text: 'Find the roots of x^2 - 5x + 6.', year: 2020 },
      { id: 'q2', text: 'Solve for y: 2y + 3 = 11.', year: 2020 },
    ];
    const { newClusters, claimed } = runLexicalPass(pool, []);
    expect(newClusters).toEqual([]);
    expect(claimed.size).toBe(0);
  });

  test('joins an existing cluster reference by wording similarity', () => {
    const pool = [{ id: 'q2', text: 'Determine the zeroes of x^2 - 5x + 6.', year: 2019 }];
    const existingRefs = [{ clusterId: 'cluster-9', text: 'Find the roots of x^2 - 5x + 6.', year: 2017, id: 'ref' }];
    const { joins, claimed } = runLexicalPass(pool, existingRefs);
    expect(joins).toEqual([{ clusterId: 'cluster-9', questionId: 'q2', similarity: null }]);
    expect(claimed.has('q2')).toBe(true);
  });
});

describe('runSemanticPass', () => {
  const embA = [1, 0, 0];
  const embAClose = [0.99, 0.14, 0]; // cosine ~0.99, above threshold
  const embFar = [0, 1, 0]; // cosine 0, far below threshold

  test('clusters two questions whose embeddings exceed the semantic threshold', () => {
    const pool = [
      { id: 'q1', text: 'irrelevant text A', year: 2016, embedding: embA },
      { id: 'q2', text: 'irrelevant text B', year: 2021, embedding: embAClose },
    ];
    const { newClusters, claimed } = runSemanticPass(pool, []);
    expect(newClusters).toHaveLength(1);
    expect(newClusters[0].method).toBe('semantic');
    expect(claimed).toEqual(new Set(['q1', 'q2']));
    // similarity is stored vs. the deterministic reference (earliest year = q1); the
    // reference member itself carries null, the other carries the real cosine value.
    const byId = Object.fromEntries(newClusters[0].members.map((m) => [m.questionId, m.similarity]));
    expect(byId.q1).toBeNull();
    expect(byId.q2).toBeGreaterThan(0.85);
  });

  test('does not cluster embeddings below the threshold', () => {
    const pool = [
      { id: 'q1', text: 'A', year: 2016, embedding: embA },
      { id: 'q2', text: 'B', year: 2021, embedding: embFar },
    ];
    const { newClusters, claimed } = runSemanticPass(pool, []);
    expect(newClusters).toEqual([]);
    expect(claimed.size).toBe(0);
  });

  test('questions with no embedding yet are skipped, never compared', () => {
    const pool = [
      { id: 'q1', text: 'A', year: 2016, embedding: embA },
      { id: 'q2', text: 'B', year: 2021, embedding: null },
    ];
    const { newClusters, claimed } = runSemanticPass(pool, []);
    expect(newClusters).toEqual([]);
    expect(claimed.size).toBe(0);
  });

  test('joins an existing cluster reference by embedding similarity, storing the real cosine value', () => {
    const pool = [{ id: 'q2', text: 'B', year: 2021, embedding: embAClose }];
    const existingRefs = [{ clusterId: 'cluster-5', text: 'A', year: 2016, id: 'ref', embedding: embA }];
    const { joins, claimed } = runSemanticPass(pool, existingRefs);
    expect(joins).toHaveLength(1);
    expect(joins[0].clusterId).toBe('cluster-5');
    expect(joins[0].similarity).toBeGreaterThan(0.85);
    expect(claimed.has('q2')).toBe(true);
  });
});

describe('planChapterClustering — pass ordering & one-cluster-per-question', () => {
  test('a question claimed by the exact pass is never re-considered by lexical/semantic', () => {
    const pool = [
      { id: 'q1', text: 'force = 20N, mass = 4kg', year: 2018, embedding: [1, 0] },
      { id: 'q2', text: 'force = 15N, mass = 3kg', year: 2020, embedding: [1, 0] }, // would ALSO match semantically
    ];
    const plan = planChapterClustering({ pool, existingRefs: [] });
    // Exactly one cluster created (by the exact pass), not two.
    expect(plan.newClusters).toHaveLength(1);
    expect(plan.newClusters[0].method).toBe('exact');
  });

  test('runs exact, then lexical, then semantic, each over what remains', () => {
    const pool = [
      { id: 'q1', text: 'force = 20N, mass = 4kg', year: 2018 }, // exact pair with q2
      { id: 'q2', text: 'force = 15N, mass = 3kg', year: 2020 },
      { id: 'q3', text: 'Find the roots of x^2 - 5x + 6.', year: 2017 }, // lexical pair with q4
      { id: 'q4', text: 'Determine the zeroes of x^2 - 5x + 6.', year: 2019 },
      { id: 'q5', text: 'irrelevant', year: 2016, embedding: [1, 0, 0] }, // semantic pair with q6
      { id: 'q6', text: 'unrelated wording', year: 2021, embedding: [0.99, 0.14, 0] },
    ];
    const plan = planChapterClustering({ pool, existingRefs: [] });
    const methods = plan.newClusters.map((c) => c.method).sort();
    expect(methods).toEqual(['exact', 'lexical', 'semantic']);
    expect(plan.newClusters.reduce((n, c) => n + c.members.length, 0)).toBe(6);
  });
});

describe('occurrenceCount', () => {
  const sitting = (overrides) => ({ questionId: 'x', boardId: 'CBSE', subjectId: 'math10', year: 2020, examType: 'annual', translationOfId: null, ...overrides });

  test('is COUNT(DISTINCT sitting), not a row count', () => {
    const members = [sitting({ questionId: 'a', year: 2018 }), sitting({ questionId: 'b', year: 2019 }), sitting({ questionId: 'c', year: 2022 })];
    expect(occurrenceCount(members)).toEqual({ count: 3, years: [2018, 2019, 2022] });
  });

  test('a question duplicated within the SAME paper collapses to ONE occurrence', () => {
    const members = [
      sitting({ questionId: 'a', year: 2020, examType: 'annual' }),
      sitting({ questionId: 'a-dup', year: 2020, examType: 'annual' }), // same sitting tuple
    ];
    expect(occurrenceCount(members).count).toBe(1);
  });

  test('MULTI-SET/SERIES: sibling sets of ONE sitting (same year+examType, different setLabel/examPaperId) collapse to ONE occurrence, per the approved Phase 3 architecture-review fix', () => {
    const members = [
      sitting({ questionId: 'set1', year: 2022, examType: 'annual' }),
      sitting({ questionId: 'set2', year: 2022, examType: 'annual' }),
      sitting({ questionId: 'set3', year: 2022, examType: 'annual' }),
    ];
    expect(occurrenceCount(members)).toEqual({ count: 1, years: [2022] });
  });

  test('a genuine different-year recurrence is NOT collapsed', () => {
    const members = [sitting({ questionId: 'a', year: 2020 }), sitting({ questionId: 'b', year: 2022 })];
    expect(occurrenceCount(members).count).toBe(2);
  });

  test('a different examType in the SAME year is a distinct sitting (compartment vs annual)', () => {
    const members = [
      sitting({ questionId: 'a', year: 2021, examType: 'annual' }),
      sitting({ questionId: 'b', year: 2021, examType: 'compartment' }),
    ];
    expect(occurrenceCount(members).count).toBe(2);
  });

  test('translation pairs collapse to their canonical target\'s sitting', () => {
    const members = [
      sitting({ questionId: 'en', year: 2020, boardId: 'BSEB' }),
      sitting({ questionId: 'hi', year: 2020, boardId: 'BSEB', translationOfId: 'en' }),
    ];
    const targets = new Map([['en', { boardId: 'BSEB', subjectId: 'math10', year: 2020, examType: 'annual' }]]);
    expect(occurrenceCount(members, targets).count).toBe(1);
  });

  test('an unresolvable translation target falls back to the row\'s own sitting rather than dropping it', () => {
    const members = [sitting({ questionId: 'hi', translationOfId: 'missing-id', year: 2023 })];
    expect(occurrenceCount(members, new Map()).count).toBe(1);
  });

  test('out-of-range years are excluded by yearFrom/yearTo', () => {
    const members = [sitting({ questionId: 'a', year: 2015 }), sitting({ questionId: 'b', year: 2020 }), sitting({ questionId: 'c', year: 2024 })];
    expect(occurrenceCount(members, new Map(), { yearFrom: 2018, yearTo: 2022 })).toEqual({ count: 1, years: [2020] });
  });

  test('an empty member list is zero occurrences, not an error', () => {
    expect(occurrenceCount([])).toEqual({ count: 0, years: [] });
  });
});

describe('embedText', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  test('returns the embedding on a successful call', async () => {
    const { mock } = mockGeminiFetch([{ status: 200, json: { embedding: { values: [0.1, 0.2, 0.3] } } }]);
    const result = await embedText({ apiKey: 'k', text: 'hello' });
    expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  test('retries a transient 429 then succeeds', async () => {
    mockGeminiFetch([geminiRateLimited(0), { status: 200, json: { embedding: { values: [1, 2] } } }]);
    const result = await embedText({ apiKey: 'k', text: 'hello', backoffBaseMs: 1, backoffCapMs: 1, sleep: () => Promise.resolve() });
    expect(result.embedding).toEqual([1, 2]);
  });

  test('throws with .status=429 once retries are exhausted', async () => {
    mockGeminiFetch([geminiRateLimited(0)]);
    await expect(
      embedText({ apiKey: 'k', text: 'hello', maxRetries: 0, sleep: () => Promise.resolve() })
    ).rejects.toMatchObject({ status: 429 });
  });

  test('throws INVALID_AI_RESPONSE when the response has no embedding.values array', async () => {
    mockGeminiFetch([{ status: 200, json: { notAnEmbedding: true } }]);
    await expect(embedText({ apiKey: 'k', text: 'hello' })).rejects.toMatchObject({ code: 'INVALID_AI_RESPONSE' });
  });
});
