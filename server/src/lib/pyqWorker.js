// PYQ per-page extraction worker — Phase 3 (docs/pyq-implementation-plan.md
// §8/§17). Owns the DB-persisting work for one page's extraction — shared by
// BOTH the POST /api/admin/pyq/papers/:id/extract route AND the standalone
// polling loop below, so this logic exists in exactly one place.
//
// WHY A POLLING LOOP, NOT A QUEUE LIBRARY: no queue/job library exists in
// this codebase (confirmed absent from package.json) and none is introduced
// here — §17 locks this decision explicitly. A simple loop selecting the
// next ExamPaper with an unfinished extractionState, processing one page at
// a time with a pacing delay between iterations, is this feature's entire
// "async ingestion" story at this scale.
const { extractPyqPage } = require('../attachments/extractPyqPage');
const { classifyPyqQuestions } = require('../attachments/classifyPyqChapter');

class PyqExtractionError extends Error {
  constructor(message, { code, status, metrics } = {}) {
    super(message);
    this.name = 'PyqExtractionError';
    this.code = code;
    this.status = status;
    this.metrics = metrics;
  }
}

/** Same shape as PyqExtractionError, kept as its own named class (Phase 5) so a caller can tell the two failure kinds apart if it ever needs to. */
class PyqClassificationError extends Error {
  constructor(message, { code, status, metrics } = {}) {
    super(message);
    this.name = 'PyqClassificationError';
    this.code = code;
    this.status = status;
    this.metrics = metrics;
  }
}

/** Builds { "1": "pending", ..., "N": "pending" } for a known page count. */
function buildInitialExtractionState(pageCount) {
  const state = {};
  for (let i = 1; i <= pageCount; i += 1) state[String(i)] = 'pending';
  return state;
}

/** Tolerant parse — malformed/absent JSON is treated as "nothing recorded yet". */
function parseExtractionState(json) {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** Lowest-numbered page still "pending", or null if none (including an empty state). */
function nextPendingPage(stateMap) {
  const pending = Object.keys(stateMap)
    .filter((k) => stateMap[k] === 'pending')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  if (pending.length === 0) return null;
  return Math.min(...pending);
}

/**
 * The ExamPaper-level status implied by an extractionState map, per §7's
 * status vocabulary: 'extracting' while any page is still pending (or the
 * map is empty, i.e. page count unknown and nothing attempted yet),
 * 'extraction_failed' only when EVERY known page ended in 'failed' — the
 * §19 "every page failed → protected/corrupted, not a retry-forever signal"
 * rule — otherwise 'needs_review' once nothing is pending and at least one
 * page succeeded.
 */
function computePaperStatus(stateMap) {
  const values = Object.values(stateMap);
  if (values.length === 0) return 'extracting';
  if (values.some((v) => v === 'pending')) return 'extracting';
  if (values.every((v) => v === 'failed')) return 'extraction_failed';
  return 'needs_review';
}

/**
 * Best-effort parent-question resolution: sub-parts almost always follow
 * their parent's page in a real board paper, so a same-paper lookup by exact
 * questionNumber covers the common case. Never invented — a
 * parentQuestionNumber with no matching row is left unresolved (null), not
 * guessed at or fabricated (§19's "never invented by the app to force a
 * fit" rule, applied here to linkage rather than a missing field).
 * @param {import('@prisma/client').PrismaClient} prisma a plain client or an interactive-transaction client
 */
async function resolveParentQuestionId(prisma, examPaperId, parentQuestionNumber) {
  if (!parentQuestionNumber) return null;
  const parent = await prisma.question.findFirst({
    where: { examPaperId, questionNumber: parentQuestionNumber },
    select: { id: true },
  });
  return parent ? parent.id : null;
}

/**
 * Extracts ONE page of ONE paper and persists the result. Shared core used
 * by both routes/adminPyq.js's POST .../extract and runPyqWorkerLoop below.
 *
 * IDEMPOTENCY: re-extracting a page first deletes only THAT page's Question
 * rows still at reviewStatus 'extracted' (i.e. never human-touched) before
 * inserting the fresh set, so a retried/duplicate call never produces
 * duplicate rows. A page with any already-reviewed row is refused outright
 * (PAGE_ALREADY_REVIEWED) rather than silently overwritten — reviewed
 * content is never clobbered by a later re-extraction.
 *
 * TRUST BOUNDARY: correctAnswer is only ever persisted when the extracted
 * question's own hasOfficialAnswer is true — enforced HERE, in code,
 * independent of (and on top of) the prompt instruction and the Zod
 * superRefine in lib/pyqExtractionSchema.js. Three independent layers for
 * the same rule, not one.
 *
 * @param {{ prisma: import('@prisma/client').PrismaClient, gemini: import('../gemini').GeminiService,
 *   examPaperId: string, pageNumber?: number, correlationId?: string }} params
 * @returns {Promise<{ pageNumber: number, status: 'done', questionCount: number, paperStatus: string }>}
 */
async function extractAndPersistPage({ prisma, gemini, examPaperId, pageNumber, correlationId }) {
  const paper = await prisma.examPaper.findUnique({
    where: { id: examPaperId },
    include: { sourceDocument: { select: { data: true, mimeType: true, pageCount: true, extractionState: true } } },
  });
  if (!paper) throw new PyqExtractionError('Paper not found.', { code: 'NOT_FOUND', status: 404 });
  if (!paper.sourceDocument) throw new PyqExtractionError('Paper has no source document.', { code: 'NOT_FOUND', status: 404 });
  if (paper.status === 'published' || paper.status === 'archived') {
    throw new PyqExtractionError('This paper is no longer extractable.', { code: 'NOT_EXTRACTABLE', status: 409 });
  }

  let stateMap = parseExtractionState(paper.sourceDocument.extractionState);
  if (Object.keys(stateMap).length === 0 && paper.sourceDocument.pageCount) {
    stateMap = buildInitialExtractionState(paper.sourceDocument.pageCount);
  }

  let target = pageNumber;
  if (target == null) {
    target = nextPendingPage(stateMap);
    if (target == null) {
      const pageCountKnown = Object.keys(stateMap).length > 0;
      throw new PyqExtractionError(
        pageCountKnown
          ? 'Every known page has already been processed.'
          : "This document's page count could not be determined — specify a page number explicitly.",
        { code: pageCountKnown ? 'NOTHING_TO_EXTRACT' : 'PAGE_NUMBER_REQUIRED', status: 409 }
      );
    }
  } else {
    if (!Number.isInteger(target) || target < 1) {
      throw new PyqExtractionError('page must be a positive integer.', { code: 'INVALID_FIELDS', status: 400 });
    }
    if (paper.sourceDocument.pageCount && target > paper.sourceDocument.pageCount) {
      throw new PyqExtractionError(
        `This document has an estimated ${paper.sourceDocument.pageCount} pages; page ${target} is out of range.`,
        { code: 'INVALID_FIELDS', status: 400 }
      );
    }
    if (!(String(target) in stateMap)) stateMap[String(target)] = 'pending';
  }

  const existingRows = await prisma.question.findMany({
    where: { examPaperId, pageNumber: target },
    select: { id: true, reviewStatus: true },
  });
  if (existingRows.some((q) => q.reviewStatus !== 'extracted')) {
    throw new PyqExtractionError(
      'This page has already-reviewed questions and cannot be silently re-extracted.',
      { code: 'PAGE_ALREADY_REVIEWED', status: 409 }
    );
  }

  // Persist the "an attempt is in flight" state BEFORE calling Gemini, not
  // only after: a transient failure (429/5xx/timeout) below throws without
  // ever reaching the success/failure writes further down, and a paper that
  // has never had extractionState written reads back as "no progress
  // recorded" (null) rather than the real, in-progress page-1-pending state.
  // §7's status vocabulary treats 'extracting' as the normal state the
  // moment extraction is first attempted, not only once a page finishes.
  stateMap[String(target)] = 'pending';
  await prisma.sourceDocument.update({ where: { examPaperId }, data: { extractionState: JSON.stringify(stateMap) } });
  if (paper.status === 'uploaded') {
    await prisma.examPaper.update({ where: { id: examPaperId }, data: { status: 'extracting' } });
  }

  let extraction;
  try {
    extraction = await extractPyqPage({
      gemini,
      pdfBuffer: Buffer.from(paper.sourceDocument.data),
      mimeType: paper.sourceDocument.mimeType,
      pageNumber: target,
      totalPages: paper.sourceDocument.pageCount || undefined,
      language: paper.language,
      correlationId,
    });
  } catch (err) {
    if (err.code === 'INVALID_AI_RESPONSE') {
      // A malformed/schema-invalid response is a content problem, not a
      // transient one — mark this page 'failed' so it's visibly, independently
      // retriable (§8) without blocking any other page in the document.
      stateMap[String(target)] = 'failed';
      await prisma.sourceDocument.update({ where: { examPaperId }, data: { extractionState: JSON.stringify(stateMap) } });
      await prisma.examPaper.update({ where: { id: examPaperId }, data: { status: computePaperStatus(stateMap) } });
      throw new PyqExtractionError(
        'The AI response for this page was malformed or did not match the expected structure.',
        { code: 'INVALID_AI_RESPONSE', status: 502, metrics: err.metrics }
      );
    }
    // Transient (429/5xx/timeout/network) or a safety block: leave the page
    // 'pending' so it stays independently retriable — never poisoned by a
    // quota/network hiccup that has nothing to do with the page's content.
    throw err;
  }

  const staleIds = existingRows.filter((q) => q.reviewStatus === 'extracted').map((q) => q.id);

  await prisma.$transaction(async (tx) => {
    if (staleIds.length > 0) {
      await tx.question.deleteMany({ where: { id: { in: staleIds } } });
    }
    for (const q of extraction.questions) {
      const rawIndex = extraction.questions.indexOf(q);
      const parentQuestionId = await resolveParentQuestionId(tx, examPaperId, q.parentQuestionNumber);
      await tx.question.create({
        data: {
          examPaperId,
          boardId: paper.boardId,
          subjectId: paper.subjectId,
          classLevel: paper.classLevel,
          year: paper.year,
          questionNumber: q.questionNumber,
          parentQuestionId,
          requiresGroupSelection: q.requiresGroupSelection,
          language: q.language,
          type: q.type,
          text: q.text,
          options: q.type === 'mcq' && q.options.length > 0 ? JSON.stringify(q.options) : null,
          marks: q.marks,
          correctAnswer: q.hasOfficialAnswer ? q.correctAnswer : null,
          hasOfficialAnswer: q.hasOfficialAnswer,
          pageNumber: target,
          hasDiagram: q.hasDiagram,
          hasTable: q.hasTable,
          rawExtraction: JSON.stringify(extraction.rawQuestions[rawIndex] ?? q),
          extractionConfidence: q.confidence,
        },
      });
    }
    stateMap[String(target)] = 'done';
    await tx.sourceDocument.update({ where: { examPaperId }, data: { extractionState: JSON.stringify(stateMap) } });
    await tx.examPaper.update({ where: { id: examPaperId }, data: { status: computePaperStatus(stateMap) } });
  });

  return {
    pageNumber: target,
    status: 'done',
    questionCount: extraction.questions.length,
    paperStatus: computePaperStatus(stateMap),
  };
}

/**
 * Classifies ONE page's worth of already-extracted, not-yet-classified
 * questions (reviewStatus 'extracted' AND chapterId null) into the paper's
 * subject's pre-seeded chapter/topic taxonomy — Phase 5 (§9/§20). Shared
 * core used by routes/adminPyq.js's POST .../classify, mirroring
 * extractAndPersistPage's own shape exactly.
 *
 * TRIGGER CONDITION IS THE IDEMPOTENCY GUARANTEE: a question drops out of
 * this function's own target set the moment it gets a chapterId (AI-proposed
 * OR human-confirmed), so re-running classification on an already-classified
 * page is a safe no-op — it can never overwrite a reviewer's correction,
 * because a reviewer's correction (routes/adminPyq.js's PATCH) is exactly
 * what sets chapterId to a non-null value in the first place.
 *
 * REJECTED/APPROVED QUESTIONS ARE NEVER TARGETED: the trigger condition
 * requires reviewStatus 'extracted', which a question leaves the moment a
 * human PATCHes, approves, or rejects it (routes/adminPyq.js moves it to
 * 'reviewed' on first edit) — classification never touches human-reviewed
 * rows, matching §12's "nothing here does any classification... over
 * anything but Phase 3's freshly extracted rows" scope line.
 *
 * @param {{ prisma: import('@prisma/client').PrismaClient, gemini: import('../gemini').GeminiService,
 *   examPaperId: string, pageNumber?: number, correlationId?: string }} params
 * @returns {Promise<{ pageNumber: number, status: 'done', classifiedCount: number, unclassifiedCount: number }>}
 */
async function classifyAndPersistPage({ prisma, gemini, examPaperId, pageNumber, correlationId }) {
  const paper = await prisma.examPaper.findUnique({ where: { id: examPaperId } });
  if (!paper) throw new PyqClassificationError('Paper not found.', { code: 'NOT_FOUND', status: 404 });

  let target = pageNumber;
  if (target == null) {
    const nextRow = await prisma.question.findFirst({
      where: { examPaperId, reviewStatus: 'extracted', chapterId: null },
      orderBy: [{ pageNumber: 'asc' }, { questionNumber: 'asc' }],
      select: { pageNumber: true },
    });
    if (!nextRow || nextRow.pageNumber == null) {
      throw new PyqClassificationError('Nothing on this paper currently needs classification.', {
        code: 'NOTHING_TO_CLASSIFY', status: 409,
      });
    }
    target = nextRow.pageNumber;
  } else if (!Number.isInteger(target) || target < 1) {
    throw new PyqClassificationError('page must be a positive integer.', { code: 'INVALID_FIELDS', status: 400 });
  }

  const chapters = await prisma.chapter.findMany({
    where: { subjectId: paper.subjectId },
    orderBy: { sequence: 'asc' },
    include: { topics: { select: { id: true, name: true } } },
  });
  if (chapters.length === 0) {
    throw new PyqClassificationError(
      'No chapter taxonomy is seeded for this subject yet — run the syllabus seed first.',
      { code: 'NO_TAXONOMY', status: 409 }
    );
  }

  const targetRows = await prisma.question.findMany({
    where: { examPaperId, pageNumber: target, reviewStatus: 'extracted', chapterId: null },
    select: { id: true, text: true },
  });
  if (targetRows.length === 0) {
    throw new PyqClassificationError('This page has nothing that currently needs classification.', {
      code: 'NOTHING_TO_CLASSIFY', status: 409,
    });
  }

  let result;
  try {
    result = await classifyPyqQuestions({
      gemini,
      questions: targetRows,
      chapters: chapters.map((c) => ({ id: c.id, name: c.name, topics: c.topics })),
      language: paper.language,
      correlationId,
    });
  } catch (err) {
    if (err.code === 'INVALID_AI_RESPONSE') {
      throw new PyqClassificationError(
        'The AI response for this page\'s classification was malformed or did not match the expected structure.',
        { code: 'INVALID_AI_RESPONSE', status: 502, metrics: err.metrics }
      );
    }
    throw err; // transient (429/5xx/timeout/network) — surfaced as-is, independently retriable, nothing persisted yet
  }

  await prisma.$transaction(async (tx) => {
    for (const c of result.classifications) {
      await tx.question.update({ where: { id: c.questionId }, data: { chapterId: c.chapterId } });
      for (const topicId of c.topicIds) {
        await tx.questionTopic.create({ data: { questionId: c.questionId, topicId, source: 'ai' } });
      }
    }
  });

  return {
    pageNumber: target,
    status: 'done',
    classifiedCount: result.classifications.length,
    unclassifiedCount: result.unclassifiedQuestionIds.length,
  };
}

/**
 * Finds the oldest ExamPaper still needing extraction (status 'uploaded' or
 * 'extracting') and extracts its next pending page. Returns null when
 * nothing is currently extractable.
 */
async function extractNextAvailablePage({ prisma, gemini, correlationId }) {
  const candidate = await prisma.examPaper.findFirst({
    where: { status: { in: ['uploaded', 'extracting'] } },
    orderBy: [{ createdAt: 'asc' }],
    select: { id: true },
  });
  if (!candidate) return null;
  return extractAndPersistPage({ prisma, gemini, examPaperId: candidate.id, correlationId });
}

/**
 * The polling loop named in §17: repeatedly extracts the next available
 * page, sleeping `intervalMs` between iterations to respect Gemini's
 * per-minute pacing, until `shouldStop()` says to quit. A failure on one
 * page/paper never stops the loop — logged (metadata only, see below) and
 * skipped, matching §8's per-page independence.
 *
 * NEVER LOGS DOCUMENT/RESPONSE CONTENT: only error codes/statuses, the same
 * discipline gemini.js's own err.metrics already carries — no prompt text,
 * no extracted question text, no raw Gemini response body ever reaches a
 * log line here.
 */
async function runPyqWorkerLoop({ prisma, gemini, intervalMs = 4000, shouldStop = () => false, logger = console }) {
  while (!shouldStop()) {
    try {
      const result = await extractNextAvailablePage({ prisma, gemini });
      if (result) {
        logger.log(`[pyqWorker] extracted page ${result.pageNumber} (${result.questionCount} questions), paper status: ${result.paperStatus}.`);
      }
    } catch (err) {
      if (err.status === 429) {
        logger.warn('[pyqWorker] quota exhausted — pausing rather than retrying against the wall.');
      } else {
        logger.error('[pyqWorker] page extraction failed', { code: err.code, status: err.status });
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/* istanbul ignore if -- real standalone entry point, not exercised by tests */
if (require.main === module) {
  // `node src/lib/pyqWorker.js` — a real operator starts this explicitly
  // once a paid Gemini tier is active (§17 / Phase 0's locked prerequisite).
  // Never auto-run by the app itself — same "constructed, available, never
  // auto-run" precedent index.js already documents for the idle pyqGemini
  // instance.
  const { prisma } = require('./db');
  const { GeminiService } = require('../gemini');
  const gemini = new GeminiService({
    apiKey: process.env.GEMINI_API_KEY,
    endpoint: process.env.PYQ_GEMINI_ENDPOINT || process.env.GEMINI_ENDPOINT,
    timeoutMs: 30000,
    maxRetries: 2,
    maxContinuations: 0,
  });
  runPyqWorkerLoop({ prisma, gemini }).catch((err) => {
    console.error('[pyqWorker] fatal error, exiting', { code: err.code, status: err.status });
    process.exit(1);
  });
}

module.exports = {
  PyqExtractionError,
  PyqClassificationError,
  buildInitialExtractionState,
  parseExtractionState,
  nextPendingPage,
  computePaperStatus,
  resolveParentQuestionId,
  extractAndPersistPage,
  classifyAndPersistPage,
  extractNextAvailablePage,
  runPyqWorkerLoop,
};
