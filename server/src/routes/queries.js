// Teacher-facing data: personal history + feedback on responses.
const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// GET /api/queries — the signed-in user's own history (most recent first).
router.get('/queries', authRequired, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  // EXPLICIT select, not the default "every column".
  //
  // `classroomArtifacts` holds up to five full documents (D25). A 20-row
  // history that pulled it would move hundreds of kilobytes to render a
  // sidebar that shows none of it. The plan IS included — it is small, and the
  // client needs it to know a turn has materials at all; the artifacts
  // themselves are fetched on demand for one turn below.
  const rows = await prisma.query.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      queryText: true,
      language: true,
      context: true,
      responseText: true,
      responseTimeMs: true,
      createdAt: true,
      classroomPlan: true,
      title: true,
      pinned: true,
      feedback: { where: { userId: req.user.id }, take: 1, select: { rating: true } },
    },
  });

  const queries = rows.map((q) => ({
    id: q.id,
    query: q.queryText,
    language: q.language,
    context: q.context ? safeParse(q.context) : {},
    text: q.responseText,
    responseTime: q.responseTimeMs || 0,
    createdAt: q.createdAt,
    rating: q.feedback[0]?.rating || null,
    title: q.title,
    pinned: q.pinned,
    // Classroom Mode's plan for this turn (D24), or omitted entirely for an
    // ordinary question. Spread rather than set to null so a history payload
    // for a teacher who never uses the mode is byte-for-byte what it has
    // always been — §7 rule 3 applies to responses this feature touches, not
    // just to /api/coach.
    ...(q.classroomPlan ? { classroom: safeParse(q.classroomPlan) } : {}),
  }));

  res.json({ queries });
}));

const feedbackSchema = z.object({
  queryId: z.string().min(1),
  rating: z.enum(['helpful', 'not_helpful']),
});

// POST /api/feedback — thumbs up/down on a response.
router.post('/feedback', authRequired, asyncHandler(async (req, res) => {
  const parsed = feedbackSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid feedback.' });
  const { queryId, rating } = parsed.data;

  const query = await prisma.query.findUnique({ where: { id: queryId } });
  if (!query) return res.status(404).json({ error: 'Query not found.' });
  if (!query.userId || query.userId !== req.user.id) {
    return res.status(403).json({ error: 'You cannot rate this response.' });
  }

  await prisma.feedback.create({ data: { queryId, userId: req.user.id, rating } });
  res.status(201).json({ success: true });
}));

// Classroom Mode artifacts for ONE turn (D25).
//
// Kept off the history list deliberately — see the select above. A teacher
// opening a chat fetches the artifacts for that turn only.

// Total size of the stored blob. Five documents at a realistic 3-5KB each sit
// well under this; the cap exists so a pathological generation cannot put a
// megabyte on a row that other queries read.
//
// Kept BELOW the 64kb body-parser limit this path is routed to (see index.js),
// so an oversized payload gets this route's clear 413 rather than the parser's
// opaque failure earlier in the stack.
const MAX_ARTIFACTS_BYTES = 60000;

const artifactsSchema = z.object({
  // artifact kind -> rendered Markdown. Kinds are not enumerated here on
  // purpose: this route stores what Classroom Mode produced and the client
  // decides what to do with it, so adding a sixth artifact needs no change
  // here. The size cap below is what bounds it.
  artifacts: z.record(z.string(), z.string()),
});

// GET /api/queries/:id/classroom-artifacts — owner only.
router.get('/queries/:id/classroom-artifacts', authRequired, asyncHandler(async (req, res) => {
  const row = await prisma.query.findUnique({
    where: { id: req.params.id },
    select: { userId: true, classroomArtifacts: true },
  });
  // Same 404 for "missing" and "not yours", so one teacher cannot probe for
  // another's history — the rule routes/resources.js already follows. A
  // null userId (e.g. the owning User row was deleted, which SetNulls this
  // FK) is treated as "not yours" for everyone, not as "no check needed".
  if (!row || !row.userId || row.userId !== req.user.id) {
    return res.status(404).json({ error: 'Query not found.' });
  }

  res.json({ artifacts: row.classroomArtifacts ? safeParse(row.classroomArtifacts) : {} });
}));

// PUT /api/queries/:id/classroom-artifacts — owner only.
//
// Replaces the whole map rather than merging: the client always sends every
// artifact it currently holds for the turn, so a merge would resurrect one the
// teacher regenerated into a failure.
router.put('/queries/:id/classroom-artifacts', authRequired, asyncHandler(async (req, res) => {
  const parsed = artifactsSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid artifacts payload.' });

  const row = await prisma.query.findUnique({
    where: { id: req.params.id },
    select: { userId: true },
  });
  if (!row || !row.userId || row.userId !== req.user.id) {
    return res.status(404).json({ error: 'Query not found.' });
  }

  const json = JSON.stringify(parsed.data.artifacts);
  if (Buffer.byteLength(json, 'utf8') > MAX_ARTIFACTS_BYTES) {
    return res.status(413).json({ error: 'Generated materials are too large to store.' });
  }

  await prisma.query.update({
    where: { id: req.params.id },
    data: { classroomArtifacts: json },
  });
  res.json({ success: true });
}));

// DELETE /api/queries — clear the signed-in user's entire history.
// NOTE: declared before the "/queries/:id" route so "/queries" is not captured
// as an :id param.
router.delete('/queries', authRequired, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  // Feedback has a required FK to Query (no cascade in the schema), so remove
  // the related feedback first, then the queries — both in one transaction.
  const [, deleted] = await prisma.$transaction([
    prisma.feedback.deleteMany({ where: { query: { userId } } }),
    prisma.query.deleteMany({ where: { userId } }),
  ]);
  res.json({ success: true, deleted: deleted.count });
}));

// DELETE /api/queries/:id — remove a single history entry (owner only).
router.delete('/queries/:id', authRequired, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const query = await prisma.query.findUnique({ where: { id } });
  if (!query) return res.status(404).json({ error: 'Query not found.' });
  if (!query.userId || query.userId !== req.user.id) {
    return res.status(403).json({ error: 'You cannot delete this entry.' });
  }

  await prisma.$transaction([
    prisma.feedback.deleteMany({ where: { queryId: id } }),
    prisma.query.delete({ where: { id } }),
  ]);
  res.json({ success: true });
}));

const MAX_TITLE = 200;

// Deliberately narrow to exactly the two fields the Sidebar's three-dot menu
// writes (Rename chat / Pin chat) — never a generic "patch any Query field"
// shape. Same trim/min/max convention routes/resources.js already uses for
// its own title field (MAX_TITLE = 200 there too), so a rejected title looks
// and behaves the same way across both save flows.
const patchQuerySchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_TITLE).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((data) => data.title !== undefined || data.pinned !== undefined, {
    message: 'Provide a title or pinned value to update.',
  });

// PATCH /api/queries/:id — rename/pin a history entry (owner only).
//
// Same ownership check as DELETE /queries/:id above, on purpose: this and
// DELETE are the two ways a teacher mutates one history row, and a stricter
// or looser check here would be a silent inconsistency between them.
router.patch('/queries/:id', authRequired, asyncHandler(async (req, res) => {
  const parsed = patchQuerySchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });

  const { id } = req.params;
  const query = await prisma.query.findUnique({ where: { id } });
  if (!query) return res.status(404).json({ error: 'Query not found.' });
  if (!query.userId || query.userId !== req.user.id) {
    return res.status(403).json({ error: 'You cannot modify this entry.' });
  }

  // Built field-by-field from the validated payload, never by spreading
  // req.body — this is what actually keeps the route to just these two
  // columns, independent of whatever the zod schema above happens to allow.
  const data = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.pinned !== undefined) data.pinned = parsed.data.pinned;

  const updated = await prisma.query.update({
    where: { id },
    data,
    select: { id: true, title: true, pinned: true },
  });
  res.json({ success: true, id: updated.id, title: updated.title, pinned: updated.pinned });
}));

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

module.exports = router;
