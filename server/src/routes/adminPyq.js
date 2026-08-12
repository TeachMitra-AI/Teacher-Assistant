// PYQ admin ingestion + review — Phase 2 (upload/list/get/source), Phase 3
// (per-page extraction), Phase 4 (human review: list/correct/approve/
// reject), Phase 5 (chapter/topic classification), Phase 6 (cluster review),
// and Phase 7 (publish) slices. Mounted at /api/admin/pyq (see index.js).
//
// Kept SEPARATE from routes/admin.js, mirroring routes/adminSupport.js's own
// convention exactly: every route here is super_admin-only, full stop — PYQ
// content is shared/global, never school-scoped, so there is no schoolScope()
// narrowing to apply (§12: "write access is role-gated; read access is
// feature-flag-gated" — and only the TEACHER-FACING read/generation endpoints
// added in a later phase are flag-gated; admin ingestion is role-gated only).
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired, requireRole } = require('../middleware/auth');
const { validatePyqSourceDocument } = require('../lib/pyqFileValidation');
const { parseIntEnv } = require('../lib/config');
const { LANGUAGE_NAMES } = require('../prompts');
const { extractAndPersistPage, classifyAndPersistPage, PyqExtractionError, PyqClassificationError } = require('../lib/pyqWorker');
const { PYQ_QUESTION_TYPES } = require('../lib/pyqExtractionSchema');
const {
  PYQ_CLASS_LEVELS, PYQ_EXAM_TYPES, PYQ_PAPER_STATUSES, PYQ_QUESTION_REVIEW_STATUSES,
} = require('../lib/pyqVocab');
const { occurrenceCount, pickReferenceQuestion } = require('../lib/pyqClustering');

const router = express.Router();

// Mirrors routes/adminSupport.js's own parseListQuery/NEWEST_FIRST exactly —
// kept as its own copy rather than a shared import, same "small per-file leaf
// helpers stay duplicated" precedent documented in routes/attachments.js's
// sendAiError comment and routes/adminSupport.js's own header.
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

function parseListQuery(query) {
  const rawLimit = parseInt(query.limit, 10);
  const limit = Math.min(Math.max(Number.isNaN(rawLimit) ? DEFAULT_PAGE_SIZE : rawLimit, 1), MAX_PAGE_SIZE);
  const rawPage = parseInt(query.page, 10);
  const page = Math.max(Number.isNaN(rawPage) ? 1 : rawPage, 1);
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 200) : '';
  return { limit, page, skip: (page - 1) * limit, q };
}

const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }];

// PYQ_CLASS_LEVELS/PYQ_EXAM_TYPES/PYQ_PAPER_STATUSES now live in
// lib/pyqVocab.js (Phase 5) — imported above, no longer duplicated here.

// PDF-only ceilings, deliberately separate from ATTACHMENT_MAX_FILE_SIZE_MB /
// ATTACHMENT_MAX_PDF_PAGES (lib/flags.js) — a full scanned board-exam paper is
// a bigger, longer document than a single chat attachment. No exact numbers
// are specified in docs/pyq-implementation-plan.md, so these are chosen here,
// env-tunable with the same clamp-and-warn discipline as every other tunable
// in lib/config.js, rather than hardcoded: 25MB comfortably covers a
// multi-page scanned PDF at reasonable compression; 60 pages is generous
// headroom over the plan's own ~10-pages/paper assumption (§17) while still
// rejecting the "300+ pages, certainly a mis-upload" case named in the plan's
// edge-case table (§20 of the original artifact / this repo's §19).
//
// Read PER REQUEST, not once at module load — same reasoning as
// routes/attachments.js's readAttachmentFlags() call inside its gate
// middleware: a flag/tunable stored in a module-level constant would freeze
// at whatever value process.env held the moment this file was first
// required, silently ignoring any later change (env reload, or a test that
// flips it between cases).
function readPyqUploadLimits() {
  return {
    maxFileSizeMb: parseIntEnv(process.env.PYQ_MAX_FILE_SIZE_MB, {
      name: 'PYQ_MAX_FILE_SIZE_MB', defaultValue: 25, min: 1, max: 100,
    }),
    maxPdfPages: parseIntEnv(process.env.PYQ_MAX_PDF_PAGES, {
      name: 'PYQ_MAX_PDF_PAGES', defaultValue: 60, min: 1, max: 500,
    }),
  };
}

let uploadMiddleware = null;
let cachedKey = null;

/** Same lazy-rebuild-on-change pattern as routes/attachments.js's getUploadMiddleware. */
function getUploadMiddleware(maxFileSizeMb) {
  const key = String(maxFileSizeMb);
  if (uploadMiddleware && cachedKey === key) return uploadMiddleware;
  uploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSizeMb * 1024 * 1024 },
  }).single('file');
  cachedKey = key;
  return uploadMiddleware;
}

/** Maps a multer error to the app's error contract — mirrors routes/attachments.js's handleMulterError. */
function handleMulterError(maxFileSizeMb, err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: `The file is too large. Maximum size is ${maxFileSizeMb}MB.`,
        code: 'FILE_TOO_LARGE',
      });
    }
    return res.status(400).json({ error: 'Could not process the uploaded file.', code: 'UPLOAD_ERROR' });
  }
  return next(err);
}

const uploadSchema = z.object({
  boardId: z.string().trim().min(1, 'boardId is required.'),
  subjectId: z.string().trim().min(1, 'subjectId is required.'),
  classLevel: z.enum(PYQ_CLASS_LEVELS, { errorMap: () => ({ message: `classLevel must be one of: ${PYQ_CLASS_LEVELS.join(', ')}.` }) }),
  year: z.coerce.number().int().min(1950).max(new Date().getFullYear()),
  examType: z.enum(PYQ_EXAM_TYPES).default('annual'),
  setLabel: z.string().trim().max(50).optional().default(''),
  language: z.enum(Object.keys(LANGUAGE_NAMES), { errorMap: () => ({ message: 'Unsupported language.' }) }).default('en'),
}).strict();

/** Public shape for an ExamPaper row — never includes SourceDocument.data. */
function paperDto(paper) {
  return {
    id: paper.id,
    board: paper.board ? { id: paper.board.id, name: paper.board.name, code: paper.board.code } : { id: paper.boardId },
    subject: paper.subject ? { id: paper.subject.id, name: paper.subject.name, classLevel: paper.subject.classLevel } : { id: paper.subjectId },
    classLevel: paper.classLevel,
    year: paper.year,
    examType: paper.examType,
    setLabel: paper.setLabel,
    totalMarks: paper.totalMarks,
    language: paper.language,
    status: paper.status,
    createdAt: paper.createdAt,
    updatedAt: paper.updatedAt,
    sourceDocument: paper.sourceDocument
      ? {
          mimeType: paper.sourceDocument.mimeType,
          sizeBytes: paper.sourceDocument.sizeBytes,
          checksum: paper.sourceDocument.checksum,
          pageCount: paper.sourceDocument.pageCount,
          uploadedById: paper.sourceDocument.uploadedById,
          uploadedAt: paper.sourceDocument.uploadedAt,
        }
      : null,
  };
}

const PAPER_INCLUDE = Object.freeze({
  board: { select: { id: true, name: true, code: true } },
  subject: { select: { id: true, name: true, classLevel: true } },
  // Never selects `data` — the same discipline routes/avatar.js documents for
  // ProfilePicture: an ordinary find never pulls file bytes into memory, only
  // the one route that explicitly needs them (GET .../source below) does.
  sourceDocument: {
    select: { mimeType: true, sizeBytes: true, checksum: true, pageCount: true, uploadedById: true, uploadedAt: true },
  },
});

/**
 * Derives a per-page progress summary from SourceDocument.extractionState
 * (JSON: { "<pageNumber>": "pending"|"done"|"failed" }). Returns null when
 * extraction hasn't started yet (the normal state for every paper in this
 * phase — no route in Phase 2 ever writes this column), rather than a
 * misleading all-zero object.
 */
function computeExtractionProgress(extractionStateJson) {
  if (!extractionStateJson) return null;
  let parsed;
  try {
    parsed = JSON.parse(extractionStateJson);
  } catch {
    return null;
  }
  const counts = { pending: 0, done: 0, failed: 0 };
  for (const status of Object.values(parsed)) {
    if (status === 'pending' || status === 'done' || status === 'failed') counts[status] += 1;
  }
  return counts;
}

/** { extracted, reviewed, approved, rejected } — all zero until Phase 3+ ever write a Question row. */
async function computeQuestionCounts(examPaperId) {
  const grouped = await prisma.question.groupBy({
    by: ['reviewStatus'],
    where: { examPaperId },
    _count: true,
  });
  const counts = { extracted: 0, reviewed: 0, approved: 0, rejected: 0 };
  for (const row of grouped) {
    if (row.reviewStatus in counts) counts[row.reviewStatus] = row._count;
  }
  return counts;
}

// POST /papers — upload a source PDF; stores it as Bytes (SourceDocument.data),
// checksum-deduped, with a separate paper-identity dedup check.
router.post(
  '/papers',
  authRequired,
  requireRole('super_admin'),
  (req, res, next) => {
    const { maxFileSizeMb } = readPyqUploadLimits();
    return getUploadMiddleware(maxFileSizeMb)(req, res, (err) => handleMulterError(maxFileSizeMb, err, req, res, next));
  },
  asyncHandler(async (req, res) => {
    const requestId = crypto.randomUUID();
    const limits = readPyqUploadLimits();

    const parsed = uploadSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues[0]?.message || 'Invalid request fields.',
        code: 'INVALID_FIELDS',
        requestId,
      });
    }
    const { boardId, subjectId, classLevel, year, examType, setLabel, language } = parsed.data;

    if (!req.file) {
      return res.status(400).json({ error: 'A PDF file is required.', code: 'FILE_REQUIRED', requestId });
    }

    const validation = validatePyqSourceDocument(req.file.buffer, {
      maxBytes: limits.maxFileSizeMb * 1024 * 1024,
      maxPdfPages: limits.maxPdfPages,
    });
    if (!validation.ok) {
      return res.status(400).json({ error: validation.message, code: validation.code, requestId });
    }

    const [board, subject] = await Promise.all([
      prisma.board.findUnique({ where: { id: boardId }, select: { id: true } }),
      prisma.subject.findUnique({ where: { id: subjectId }, select: { id: true, boardId: true, classLevel: true } }),
    ]);
    if (!board) {
      return res.status(400).json({ error: 'Unknown boardId.', code: 'INVALID_BOARD', requestId });
    }
    if (!subject || subject.boardId !== boardId) {
      return res.status(400).json({ error: 'Unknown subjectId for this board.', code: 'INVALID_SUBJECT', requestId });
    }
    if (subject.classLevel !== classLevel) {
      return res.status(400).json({
        error: `This subject belongs to class ${subject.classLevel}, not ${classLevel}.`,
        code: 'CLASS_LEVEL_MISMATCH',
        requestId,
      });
    }

    // Deterministic dedup, checked deliberately BEFORE any write — see
    // docs/pyq-implementation-plan.md §5 stage 2 / §7's setLabel fix.
    const checksum = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

    const existingByChecksum = await prisma.sourceDocument.findUnique({ where: { checksum }, select: { id: true } });
    if (existingByChecksum) {
      return res.status(409).json({
        error: 'This exact file has already been uploaded.',
        code: 'DUPLICATE_UPLOAD',
        requestId,
      });
    }

    const existingByIdentity = await prisma.examPaper.findFirst({
      where: { boardId, subjectId, year, examType, setLabel },
      select: { id: true },
    });
    if (existingByIdentity) {
      return res.status(409).json({
        error: 'This paper already exists — did you mean to replace its source document?',
        code: 'PAPER_EXISTS',
        requestId,
      });
    }

    const created = await prisma.examPaper.create({
      data: {
        boardId,
        subjectId,
        classLevel,
        year,
        examType,
        setLabel,
        language,
        // status stays at the schema default ('uploaded') — extraction (Phase 3)
        // is what moves it to 'extracting'.
        sourceDocument: {
          create: {
            data: req.file.buffer,
            mimeType: validation.mimeType,
            sizeBytes: req.file.buffer.length,
            checksum,
            pageCount: validation.pageCount,
            uploadedById: req.user.id,
          },
        },
      },
      include: PAPER_INCLUDE,
    });

    return res.status(201).json({ paper: paperDto(created), requestId });
  })
);

// GET /papers — filtered, searched, paginated list.
router.get('/papers', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const { limit, page, skip, q } = parseListQuery(req.query);

  const where = {};

  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (status && PYQ_PAPER_STATUSES.includes(status)) where.status = status;

  const boardId = typeof req.query.boardId === 'string' ? req.query.boardId : '';
  if (boardId) where.boardId = boardId;

  const subjectId = typeof req.query.subjectId === 'string' ? req.query.subjectId : '';
  if (subjectId) where.subjectId = subjectId;

  if (q) {
    where.OR = [
      { id: { endsWith: q } },
      { board: { name: { contains: q } } },
      { subject: { name: { contains: q } } },
    ];
  }

  const [total, papers] = await Promise.all([
    prisma.examPaper.count({ where }),
    prisma.examPaper.findMany({
      where,
      orderBy: NEWEST_FIRST,
      skip,
      take: limit,
      include: PAPER_INCLUDE,
    }),
  ]);

  res.json({ papers: papers.map(paperDto), total, page, limit });
}));

// GET /papers/:id — full detail, plus (currently always-empty, until later
// phases) extraction progress and question-review counts.
router.get('/papers/:id', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const paper = await prisma.examPaper.findUnique({
    where: { id: req.params.id },
    include: {
      ...PAPER_INCLUDE,
      sourceDocument: { select: { ...PAPER_INCLUDE.sourceDocument.select, extractionState: true } },
    },
  });
  if (!paper) return res.status(404).json({ error: 'Paper not found.' });

  const [extractionProgress, questionCounts] = await Promise.all([
    Promise.resolve(computeExtractionProgress(paper.sourceDocument?.extractionState)),
    computeQuestionCounts(paper.id),
  ]);

  res.json({ paper: paperDto(paper), extractionProgress, questionCounts });
}));

const extractSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
}).strict();

/**
 * Maps a thrown extraction OR classification error to an HTTP response.
 * PyqExtractionError/PyqClassificationError instances (lib/pyqWorker.js)
 * already carry their own status/code; anything else is a raw Gemini-layer
 * error (gemini.js/lib/geminiPolicy.js's shapes — `.status`, `.code`,
 * `.name`), mapped the same way routes/resources.js's own (unexported,
 * per-file) sendAiError does for the existing generator routes.
 */
function mapExtractionError(err, requestId) {
  if (err instanceof PyqExtractionError || err instanceof PyqClassificationError) {
    return { status: err.status, body: { error: err.message, code: err.code, requestId } };
  }
  if (err.code === 'INPUT_BLOCKED' || err.code === 'OUTPUT_BLOCKED') {
    return { status: 422, body: { error: "This page couldn't be processed — try re-extracting.", code: 'SAFETY_BLOCKED', requestId } };
  }
  if (err.code === 'DEADLINE_EXCEEDED' || err.name === 'TimeoutError' || err.name === 'AbortError') {
    return { status: 504, body: { error: 'Extraction took too long. Please try again.', code: 'TIMEOUT', requestId } };
  }
  if (err.status === 429) {
    return { status: 429, body: { error: 'The AI service is busy. Please try again shortly.', code: 'RATE_LIMITED', requestId } };
  }
  return { status: 502, body: { error: 'Failed to extract this page. Please try again.', code: 'UPSTREAM_UNAVAILABLE', requestId } };
}

// POST /papers/:id/extract — extracts ONE page (§8 stage 3) via the 4th
// GeminiService instance (app.locals.pyqGemini, constructed in Phase 2,
// unused until now). `page` optional: omitted picks the next pending page
// (what a worker loop would call repeatedly); explicit `page` re-extracts
// (or extracts out of order / retries) a specific page. See lib/pyqWorker.js
// for the actual extraction + persistence + idempotency logic — this route
// is a thin HTTP wrapper around it, same "routes stay thin" shape as every
// other route in this file.
router.post('/papers/:id/extract', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const requestId = crypto.randomUUID();

  const parsed = extractSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid request fields.',
      code: 'INVALID_FIELDS',
      requestId,
    });
  }

  const gemini = req.app.locals.pyqGemini;
  if (!gemini || typeof gemini.generateContent !== 'function') {
    return res.status(503).json({ error: 'PYQ extraction is unavailable right now.', requestId });
  }

  try {
    const result = await extractAndPersistPage({
      prisma,
      gemini,
      examPaperId: req.params.id,
      pageNumber: parsed.data.page,
      correlationId: requestId,
    });
    return res.status(202).json({ pageNumber: result.pageNumber, status: result.status, requestId });
  } catch (err) {
    const { status, body } = mapExtractionError(err, requestId);
    return res.status(status).json(body);
  }
}));

// POST /papers/:id/classify — Phase 5 (§9/§20). Classifies ONE page's worth
// of already-extracted, not-yet-classified questions (reviewStatus
// 'extracted' AND chapterId null) into the paper's subject's pre-seeded
// chapter/topic taxonomy, via the SAME pyqGemini instance Phase 3 already
// constructs. `page` optional: omitted picks the next page with anything
// still needing classification; explicit `page` re-targets (or retries) a
// specific page. Deliberately a SEPARATE trigger from /extract, not folded
// into it — keeps classification independently retriable and testable, the
// same "routes stay thin, concerns stay separate" shape Phases 3/4 already
// established. See lib/pyqWorker.js's classifyAndPersistPage for the actual
// DB-persisting logic — this route is a thin HTTP wrapper around it.
const classifySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
}).strict();

router.post('/papers/:id/classify', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const requestId = crypto.randomUUID();

  const parsed = classifySchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid request fields.',
      code: 'INVALID_FIELDS',
      requestId,
    });
  }

  const gemini = req.app.locals.pyqGemini;
  if (!gemini || typeof gemini.generateContent !== 'function') {
    return res.status(503).json({ error: 'PYQ classification is unavailable right now.', requestId });
  }

  try {
    const result = await classifyAndPersistPage({
      prisma,
      gemini,
      examPaperId: req.params.id,
      pageNumber: parsed.data.page,
      correlationId: requestId,
    });
    return res.status(202).json({
      pageNumber: result.pageNumber,
      status: result.status,
      classifiedCount: result.classifiedCount,
      unclassifiedCount: result.unclassifiedCount,
      requestId,
    });
  } catch (err) {
    const { status, body } = mapExtractionError(err, requestId);
    return res.status(status).json(body);
  }
}));

// GET /papers/:id/source — the raw PDF bytes. Private, role-gated, exactly
// like upload — mirrors routes/avatar.js's ProfilePicture-serving route, but
// WITHOUT that route's public-cache/cross-origin headers, since this is never
// meant to be embedded from outside an authenticated admin session.
router.get('/papers/:id/source', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const sourceDocument = await prisma.sourceDocument.findUnique({
    where: { examPaperId: req.params.id },
    select: { data: true, mimeType: true },
  });
  if (!sourceDocument) return res.status(404).json({ error: 'Paper not found.' });

  // `page` (optional, per docs/pyq-implementation-plan.md §14) is accepted
  // but intentionally not acted on here — the whole PDF is always returned.
  // Per-page navigation is a CLIENT-side concern (the reviewer's PDF viewer,
  // Phase 4), because SourceDocument stores one PDF, never per-page splits
  // (§7 of the plan: "we don't re-derive a page image — the reviewer UI
  // renders the ORIGINAL PDF directly").

  res.setHeader('Content-Type', sourceDocument.mimeType);
  res.setHeader('Content-Disposition', 'inline');
  // Never cached — this is private, admin-only content, unlike
  // ProfilePicture's public/immutable avatar bytes.
  res.setHeader('Cache-Control', 'private, no-store');
  // Same Uint8Array-vs-Buffer fix documented in routes/avatar.js: Prisma's
  // SQLite Bytes fields come back as a plain Uint8Array, and res.send() only
  // takes the binary path for an actual Buffer.
  return res.send(Buffer.from(sourceDocument.data));
}));

// POST /papers/:id/publish — Phase 7 (§7 status table, §8 stage 7, §14). The
// publish gate: a single ExamPaper.status flip to 'published', gated on
// EVERY Question row belonging to this paper having reached a terminal
// reviewStatus (approved or rejected) — the ONLY gate the plan specifies.
// Classification and clustering having run are explicitly NOT required:
// Phase 6's own completion record states "Phase 7 (Publishing) can proceed
// independently — nothing about the publish gate depends on clustering
// having run," and nothing in §7/§8 conditions publish on chapterId being
// set or on any QuestionCluster state. A rejected question is exactly as
// "terminal" as an approved one — a paper whose questions were all
// legitimately rejected is fully reviewed and publishable; it simply
// contributes zero candidate-pool-eligible questions (§7's candidate rule:
// ExamPaper.status = 'published' AND Question.reviewStatus = 'approved',
// BOTH required — a rejected question can never become eligible regardless
// of its paper's status).
//
// A paper with zero Question rows (extraction not yet run) is refused
// (NOT_READY) rather than trivially "passing" an all-of-zero check — a
// paper with nothing extracted is not a "fully-reviewed paper" in any
// meaningful sense, and publishing it would flip ExamPaper.status on a paper
// with no content yet, which serves no purpose and reads as an admin
// mis-click. An 'archived' paper is likewise refused — archived and
// published are parallel terminal branches off 'needs_review' (§7's status
// table: "published / archived"), not a chain, so archived never re-enters
// published.
//
// IDEMPOTENT (deliberately unlike approve/reject/cluster-confirm's 409-on-
// repeat shape): repeating this call on an already-published paper is a
// no-op success — same id/status returned, no second Event row, no re-write
// of ExamPaper — per the plan's own "Publishing must be safe to repeat" /
// "do not... duplicate audit events unnecessarily" instruction and its own
// Testing item #12 ("Repeated publish is idempotent").
router.post('/papers/:id/publish', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const requestId = crypto.randomUUID();

  const paper = await prisma.examPaper.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
  if (!paper) return res.status(404).json({ error: 'Paper not found.', requestId });

  if (paper.status === 'published') {
    return res.json({ id: paper.id, status: 'published', requestId });
  }
  if (paper.status === 'archived') {
    return res.status(409).json({ error: 'This paper is archived and cannot be published.', code: 'NOT_READY', requestId });
  }

  const grouped = await prisma.question.groupBy({ by: ['reviewStatus'], where: { examPaperId: paper.id }, _count: true });
  const total = grouped.reduce((sum, row) => sum + row._count, 0);
  const nonTerminal = grouped
    .filter((row) => row.reviewStatus === 'extracted' || row.reviewStatus === 'reviewed')
    .reduce((sum, row) => sum + row._count, 0);

  if (total === 0) {
    return res.status(409).json({
      error: 'This paper has no extracted questions yet — nothing to publish.',
      code: 'NOT_READY',
      requestId,
    });
  }
  if (nonTerminal > 0) {
    return res.status(409).json({
      error: `${nonTerminal} question${nonTerminal === 1 ? '' : 's'} ${nonTerminal === 1 ? 'still needs' : 'still need'} review before this paper can be published.`,
      code: 'NOT_READY',
      requestId,
    });
  }

  const updated = await prisma.examPaper.update({ where: { id: paper.id }, data: { status: 'published' } });

  // Same metadata-only audit discipline as every other PYQ review-action —
  // no question content, just which paper and who.
  await prisma.event.create({
    data: { userId: req.user.id, type: 'pyq_paper_published', metadata: JSON.stringify({ examPaperId: updated.id }) },
  });

  res.json({ id: updated.id, status: updated.status, requestId });
}));

// GET /boards — read-only Board+Subject(+Chapter+Topic, Phase 5) listing, so
// the Phase 4 ingestion UI's upload form can offer closed selects instead of
// asking an admin to paste a raw database id, and so the Phase 5 review UI
// can offer a chapter/topic picker. NOT part of §14's originally-listed
// Phase 4 endpoints, but a minimal, necessary addition in the SAME
// established shape as routes/admin.js's own `GET /schools` — read-only, no
// pagination at this scale (Phase 0 locks the MVP corpus at 2 boards, and
// Phase 5 at 15 chapters/board), no filtering. This does NOT reopen "no CRUD
// API" for Board/Subject/Chapter/Topic (§14): it adds exactly one READ
// endpoint, no create/update/delete route exists here or anywhere else, and
// these rows are still only ever created by pyqSyllabusSeed.js (Phase 5) —
// see routes/adminPyq.js's own git history for the pre-Phase-5 gap this
// closed.
router.get('/boards', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const boards = await prisma.board.findMany({
    orderBy: { name: 'asc' },
    include: {
      subjects: {
        orderBy: [{ classLevel: 'asc' }, { name: 'asc' }],
        include: {
          chapters: {
            orderBy: { sequence: 'asc' },
            include: { topics: { orderBy: { name: 'asc' }, select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  res.json({
    boards: boards.map((b) => ({
      id: b.id,
      name: b.name,
      code: b.code,
      region: b.region,
      subjects: b.subjects.map((s) => ({
        id: s.id,
        name: s.name,
        classLevel: s.classLevel,
        chapters: s.chapters.map((c) => ({
          id: c.id,
          name: c.name,
          sequence: c.sequence,
          topics: c.topics.map((t) => ({ id: t.id, name: t.name })),
        })),
      })),
    })),
  });
}));

// ── Phase 4 — Admin Review ───────────────────────────────────────────────
// A reviewer sees the source PDF page beside extracted fields, corrects,
// approves/rejects (§8 stage 5). Only APPROVED questions ever become
// candidate-pool eligible (§7's status table) — nothing here does any
// classification, clustering, or publishing; this is purely the mandatory
// human-review gate over Phase 3's extracted rows.

const QUESTION_REVIEW_STATUSES = PYQ_QUESTION_REVIEW_STATUSES;

/** Tolerant JSON parse for the two nullable JSON-string columns (options, rawExtraction). */
function safeParseJson(json) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Public shape for a Question row. Includes every field a reviewer needs to
 * judge "did Gemini extract this correctly," including the immutable
 * `rawExtraction` audit trail — but never invents anything not already on
 * the row (no derived/AI-backfilled answer, per §9/§11's trust boundary).
 */
function questionDto(q) {
  return {
    id: q.id,
    examPaperId: q.examPaperId,
    chapterId: q.chapterId,
    // Phase 5: QuestionTopic join, if the caller's query included it —
    // absent (undefined) requests get `[]`, never a crash, since not every
    // caller of questionDto (e.g. a future bulk listing) needs to pay for
    // the join.
    topics: Array.isArray(q.topics) ? q.topics.map((qt) => ({ id: qt.topic.id, name: qt.topic.name, source: qt.source })) : [],
    boardId: q.boardId,
    subjectId: q.subjectId,
    classLevel: q.classLevel,
    year: q.year,
    questionNumber: q.questionNumber,
    parentQuestionId: q.parentQuestionId,
    requiresGroupSelection: q.requiresGroupSelection,
    language: q.language,
    translationOfId: q.translationOfId,
    type: q.type,
    text: q.text,
    options: safeParseJson(q.options),
    marks: q.marks,
    difficulty: q.difficulty,
    correctAnswer: q.correctAnswer,
    hasOfficialAnswer: q.hasOfficialAnswer,
    pageNumber: q.pageNumber,
    hasDiagram: q.hasDiagram,
    hasTable: q.hasTable,
    reviewStatus: q.reviewStatus,
    reviewedById: q.reviewedById,
    reviewedAt: q.reviewedAt,
    extractionConfidence: q.extractionConfidence,
    rawExtraction: safeParseJson(q.rawExtraction),
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

const QUESTION_SORT = [{ pageNumber: 'asc' }, { questionNumber: 'asc' }, { id: 'asc' }];

// GET /papers/:id/questions — every extracted question for one paper, in
// source order (page, then as-printed number). A single paper's question
// count is small (§17's own ~15-25/paper assumption) — no pagination.
router.get('/papers/:id/questions', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const paper = await prisma.examPaper.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!paper) return res.status(404).json({ error: 'Paper not found.' });

  const where = { examPaperId: req.params.id };
  const reviewStatus = typeof req.query.reviewStatus === 'string' ? req.query.reviewStatus : '';
  if (reviewStatus && QUESTION_REVIEW_STATUSES.includes(reviewStatus)) where.reviewStatus = reviewStatus;

  const questions = await prisma.question.findMany({
    where,
    orderBy: QUESTION_SORT,
    include: { topics: { include: { topic: { select: { id: true, name: true } } } } },
  });
  res.json({ questions: questions.map(questionDto) });
}));

// Editable-field allowlist, enforced by Zod's .strict() (an unknown key —
// e.g. examPaperId, boardId, pageNumber, rawExtraction — is a 400, not a
// silently-ignored no-op): text/type/options/marks/correctAnswer/difficulty/
// hasDiagram/hasTable/requiresGroupSelection, per §14's PATCH row, PLUS
// questionNumber (a legitimate "Gemini misread the printed label" correction,
// not provenance — unlike pageNumber, which records which PHYSICAL page this
// row came from and is never editable here). chapterId/topicIds are back
// (Phase 5) now that pyqSyllabusSeed.js gives them something real to point
// at — Phase 4 deliberately omitted them for exactly this reason.
//
// hasOfficialAnswer is NOT independently settable — same trust-boundary
// enforcement lib/pyqWorker.js already applies at extraction time (§9/§11):
// it is DERIVED from whether the corrected `correctAnswer` is non-empty, so
// a reviewer can never leave the row in the "hasOfficialAnswer: true, no
// actual answer text" contradiction Zod already rejects at extraction time.
const patchQuestionSchema = z
  .object({
    questionNumber: z.string().trim().min(1).max(20).optional(),
    type: z.enum(PYQ_QUESTION_TYPES).optional(),
    text: z.string().trim().min(1).max(3000).optional(),
    options: z.array(z.string().trim().min(1).max(500)).max(4).optional(),
    marks: z.number().int().min(1).max(20).optional(),
    correctAnswer: z.string().trim().max(2000).optional(),
    difficulty: z.enum(['easy', 'medium', 'hard']).nullable().optional(),
    hasDiagram: z.boolean().optional(),
    hasTable: z.boolean().optional(),
    requiresGroupSelection: z.boolean().optional(),
    // null clears the chapter (and, transitively below, every topic — a
    // question can't carry topics for a chapter it no longer has).
    chapterId: z.string().trim().min(1).nullable().optional(),
    // Provided means "replace this question's full topic set" — never a
    // merge, so a reviewer removing a wrong AI-proposed topic is a single
    // PATCH, not a separate remove action. Omitted means "leave topics
    // exactly as they are."
    topicIds: z.array(z.string().trim().min(1)).max(10).optional(),
  })
  .strict();

// PATCH /questions/:id — a reviewer's correction. Blocked once a question has
// reached a terminal reviewStatus (§14: "409 if already approved/rejected")
// — a mistaken approval is corrected by REJECTING it first (§12/§18), not by
// editing an approved row's content out from under its own approval.
router.patch('/questions/:id', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const requestId = crypto.randomUUID();

  const parsed = patchQuestionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({
      error: parsed.error.issues[0]?.message || 'Invalid request fields.',
      code: 'INVALID_FIELDS',
      requestId,
    });
  }
  if (Object.keys(parsed.data).length === 0) {
    return res.status(400).json({ error: 'No editable fields were provided.', code: 'INVALID_FIELDS', requestId });
  }

  const existing = await prisma.question.findUnique({
    where: { id: req.params.id },
    select: { id: true, type: true, options: true, reviewStatus: true, subjectId: true, chapterId: true },
  });
  if (!existing) return res.status(404).json({ error: 'Question not found.', requestId });
  if (existing.reviewStatus === 'approved' || existing.reviewStatus === 'rejected') {
    return res.status(409).json({
      error: 'This question has already reached a final review decision and can no longer be edited.',
      code: 'ALREADY_REVIEWED',
      requestId,
    });
  }

  const data = { ...parsed.data };
  const topicIds = data.topicIds;
  delete data.topicIds; // not a Question column — applied via QuestionTopic below, inside the same transaction

  // mcq must carry exactly 4 options; every other type carries none — same
  // rule pyqExtractionSchema.js enforces at extraction time, re-checked here
  // against the EFFECTIVE (new-or-existing) type and options, since either
  // one alone might be what this particular PATCH is changing.
  const effectiveType = data.type ?? existing.type;
  if (effectiveType === 'mcq') {
    const effectiveOptions = data.options ?? safeParseJson(existing.options) ?? [];
    if (effectiveOptions.length !== 4) {
      return res.status(400).json({
        error: 'mcq questions must have exactly 4 options.',
        code: 'INVALID_FIELDS',
        requestId,
      });
    }
    if (data.options) data.options = JSON.stringify(data.options);
  } else if ('type' in data || 'options' in data) {
    data.options = null;
  }

  if ('correctAnswer' in data) {
    data.hasOfficialAnswer = data.correctAnswer.trim().length > 0;
  }

  // Phase 5: chapterId/topicIds are never trusted blindly from the client —
  // re-verified against the real seeded taxonomy, the same "closed
  // vocabulary, verified not assumed" discipline classifyPyqChapter.js
  // applies on the AI side. A chapterId must belong to THIS question's own
  // subject; a topicId must belong to the EFFECTIVE (new-or-existing)
  // chapter — a question can never carry a topic from a chapter it doesn't
  // have.
  const effectiveChapterId = 'chapterId' in data ? data.chapterId : existing.chapterId;
  if ('chapterId' in data && data.chapterId !== null) {
    const chapter = await prisma.chapter.findUnique({ where: { id: data.chapterId }, select: { id: true, subjectId: true } });
    if (!chapter || chapter.subjectId !== existing.subjectId) {
      return res.status(400).json({ error: "Unknown chapterId for this question's subject.", code: 'INVALID_FIELDS', requestId });
    }
  }
  // Clearing the chapter (chapterId: null) with no explicit topicIds implies
  // clearing topics too — a question can't keep topics for a chapter it no
  // longer has.
  let topicIdsToApply = topicIds;
  if ('chapterId' in data && data.chapterId === null && topicIdsToApply === undefined) topicIdsToApply = [];
  if (topicIdsToApply !== undefined && topicIdsToApply.length > 0) {
    if (!effectiveChapterId) {
      return res.status(400).json({ error: 'topicIds requires a chapterId.', code: 'INVALID_FIELDS', requestId });
    }
    const topics = await prisma.topic.findMany({ where: { id: { in: topicIdsToApply } }, select: { id: true, chapterId: true } });
    if (topics.length !== topicIdsToApply.length || topics.some((t) => t.chapterId !== effectiveChapterId)) {
      return res.status(400).json({
        error: "Unknown topicId, or a topicId does not belong to the chosen chapter.",
        code: 'INVALID_FIELDS',
        requestId,
      });
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.question.update({
      where: { id: req.params.id },
      data: {
        ...data,
        // extracted -> reviewed on first human touch; already-reviewed stays
        // reviewed (approve/reject, not PATCH, are what move it further).
        reviewStatus: existing.reviewStatus === 'extracted' ? 'reviewed' : existing.reviewStatus,
        reviewedById: req.user.id,
        reviewedAt: new Date(),
      },
    });
    if (topicIdsToApply !== undefined) {
      // A reviewer's PATCH REPLACES the full topic set (never a merge) and is
      // always source: 'human' from here on, even overwriting an earlier
      // AI-proposed ('ai') set — a human correction always wins.
      await tx.questionTopic.deleteMany({ where: { questionId: req.params.id } });
      for (const topicId of topicIdsToApply) {
        await tx.questionTopic.create({ data: { questionId: req.params.id, topicId, source: 'human' } });
      }
    }
    return tx.question.findUnique({
      where: { id: req.params.id },
      include: { topics: { include: { topic: { select: { id: true, name: true } } } } },
    });
  });

  // Metadata-only audit row (§12) — field NAMES changed, never the actual
  // text/values, matching this file's existing "no logging of document
  // content" discipline from Phase 2/3.
  await prisma.event.create({
    data: {
      userId: req.user.id,
      type: 'pyq_question_reviewed',
      metadata: JSON.stringify({ questionId: updated.id, examPaperId: updated.examPaperId, fields: Object.keys(parsed.data) }),
    },
  });

  res.json({ question: questionDto(updated), requestId });
}));

// POST /questions/:id/approve — makes this question (once its paper is later
// published, Phase 7) candidate-pool eligible. Blocked once already
// approved/rejected (§14) — approving twice, or "un-rejecting" via approve,
// are both refused; a rejected row can only move via reject again (a no-op)
// or a fresh PATCH+approve is likewise blocked, matching the plan's own
// asymmetric reversibility (§12/§18: reject is reversible at any time,
// approve is not a way to reverse a rejection).
router.post('/questions/:id/approve', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const requestId = crypto.randomUUID();

  const existing = await prisma.question.findUnique({
    where: { id: req.params.id },
    select: { id: true, reviewStatus: true },
  });
  if (!existing) return res.status(404).json({ error: 'Question not found.', requestId });
  if (existing.reviewStatus === 'approved' || existing.reviewStatus === 'rejected') {
    return res.status(409).json({
      error: 'This question has already reached a final review decision.',
      code: 'ALREADY_REVIEWED',
      requestId,
    });
  }

  const updated = await prisma.question.update({
    where: { id: req.params.id },
    data: { reviewStatus: 'approved', reviewedById: req.user.id, reviewedAt: new Date() },
  });

  await prisma.event.create({
    data: {
      userId: req.user.id,
      type: 'pyq_question_approved',
      metadata: JSON.stringify({ questionId: updated.id, examPaperId: updated.examPaperId }),
    },
  });

  res.json({ id: updated.id, reviewStatus: updated.reviewStatus, requestId });
}));

// POST /questions/:id/reject — deliberately UNCONDITIONAL (no 409, unlike
// approve): §12/§18 state reviewStatus "can move approved -> rejected at any
// time by the same role" as the reversal mechanism for a mistaken approval,
// so reject must remain reachable from every state, including already-
// rejected (a harmless no-op re-confirmation) and already-approved (the
// actual correction path).
router.post('/questions/:id/reject', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const requestId = crypto.randomUUID();

  const existing = await prisma.question.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!existing) return res.status(404).json({ error: 'Question not found.', requestId });

  const updated = await prisma.question.update({
    where: { id: req.params.id },
    data: { reviewStatus: 'rejected', reviewedById: req.user.id, reviewedAt: new Date() },
  });

  await prisma.event.create({
    data: {
      userId: req.user.id,
      type: 'pyq_question_rejected',
      metadata: JSON.stringify({ questionId: updated.id, examPaperId: updated.examPaperId }),
    },
  });

  res.json({ id: updated.id, reviewStatus: updated.reviewStatus, requestId });
}));

// ── Phase 6 — Cluster Review ─────────────────────────────────────────────
// A reviewer sees each proposed/confirmed/rejected QuestionCluster (built by
// the offline pyqClusterBatch.js script — see docs/pyq-implementation-plan.md
// §9/§20) and confirms or rejects it. Nothing here computes clusters itself;
// this is purely the human-review gate over that script's proposals, same
// "routes stay thin, a script/worker owns the compute" shape Phase 3's
// extraction already established. A machine-proposed cluster never affects
// a teacher-visible recurrence count until a human confirms it (§9).

const CLUSTER_STATUSES = ['proposed', 'confirmed', 'rejected'];

/** Public shape for a QuestionCluster row, including its computed (never stored) reference question and recurrence. */
function clusterDto(c) {
  const questions = c.members.map((m) => m.question);
  const reference = questions.length > 0 ? pickReferenceQuestion(questions) : null;
  const recurrence = occurrenceCount(
    c.members.map((m) => ({
      questionId: m.question.id,
      boardId: m.question.boardId,
      subjectId: m.question.subjectId,
      year: m.question.year,
      examType: m.question.examPaper ? m.question.examPaper.examType : 'annual',
      translationOfId: m.question.translationOfId,
    }))
  );

  return {
    id: c.id,
    chapterId: c.chapterId,
    chapter: c.chapter
      ? {
          id: c.chapter.id,
          name: c.chapter.name,
          subject: c.chapter.subject
            ? {
                id: c.chapter.subject.id,
                name: c.chapter.subject.name,
                classLevel: c.chapter.subject.classLevel,
                board: c.chapter.subject.board,
              }
            : null,
        }
      : null,
    method: c.method,
    status: c.status,
    label: c.label,
    confirmedById: c.confirmedById,
    confirmedAt: c.confirmedAt,
    createdAt: c.createdAt,
    referenceQuestionId: reference ? reference.id : null,
    recurrence,
    members: c.members.map((m) => ({
      questionId: m.question.id,
      questionNumber: m.question.questionNumber,
      text: m.question.text,
      year: m.question.year,
      examPaperId: m.question.examPaperId,
      similarity: m.similarity,
    })),
  };
}

const CLUSTER_INCLUDE = Object.freeze({
  chapter: {
    select: {
      id: true,
      name: true,
      subject: { select: { id: true, name: true, classLevel: true, board: { select: { id: true, name: true, code: true } } } },
    },
  },
  members: {
    include: {
      question: {
        select: {
          id: true, text: true, year: true, questionNumber: true, examPaperId: true,
          boardId: true, subjectId: true, translationOfId: true,
          examPaper: { select: { examType: true } },
        },
      },
    },
  },
});

// GET /clusters — filtered list, newest first. No pagination at this scale
// (Phase 0's MVP corpus is 2 boards × 1 class × 1 subject × 10 years — even
// a fully-clustered corpus stays small; see pyqSyllabusSeed.js's own
// precedent for the same "no pagination needed yet" call on /boards).
router.get('/clusters', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const where = {};
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  if (status && CLUSTER_STATUSES.includes(status)) where.status = status;
  const chapterId = typeof req.query.chapterId === 'string' ? req.query.chapterId : '';
  if (chapterId) where.chapterId = chapterId;

  const clusters = await prisma.questionCluster.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    include: CLUSTER_INCLUDE,
  });

  res.json({ clusters: clusters.map(clusterDto) });
}));

// POST /clusters/:id/confirm — a machine-proposed cluster never affects a
// teacher-visible recurrence count until this happens (§9). Blocked once
// already confirmed/rejected (409 ALREADY_DECIDED) — mirrors
// POST /questions/:id/approve's identical asymmetric-reversibility shape:
// the correction path for a mistaken confirm is reject, not a second confirm.
router.post('/clusters/:id/confirm', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const requestId = crypto.randomUUID();

  const existing = await prisma.questionCluster.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
  if (!existing) return res.status(404).json({ error: 'Cluster not found.', requestId });
  if (existing.status === 'confirmed' || existing.status === 'rejected') {
    return res.status(409).json({
      error: 'This cluster has already reached a final decision.',
      code: 'ALREADY_DECIDED',
      requestId,
    });
  }

  const updated = await prisma.questionCluster.update({
    where: { id: req.params.id },
    data: { status: 'confirmed', confirmedById: req.user.id, confirmedAt: new Date() },
  });

  await prisma.event.create({
    data: { userId: req.user.id, type: 'pyq_cluster_confirmed', metadata: JSON.stringify({ clusterId: updated.id }) },
  });

  res.json({ id: updated.id, status: updated.status, requestId });
}));

// POST /clusters/:id/reject — deliberately UNCONDITIONAL (no 409), matching
// POST /questions/:id/reject's exact precedent: reject must remain reachable
// from every state, including already-rejected (a harmless no-op) and
// already-confirmed (the correction path for a mistaken confirm). A
// rejected cluster is also excluded from every future pyqClusterBatch.js
// run's matching targets — a human's "no" is respected going forward, never
// silently re-opened by a later automatic match.
router.post('/clusters/:id/reject', authRequired, requireRole('super_admin'), asyncHandler(async (req, res) => {
  const requestId = crypto.randomUUID();

  const existing = await prisma.questionCluster.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!existing) return res.status(404).json({ error: 'Cluster not found.', requestId });

  const updated = await prisma.questionCluster.update({
    where: { id: req.params.id },
    data: { status: 'rejected', confirmedById: req.user.id, confirmedAt: new Date() },
  });

  await prisma.event.create({
    data: { userId: req.user.id, type: 'pyq_cluster_rejected', metadata: JSON.stringify({ clusterId: updated.id }) },
  });

  res.json({ id: updated.id, status: updated.status, requestId });
}));

module.exports = router;
