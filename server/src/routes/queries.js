// Teacher-facing data: personal history + feedback on responses.
const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// GET /api/queries — the signed-in user's own history (most recent first).
router.get('/queries', authRequired, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const rows = await prisma.query.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { feedback: { where: { userId: req.user.id }, take: 1 } },
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
  }));

  res.json({ queries });
});

const feedbackSchema = z.object({
  queryId: z.string().min(1),
  rating: z.enum(['helpful', 'not_helpful']),
});

// POST /api/feedback — thumbs up/down on a response.
router.post('/feedback', authRequired, async (req, res) => {
  const parsed = feedbackSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid feedback.' });
  const { queryId, rating } = parsed.data;

  const query = await prisma.query.findUnique({ where: { id: queryId } });
  if (!query) return res.status(404).json({ error: 'Query not found.' });
  if (query.userId && query.userId !== req.user.id) {
    return res.status(403).json({ error: 'You cannot rate this response.' });
  }

  await prisma.feedback.create({ data: { queryId, userId: req.user.id, rating } });
  res.status(201).json({ success: true });
});

// DELETE /api/queries — clear the signed-in user's entire history.
// NOTE: declared before the "/queries/:id" route so "/queries" is not captured
// as an :id param.
router.delete('/queries', authRequired, async (req, res) => {
  const userId = req.user.id;
  // Feedback has a required FK to Query (no cascade in the schema), so remove
  // the related feedback first, then the queries — both in one transaction.
  const [, deleted] = await prisma.$transaction([
    prisma.feedback.deleteMany({ where: { query: { userId } } }),
    prisma.query.deleteMany({ where: { userId } }),
  ]);
  res.json({ success: true, deleted: deleted.count });
});

// DELETE /api/queries/:id — remove a single history entry (owner only).
router.delete('/queries/:id', authRequired, async (req, res) => {
  const { id } = req.params;
  const query = await prisma.query.findUnique({ where: { id } });
  if (!query) return res.status(404).json({ error: 'Query not found.' });
  if (query.userId && query.userId !== req.user.id) {
    return res.status(403).json({ error: 'You cannot delete this entry.' });
  }

  await prisma.$transaction([
    prisma.feedback.deleteMany({ where: { queryId: id } }),
    prisma.query.delete({ where: { id } }),
  ]);
  res.json({ success: true });
});

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

module.exports = router;
