// selectPyqPaper() — Phase 8 (docs/pyq-implementation-plan.md §10). The
// single, pure, deterministic selection/ranking module the plan names as
// "the trickiest pure-logic code in the feature" and "the single
// highest-risk new module." No Prisma import, no Gemini call, no
// Math.random() anywhere — mirrors lib/pyqClustering.js's own "genuinely
// DB-free" precedent so the whole algorithm is unit-testable against plain
// fixture data, with the caller (routes/resources.js) doing every read.
//
// INPUT CONTRACT (deliberately narrow — everything DB-shaped is resolved by
// the caller before this module ever runs):
//   candidates: Array<PyqCandidate> — the SQL-filtered eligible pool
//     (reviewStatus: 'approved' AND ExamPaper.status: 'published', board/
//     subject/classLevel/language/year-range already applied by the caller's
//     query — §10 step 1). Each candidate:
//       { id, examPaperId, year, chapterId, type, marks, questionNumber,
//         parentQuestionId, requiresGroupSelection, partIds,
//         confirmedClusterId, pageNumber, text, options, correctAnswer,
//         hasOfficialAnswer, hasDiagram, hasTable }
//     `confirmedClusterId` is the id of a QuestionCluster this question is a
//     member of ONLY IF that cluster's status is 'confirmed' — never
//     'proposed'/'rejected'. This is not an invented rule: §7's status table
//     and §9 both state "a machine-proposed cluster never affects a
//     teacher-visible recurrence count until confirmed," so a question whose
//     only cluster membership is unconfirmed is treated exactly like an
//     unclustered question here (its own singleton occurrence, its own
//     dedup bucket) — never silently promoted to "recurring" on a machine
//     guess a human hasn't signed off on. The caller (not this module)
//     resolves cluster status before building `confirmedClusterId`.
//     `partIds` is the full list of this row's Question.parts child ids
//     (only meaningful when requiresGroupSelection is true), regardless of
//     whether every part is itself in `candidates` — allPartsAvailable below
//     is exactly the check for that.
//   clusterMembers: Map<clusterId, Array<{boardId, subjectId, year,
//     examType, translationOfId}>> — full membership (sitting info only) for
//     every confirmedClusterId referenced by `candidates`, used to compute
//     occurrenceCount via lib/pyqClustering.js's own function (§9's
//     pseudocode) rather than a second, drifted copy of that math.
//   request: { yearFrom, yearTo, totalMarks, questionCount, questionType,
//     prioritizeRecurring } — questionType is a single optional filter
//     value (not a per-type mix), matching §14's API table over §10's more
//     abstract `typeMix?` — confirmed with the product owner before writing
//     this module (docs/pyq-implementation-plan.md Phase 8 completion
//     record has the full record of that decision).
//
// OUTPUT CONTRACT:
//   Success: { ok: true, questions: PyqCandidate[] (§'s own scored/ordered
//     rows, each carrying recurrenceScore/recencyScore/score/
//     recurrenceCount/occurrenceYears for §9's reproducibility guarantee),
//     marksUsed, questionCount }
//   Failure: { ok: false, code: 'NO_CANDIDATES' | 'INSUFFICIENT_PYQ_POOL',
//     error: string, diagnostic: {...} } — never a silently short/wrong
//     paper (§10's own explicit instruction, mirrored from
//     routes/resources.js's checkAgainstRequest/502 INVALID_AI_RESPONSE
//     precedent for a different failure family).

const { occurrenceCount } = require('./pyqClustering');

// Bounded, cheap, deterministic — NOT a general bin-packing solver (§10's own
// explicit framing: "general bin-packing is NP-hard... adequate at this
// corpus's realistic scale (question counts <= ~30, a small set of common
// marks values)"). No exact attempt count is specified anywhere in the plan
// (unlike the marks-weighting formula or the 0.4 chapter-share cap, which
// ARE given exact numbers) — 50 is chosen the same way Phase 6 chose its own
// lexical-similarity threshold: documented here, not hidden, and cheap
// enough that even a full 50-attempt search over a <=30-question pool never
// approaches a real performance concern.
const MAX_SWAP_ATTEMPTS = 50;

// A question never classified into a chapter (chapterId: null — a real,
// tested-reachable state per Phase 7's own "does NOT require classification"
// test) still needs SOME bucket for the MAX_SHARE_PER_CHAPTER cap, or it
// would silently escape the cap entirely. Every unclassified question shares
// ONE bucket (this sentinel), same "no single [chapter] dominates" spirit
// §10 states for real chapters.
const UNCLASSIFIED_CHAPTER_KEY = '__unclassified__';

function chapterKey(chapterId) {
  return chapterId || UNCLASSIFIED_CHAPTER_KEY;
}

/**
 * A question with no CONFIRMED cluster membership (never clustered at all,
 * or only a member of a still-proposed/rejected cluster) gets its own
 * singleton dedup bucket — so two independent, never-linked questions can
 * both appear in the same generated paper, while two members of the SAME
 * confirmed cluster still cannot (§10's usedClusters rule, "no duplicate
 * concept in one paper").
 */
function effectiveClusterKey(candidate) {
  return candidate.confirmedClusterId ? `cluster:${candidate.confirmedClusterId}` : `standalone:${candidate.id}`;
}

/** Fixed total order (§10): score desc, occurrenceCount desc, year desc, id asc. */
function compareCandidates(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (b.recurrenceCount !== a.recurrenceCount) return b.recurrenceCount - a.recurrenceCount;
  if (b.year !== a.year) return b.year - a.year;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * A deterministic diagnostic template (§10: "Options considered and
 * rejected: silently generating a smaller paper... or a vague 'relax your
 * filters' prompt" — this is the specific-counts alternative that was kept),
 * not a generated message — mirrors explainShortfall's own name from §10's
 * pseudocode exactly.
 */
function explainShortfall({ poolSize, selectedCount, marksUsed, questionCount, totalMarks }) {
  return {
    message: `Found ${selectedCount} of ${questionCount} questions and ${marksUsed} of ${totalMarks} marks for these filters. Try widening the year range or lowering the question count.`,
    found: { questions: selectedCount, marks: marksUsed },
    requested: { questions: questionCount, marks: totalMarks },
    candidatePoolSize: poolSize,
  };
}

/**
 * Builds the atomic "unit" a greedy pick actually adds: a standalone
 * question, or — for a requiresGroupSelection PARENT (true only on parents,
 * per schema.prisma's own comment) — the parent plus every one of its parts,
 * added/removed together. A group counts as exactly ONE toward
 * `questionCount` (matching how a real board paper numbers a multi-part item
 * as one question, e.g. "5(a)/5(b)/5(c)"), while its marks are the SUM of
 * every member row's own `marks` (each row is a faithful, independent
 * transcription of its own printed sub-part, per §7/§8 — summing is not an
 * invented value, it is what the source paper's own per-part marks already
 * say). This grouping semantic is a documented interpretation of §10's named
 * `allPartsAvailable(q)` guard, not specified further by the plan — recorded
 * in the Phase 8 completion record as an implementation detail, not a
 * silent product decision, since the MVP corpus has no real multi-part data
 * yet to contradict it.
 */
function buildUnit(root, byId) {
  if (!root.requiresGroupSelection) {
    return {
      rootId: root.id,
      members: [root],
      marks: root.marks,
      type: root.type,
      chapterKey: chapterKey(root.chapterId),
      clusterKey: effectiveClusterKey(root),
    };
  }
  const parts = (root.partIds || []).map((pid) => byId.get(pid)).filter(Boolean);
  const members = [root, ...parts];
  return {
    rootId: root.id,
    members,
    marks: members.reduce((sum, m) => sum + m.marks, 0),
    type: root.type,
    chapterKey: chapterKey(root.chapterId),
    clusterKey: effectiveClusterKey(root),
  };
}

function allPartsAvailable(root, byId) {
  if (!root.partIds || root.partIds.length === 0) return false; // nothing to group with — never satisfiable
  return root.partIds.every((pid) => byId.has(pid));
}

/**
 * Bounded single-swap repair (§10 step 5): tries to close the gap between
 * `marksUsed` and `totalMarks` by replacing exactly one currently-selected
 * unit with exactly one not-yet-selected eligible unit, picking the FIRST
 * swap (in a fixed, deterministic nested scan: selected units in their
 * existing order x remaining root candidates in sorted order) that makes
 * marksUsed strictly closer to totalMarks without breaking any constraint.
 * Never a general optimizer — one swap per call, bounded by MAX_SWAP_ATTEMPTS
 * calls from the caller.
 */
function findSingleSwap({
  selectedUnits, remainingRoots, byId, marksUsed, totalMarks, chapterCounts, usedClusters, questionType, maxSharePerChapter,
}) {
  const gap = totalMarks - marksUsed;
  if (gap === 0) return null;

  for (let i = 0; i < selectedUnits.length; i += 1) {
    const out = selectedUnits[i];
    const marksWithoutOut = marksUsed - out.marks;
    const chapterCountWithoutOut = (chapterCounts.get(out.chapterKey) || 0) - 1;

    for (const root of remainingRoots) {
      if (questionType && root.type !== questionType) continue;
      const inUnit = buildUnit(root, byId);
      if (inUnit.clusterKey === out.clusterKey) continue; // would be a same-unit no-op, never a real swap
      if (usedClusters.has(inUnit.clusterKey)) continue; // already used by a DIFFERENT still-selected unit
      if (root.requiresGroupSelection && !allPartsAvailable(root, byId)) continue;

      const newMarks = marksWithoutOut + inUnit.marks;
      if (newMarks > totalMarks) continue;

      const inChapterAlreadyCounted = inUnit.chapterKey === out.chapterKey;
      const inChapterCountAfter = (inChapterAlreadyCounted ? chapterCountWithoutOut : (chapterCounts.get(inUnit.chapterKey) || 0)) + 1;
      if (!inChapterAlreadyCounted && inChapterCountAfter > maxSharePerChapter) continue;

      if (Math.abs(totalMarks - newMarks) < Math.abs(gap)) {
        return { outIndex: i, out, inUnit, inRoot: root };
      }
    }
  }
  return null;
}

/**
 * @param {{candidates: object[], clusterMembers?: Map, request: object}} params
 */
function selectPyqPaper({ candidates, clusterMembers = new Map(), request }) {
  const {
    yearFrom, yearTo, totalMarks, questionCount, questionType, prioritizeRecurring,
  } = request;

  if (!candidates || candidates.length === 0) {
    return {
      ok: false,
      code: 'NO_CANDIDATES',
      error: 'No published PYQ content yet for these filters.',
      diagnostic: explainShortfall({
        poolSize: 0, selectedCount: 0, marksUsed: 0, questionCount, totalMarks,
      }),
    };
  }

  // ---- 2: score (deterministic, no randomness) --------------------------
  const occurrenceCache = new Map(); // confirmedClusterId -> {count, years}
  function occurrenceFor(candidate) {
    if (!candidate.confirmedClusterId) return { count: 1, years: [candidate.year] };
    if (occurrenceCache.has(candidate.confirmedClusterId)) return occurrenceCache.get(candidate.confirmedClusterId);
    const members = clusterMembers.get(candidate.confirmedClusterId) || [];
    const result = occurrenceCount(members, new Map(), { yearFrom, yearTo });
    // A confirmed cluster the candidate itself belongs to always has >=1
    // in-range member in practice (the candidate's own sitting) — this
    // fallback only guards a caller that passed an incomplete
    // clusterMembers map, never masking a real zero.
    const safe = result.count > 0 ? result : { count: 1, years: [candidate.year] };
    occurrenceCache.set(candidate.confirmedClusterId, safe);
    return safe;
  }

  const scored = candidates.map((c) => {
    const occ = occurrenceFor(c);
    return { ...c, recurrenceCount: occ.count, occurrenceYears: occ.years };
  });

  const maxOccurrence = Math.max(1, ...scored.map((c) => c.recurrenceCount));
  const span = Math.max(1, yearTo - yearFrom);
  for (const c of scored) {
    c.recencyScore = (c.year - yearFrom) / span;
    c.recurrenceScore = c.recurrenceCount / maxOccurrence;
    c.score = prioritizeRecurring
      ? 0.7 * c.recurrenceScore + 0.3 * c.recencyScore
      : 0.3 * c.recurrenceScore + 0.7 * c.recencyScore;
  }

  // ---- 3: sort — total, stable order -------------------------------------
  scored.sort(compareCandidates);

  const byId = new Map(scored.map((c) => [c.id, c]));

  // Parts are never picked independently — only ever pulled in as part of
  // their requiresGroupSelection parent's unit (see buildUnit above).
  const partOf = new Set();
  for (const c of scored) {
    if (c.requiresGroupSelection) for (const pid of c.partIds || []) partOf.add(pid);
  }
  const roots = scored.filter((c) => !partOf.has(c.id));

  // ---- 4: greedy constrained fill ----------------------------------------
  const MAX_SHARE_PER_CHAPTER = Math.ceil(questionCount * 0.4);
  const selectedUnits = [];
  const usedClusters = new Set();
  const chapterCounts = new Map();
  let marksUsed = 0;

  for (const root of roots) {
    if (selectedUnits.length >= questionCount) break;
    if (questionType && root.type !== questionType) continue;
    if (root.requiresGroupSelection && !allPartsAvailable(root, byId)) continue;

    const unit = buildUnit(root, byId);
    if (usedClusters.has(unit.clusterKey)) continue; // no duplicate concept in one paper
    if (marksUsed + unit.marks > totalMarks) continue;
    if ((chapterCounts.get(unit.chapterKey) || 0) >= MAX_SHARE_PER_CHAPTER) continue;

    selectedUnits.push(unit);
    usedClusters.add(unit.clusterKey);
    chapterCounts.set(unit.chapterKey, (chapterCounts.get(unit.chapterKey) || 0) + 1);
    marksUsed += unit.marks;
  }

  // ---- 5: bounded exact-marks repair (still fully deterministic) --------
  const selectedRootIds = new Set(selectedUnits.map((u) => u.rootId));
  let remainingRoots = roots.filter((r) => !selectedRootIds.has(r.id) && !usedClusters.has(effectiveClusterKey(r)));

  let attempts = 0;
  while (marksUsed !== totalMarks && attempts < MAX_SWAP_ATTEMPTS) {
    const swap = findSingleSwap({
      selectedUnits, remainingRoots, byId, marksUsed, totalMarks, chapterCounts, usedClusters, questionType, maxSharePerChapter: MAX_SHARE_PER_CHAPTER,
    });
    if (!swap) break;

    const { outIndex, out, inUnit, inRoot } = swap;
    selectedUnits.splice(outIndex, 1, inUnit);
    usedClusters.delete(out.clusterKey);
    usedClusters.add(inUnit.clusterKey);
    chapterCounts.set(out.chapterKey, (chapterCounts.get(out.chapterKey) || 0) - 1);
    chapterCounts.set(inUnit.chapterKey, (chapterCounts.get(inUnit.chapterKey) || 0) + 1);
    marksUsed = marksUsed - out.marks + inUnit.marks;

    const nowSelectedRootIds = new Set(selectedUnits.map((u) => u.rootId));
    remainingRoots = roots.filter((r) => !nowSelectedRootIds.has(r.id) && !usedClusters.has(effectiveClusterKey(r)));
    void inRoot; // (kept in the destructure for readability/debuggability only)
    attempts += 1;
  }

  // ---- 6: validate — never return a silently wrong-total paper ----------
  if (marksUsed !== totalMarks || selectedUnits.length !== questionCount) {
    return {
      ok: false,
      code: 'INSUFFICIENT_PYQ_POOL',
      error: explainShortfall({
        poolSize: candidates.length, selectedCount: selectedUnits.length, marksUsed, questionCount, totalMarks,
      }).message,
      diagnostic: explainShortfall({
        poolSize: candidates.length, selectedCount: selectedUnits.length, marksUsed, questionCount, totalMarks,
      }),
    };
  }

  // Final presentation order: ascending marks then descending year then
  // ascending id — a deterministic, cosmetic-only choice (never affects
  // WHICH questions were chosen, only their print order), matching the
  // "shorter/lower-mark questions first" convention common to real board
  // papers. Documented in the Phase 8 completion record as a disclosed
  // interpretation, since §10 specifies the SELECTION order but not a
  // separate PRESENTATION order for the final paper.
  const questions = selectedUnits
    .flatMap((u) => u.members)
    .sort((a, b) => (a.marks - b.marks) || (b.year - a.year) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    ok: true, questions, marksUsed, questionCount: selectedUnits.length,
  };
}

module.exports = {
  selectPyqPaper,
  explainShortfall,
  MAX_SWAP_ATTEMPTS,
  UNCLASSIFIED_CHAPTER_KEY,
};
