// PYQ clustering batch script — Phase 6 (docs/pyq-implementation-plan.md
// §9/§20). Runs the exact -> lexical -> semantic pipeline
// (lib/pyqClustering.js's planChapterClustering) over every chapter that
// currently has approved, chapter-classified questions with no cluster
// membership yet, and persists the result as QuestionCluster/
// QuestionClusterMember rows.
//
// "Exact/lexical clustering is deterministic and can run inline; semantic
// clustering is an offline batch script" (Phase 6's own Scope line): both
// halves live in the SAME script here because neither makes a live Gemini
// call — the semantic pass only ever COMPARES already-computed embeddings
// (see pyqEmbedBatch.js, the actual "offline batch" cost center that talks
// to Gemini). This script itself makes zero Gemini calls.
//
// ELIGIBILITY: reviewStatus 'approved' AND chapterId set (Phase 6 depends on
// Phase 4's approved pool and Phase 5's classification, per the plan's own
// Phase 6 "Dependencies on previous phases" line) AND not already a member
// of ANY cluster. That last condition is the ENTIRE idempotency mechanism —
// once a question is clustered, it structurally drops out of every future
// run's candidate pool, so a rerun can never move it, duplicate its
// membership, or touch an already-decided cluster. Existing clusters with
// status 'rejected' are excluded from matching (a human's negative decision
// is respected going forward — a new question never silently re-opens a
// cluster a reviewer explicitly rejected); 'proposed' and 'confirmed'
// clusters can both still gain new members from fresh approvals, since that
// is the entire point of ongoing recurrence tracking.
require('dotenv').config();

const { prisma } = require('./lib/db');
const { planChapterClustering, pickReferenceQuestion } = require('./lib/pyqClustering');

/** Tolerant JSON parse for Question.embedding — null/empty are both "no usable embedding". */
function safeParseEmbedding(json) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

/** Every chapterId that currently has at least one unclustered, eligible question. */
async function findChaptersNeedingClustering(prismaClient) {
  const rows = await prismaClient.question.findMany({
    where: { reviewStatus: 'approved', chapterId: { not: null }, clusterMemberships: { none: {} } },
    select: { chapterId: true },
    distinct: ['chapterId'],
  });
  return rows.map((r) => r.chapterId).filter(Boolean);
}

/** Runs the full pipeline for ONE chapter and persists the result. Returns { newClusterCount, joinCount }. */
async function clusterChapter(prismaClient, chapterId) {
  const rawPool = await prismaClient.question.findMany({
    where: { reviewStatus: 'approved', chapterId, clusterMemberships: { none: {} } },
    select: { id: true, text: true, year: true, embedding: true },
  });
  if (rawPool.length === 0) return { newClusterCount: 0, joinCount: 0 };

  const pool = rawPool.map((q) => ({ id: q.id, text: q.text, year: q.year, embedding: safeParseEmbedding(q.embedding) }));

  const existingClusters = await prismaClient.questionCluster.findMany({
    where: { chapterId, status: { in: ['proposed', 'confirmed'] } },
    include: { members: { include: { question: { select: { id: true, text: true, year: true, embedding: true } } } } },
  });
  const existingRefs = existingClusters
    .filter((c) => c.members.length > 0)
    .map((c) => {
      const reference = pickReferenceQuestion(c.members.map((m) => m.question));
      return {
        clusterId: c.id,
        text: reference.text,
        year: reference.year,
        id: reference.id,
        embedding: safeParseEmbedding(reference.embedding),
      };
    });

  const plan = planChapterClustering({ pool, existingRefs });

  return prismaClient.$transaction(async (tx) => {
    let newClusterCount = 0;
    let joinCount = 0;

    for (const nc of plan.newClusters) {
      const cluster = await tx.questionCluster.create({ data: { chapterId, method: nc.method, status: 'proposed' } });
      for (const m of nc.members) {
        await tx.questionClusterMember.create({ data: { clusterId: cluster.id, questionId: m.questionId, similarity: m.similarity } });
      }
      newClusterCount += 1;
      joinCount += nc.members.length;
    }

    for (const j of plan.joins) {
      await tx.questionClusterMember.create({ data: { clusterId: j.clusterId, questionId: j.questionId, similarity: j.similarity } });
      joinCount += 1;
    }

    return { newClusterCount, joinCount };
  });
}

/**
 * Processes every chapter with unclustered eligible questions. Safe to call
 * repeatedly — a chapter with nothing new since the last run does zero work.
 * @returns {Promise<{ chaptersProcessed: number, newClusters: number, joins: number }>}
 */
async function runPyqClusterBatch({ prismaClient = prisma, logger = console } = {}) {
  const chapterIds = await findChaptersNeedingClustering(prismaClient);

  let totalNewClusters = 0;
  let totalJoins = 0;
  for (const chapterId of chapterIds) {
    const { newClusterCount, joinCount } = await clusterChapter(prismaClient, chapterId);
    totalNewClusters += newClusterCount;
    totalJoins += joinCount;
    if (newClusterCount > 0 || joinCount > 0) {
      logger.log(`[pyqClusterBatch] chapter ${chapterId}: ${newClusterCount} new cluster(s), ${joinCount} member join(s).`);
    }
  }

  return { chaptersProcessed: chapterIds.length, newClusters: totalNewClusters, joins: totalJoins };
}

/* istanbul ignore if -- real standalone entry point, not exercised by tests */
if (require.main === module) {
  runPyqClusterBatch()
    .then(({ chaptersProcessed, newClusters, joins }) => {
      console.log(`[pyqClusterBatch] done — ${chaptersProcessed} chapter(s) scanned, ${newClusters} new cluster(s), ${joins} member join(s).`);
    })
    .catch((err) => {
      console.error('[pyqClusterBatch] fatal error, exiting', err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = { findChaptersNeedingClustering, clusterChapter, runPyqClusterBatch, safeParseEmbedding };
