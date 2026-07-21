// "My Library" — teacher-owned saved resources (CRUD).
//
// Every resource is private to the authenticated user. Ownership is ALWAYS
// derived from the access token (req.user.id) — never from the request body —
// and a resource that does not exist OR does not belong to the caller returns
// the same 404, so one teacher can never probe for another's resources.
const express = require('express');
const { z } = require('zod');

const { prisma } = require('../lib/db');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

// NOTE: request bodies are parsed by the app-level JSON middleware in index.js,
// which applies a larger 64kb limit to /api/resources paths (a full lesson plan
// with several structured sections can exceed the default 16kb) while leaving
// the 16kb limit intact for every other route.

const RESOURCE_TYPES = ['lesson_plan', 'classroom_activity', 'assessment', 'explanation', 'general'];

const MAX_TITLE = 200;
const MAX_CONTENT = 50000;
const MAX_STRUCTURED = 50000;
const MAX_META = 80; // grade / subject
const MAX_LANGUAGE = 20;
const MAX_SOURCE_ID = 60;

// Create payload. Note there is deliberately NO userId/ownerId/schoolId field:
// ownership is taken from the token, so a client-supplied id cannot be honored.
// `.strict()` rejects unknown keys (including any attempt to inject userId).
const createSchema = z
  .object({
    type: z.enum(RESOURCE_TYPES).default('general'),
    title: z.string().trim().min(1).max(MAX_TITLE),
    grade: z.string().trim().max(MAX_META).optional(),
    subject: z.string().trim().max(MAX_META).optional(),
    language: z.string().trim().max(MAX_LANGUAGE).default('en'),
    content: z.string().max(MAX_CONTENT).default(''),
    structured: z.string().max(MAX_STRUCTURED).optional(),
    sourceQueryId: z.string().trim().max(MAX_SOURCE_ID).optional(),
  })
  .strict();

// Update payload — every field optional, but at least one must be present.
const updateSchema = z
  .object({
    type: z.enum(RESOURCE_TYPES).optional(),
    title: z.string().trim().min(1).max(MAX_TITLE).optional(),
    grade: z.string().trim().max(MAX_META).optional(),
    subject: z.string().trim().max(MAX_META).optional(),
    language: z.string().trim().max(MAX_LANGUAGE).optional(),
    content: z.string().max(MAX_CONTENT).optional(),
    structured: z.string().max(MAX_STRUCTURED).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update.' });

// Shape a DB row into the client DTO — only fields the client needs, nothing
// internal. Keeps ownership/plumbing columns from leaking.
function toDto(r) {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    grade: r.grade,
    subject: r.subject,
    language: r.language,
    content: r.content,
    structured: r.structured,
    sourceQueryId: r.sourceQueryId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// Fetch a resource and assert the caller owns it. Returns the row, or null if
// it does not exist OR belongs to someone else — callers translate null into a
// single 404 so existence is never leaked across users.
async function findOwned(id, userId) {
  const resource = await prisma.resource.findUnique({ where: { id } });
  if (!resource || resource.userId !== userId) return null;
  return resource;
}

// GET /api/resources?type=&q=&limit= — the caller's own library (newest first).
router.get('/resources', authRequired, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);

  const where = { userId: req.user.id };

  const type = typeof req.query.type === 'string' ? req.query.type : '';
  if (type && RESOURCE_TYPES.includes(type)) where.type = type;

  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200) : '';
  if (q) {
    // SQLite `contains` is case-insensitive for ASCII by default in Prisma.
    where.OR = [{ title: { contains: q } }, { content: { contains: q } }];
  }

  const rows = await prisma.resource.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });

  res.json({ resources: rows.map(toDto) });
});

// POST /api/resources — save a new resource into the caller's library.
router.post('/resources', authRequired, async (req, res) => {
  const parsed = createSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid resource.' });
  }
  const data = parsed.data;

  const created = await prisma.resource.create({
    data: {
      // Ownership from the token — never the client.
      userId: req.user.id,
      schoolId: req.user.schoolId,
      type: data.type,
      title: data.title,
      grade: data.grade,
      subject: data.subject,
      language: data.language,
      content: data.content,
      structured: data.structured,
      sourceQueryId: data.sourceQueryId,
    },
  });

  res.status(201).json({ resource: toDto(created) });
});

// GET /api/resources/:id — a single owned resource (404 if missing or not yours).
router.get('/resources/:id', authRequired, async (req, res) => {
  const resource = await findOwned(req.params.id, req.user.id);
  if (!resource) return res.status(404).json({ error: 'Resource not found.' });
  res.json({ resource: toDto(resource) });
});

// PATCH /api/resources/:id — update an owned resource.
router.patch('/resources/:id', authRequired, async (req, res) => {
  const parsed = updateSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid update.' });
  }

  const existing = await findOwned(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Resource not found.' });

  const updated = await prisma.resource.update({
    where: { id: existing.id },
    data: parsed.data,
  });

  res.json({ resource: toDto(updated) });
});

// DELETE /api/resources/:id — remove an owned resource.
router.delete('/resources/:id', authRequired, async (req, res) => {
  const existing = await findOwned(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Resource not found.' });

  await prisma.resource.delete({ where: { id: existing.id } });
  res.json({ success: true });
});

module.exports = router;
