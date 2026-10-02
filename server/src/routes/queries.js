// Teacher-facing data: personal history + feedback on responses.
const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { asyncHandler } = require('../lib/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { threadKeyWhere } = require('../lib/conversationHistory');

const router = express.Router();

// A thread's rows; see lib/conversationHistory.js.
function threadWhere(userId, query) {
  return threadKeyWhere(userId, query.conversationId || query.id);
}

// How many recent rows to scan when choosing which threads to return; bounds the query for a very long history.
const THREAD_SCAN_ROWS = 2000;

// GET /api/queries — the signed-in user's own history (most recent first). One chat thread spans several rows (see
// Query.conversationId); each row carries its conversationId and the client groups them.
router.get('/queries', authRequired, asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  // Explicit select, not every column: `classroomArtifacts` holds up to five full documents, and a 20-row history
  // that pulled it would move hundreds of KB to render a sidebar that shows none of it. The plan is included (small,
  // and tells the client a turn has materials); the artifacts are fetched on demand per turn below.
  // `limit` counts chat threads, not rows: turns sharing a conversationId are one thread, and a row saved before threads
  // existed (no conversationId) is its own thread. So pick the most recent `limit` threads from a light projection,
  // then load every row of those threads, so a reopened thread is never cut off mid-way.
  const recent = await prisma.query.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: THREAD_SCAN_ROWS,
    select: { id: true, conversationId: true },
  });
  const threadKeys = new Set();
  const conversationIds = [];
  const legacyIds = [];
  for (const r of recent) {
    const key = r.conversationId || r.id;
    if (threadKeys.has(key)) continue;
    if (threadKeys.size >= limit) break;
    threadKeys.add(key);
    if (r.conversationId) conversationIds.push(r.conversationId);
    else legacyIds.push(r.id);
  }
  const rows = await prisma.query.findMany({
    where: {
      userId: req.user.id,
      OR: [{ id: { in: legacyIds } }, { conversationId: { in: conversationIds } }, { id: { in: conversationIds } }],
    },
    orderBy: { createdAt: 'desc' },
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
      conversationId: true,
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
    conversationId: q.conversationId,
    // Classroom Mode's plan for this turn, omitted for an ordinary question. Spread rather than set to null so a history
    // payload for a teacher who never uses the mode is unchanged.
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

// Classroom Mode artifacts for one turn. Kept off the history list (see the select above); opening a chat fetches one turn's artifacts.

// Total stored blob size. Five documents of 3-5KB sit well under it; it stops a pathological generation putting a
// megabyte on a row other queries read. Below the 64kb body-parser limit this path uses (index.js), so an oversized
// payload gets this route's clear 413 instead of the parser's opaque failure.
const MAX_ARTIFACTS_BYTES = 60000;

const artifactsSchema = z.object({
  // artifact kind -> rendered Markdown. Kinds aren't enumerated: the route stores what Classroom Mode produced and the
  // client decides what to do, so a sixth artifact needs no change. The size cap bounds it.
  artifacts: z.record(z.string(), z.string()),
});

// GET /api/queries/:id/classroom-artifacts — owner only.
router.get('/queries/:id/classroom-artifacts', authRequired, asyncHandler(async (req, res) => {
  const row = await prisma.query.findUnique({
    where: { id: req.params.id },
    select: { userId: true, classroomArtifacts: true },
  });
  // Same 404 for "missing" and "not yours", so one teacher can't probe another's history (as in routes/resources.js).
  // A null userId (owning User deleted, which SetNulls the FK) counts as "not yours" for everyone.
  if (!row || !row.userId || row.userId !== req.user.id) {
    return res.status(404).json({ error: 'Query not found.' });
  }

  res.json({ artifacts: row.classroomArtifacts ? safeParse(row.classroomArtifacts) : {} });
}));

// PUT /api/queries/:id/classroom-artifacts: owner only. Replaces the whole map rather than merging: the client
// sends every artifact it holds for the turn, and a merge would resurrect one the teacher regenerated into a failure.
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

// DELETE /api/queries: clear the signed-in user's entire history. Declared before "/queries/:id" so "/queries" isn't captured as an :id.
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

// DELETE /api/queries/:id — remove a history entry (owner only). If the row belongs to a chat thread, the whole thread goes.
router.delete('/queries/:id', authRequired, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const query = await prisma.query.findUnique({ where: { id } });
  if (!query) return res.status(404).json({ error: 'Query not found.' });
  if (!query.userId || query.userId !== req.user.id) {
    return res.status(403).json({ error: 'You cannot delete this entry.' });
  }

  const where = threadWhere(req.user.id, query);
  await prisma.$transaction([
    prisma.feedback.deleteMany({ where: { query: where } }),
    prisma.query.deleteMany({ where }),
  ]);
  res.json({ success: true });
}));

const MAX_TITLE = 200;

// Narrow to the two fields the Sidebar menu writes (rename, pin), not a generic "patch any Query field". Same
// trim/min/max as routes/resources.js's title (MAX_TITLE = 200) so rejections behave alike.
const patchQuerySchema = z
  .object({
    title: z.string().trim().min(1).max(MAX_TITLE).optional(),
    pinned: z.boolean().optional(),
  })
  .refine((data) => data.title !== undefined || data.pinned !== undefined, {
    message: 'Provide a title or pinned value to update.',
  });

// PATCH /api/queries/:id: rename or pin a history entry (owner only); applies to the whole chat thread when the row has one. Same ownership check as DELETE /queries/:id,
// since a stricter or looser check between the two would be a silent inconsistency.
router.patch('/queries/:id', authRequired, asyncHandler(async (req, res) => {
  const parsed = patchQuerySchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });

  const { id } = req.params;
  const query = await prisma.query.findUnique({ where: { id } });
  if (!query) return res.status(404).json({ error: 'Query not found.' });
  if (!query.userId || query.userId !== req.user.id) {
    return res.status(403).json({ error: 'You cannot modify this entry.' });
  }

  // Built field by field from the validated payload, never by spreading req.body, so the route writes just these two
  // columns whatever the zod schema allows.
  const data = {};
  if (parsed.data.title !== undefined) data.title = parsed.data.title;
  if (parsed.data.pinned !== undefined) data.pinned = parsed.data.pinned;

  await prisma.query.updateMany({ where: threadWhere(req.user.id, query), data });
  const updated = await prisma.query.findUnique({ where: { id }, select: { id: true, title: true, pinned: true } });
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
