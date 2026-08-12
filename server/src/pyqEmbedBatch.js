// PYQ embedding batch script — Phase 6 (docs/pyq-implementation-plan.md
// §9/§17/§20). Computes and persists `Question.embedding` for every
// approved, chapter-classified question that doesn't have one yet, via
// Gemini's embedding endpoint (lib/pyqClustering.js's `embedText`).
//
// OFFLINE BATCH, NOT A LIVE REQUEST PATH — same reasoning §17 already locks
// in for extraction: this is the ONLY part of Phase 6 that spends real
// Gemini quota, so it runs as an operator-invoked script (`npm run
// embed:pyq`), never automatically and never from an HTTP route, mirroring
// pyqSyllabusSeed.js's `npm run seed:pyq` precedent and pyqWorker.js's own
// "pauses rather than retries against the wall" quota discipline on 429.
//
// ELIGIBILITY: reviewStatus 'approved' AND chapterId set (Phase 6 depends on
// Phase 4's approved pool and Phase 5's classification — an unclassified or
// unreviewed question is never embedded). A question that already has an
// embedding is skipped — safe to re-run any number of times; it only ever
// fills genuinely-missing embeddings, never recomputes existing ones (so a
// re-run can't silently drift a cluster's stored similarity values by
// quietly changing the vectors underneath it).
require('dotenv').config();

const { prisma } = require('./lib/db');
const { embedText, DEFAULT_EMBEDDING_ENDPOINT } = require('./lib/pyqClustering');

/** The oldest still-unembedded eligible question, or null if none. */
async function findNextUnembeddedQuestion(prismaClient) {
  return prismaClient.question.findFirst({
    where: { reviewStatus: 'approved', chapterId: { not: null }, embedding: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, text: true },
  });
}

/** Embeds ONE question and persists it. Never touches a question that already has an embedding (caller's job to select eligible rows). */
async function embedAndPersistQuestion({ prismaClient, apiKey, endpoint, fetchImpl, questionId, text }) {
  const { embedding } = await embedText({ apiKey, endpoint, text, fetchImpl });
  await prismaClient.question.update({ where: { id: questionId }, data: { embedding: JSON.stringify(embedding) } });
  return { questionId, dimensions: embedding.length };
}

/**
 * Processes up to `maxQuestions` still-unembedded eligible questions, one
 * Gemini call each, with a pacing delay between calls (mirrors
 * lib/pyqWorker.js's runPyqWorkerLoop). Stops (not retries) on a 429 —
 * quota exhaustion is a signal to try again later, never to burn retries
 * against the wall.
 *
 * @returns {Promise<{ embedded: number, stoppedOnQuota: boolean }>}
 */
async function runPyqEmbedBatch({
  prismaClient = prisma,
  apiKey = process.env.GEMINI_API_KEY,
  endpoint = process.env.PYQ_EMBEDDING_ENDPOINT || DEFAULT_EMBEDDING_ENDPOINT,
  fetchImpl,
  maxQuestions = 100,
  intervalMs = 1000,
  logger = console,
} = {}) {
  let embedded = 0;
  let stoppedOnQuota = false;

  while (embedded < maxQuestions) {
    const next = await findNextUnembeddedQuestion(prismaClient);
    if (!next) break;

    try {
      await embedAndPersistQuestion({ prismaClient, apiKey, endpoint, fetchImpl, questionId: next.id, text: next.text });
      embedded += 1;
      logger.log(`[pyqEmbedBatch] embedded question ${next.id} (${embedded}/${maxQuestions}).`);
    } catch (err) {
      if (err.status === 429) {
        logger.warn('[pyqEmbedBatch] quota exhausted — stopping rather than retrying against the wall.');
        stoppedOnQuota = true;
        break;
      }
      // Any other failure (malformed response, network, non-retriable
      // upstream error): log and skip this ONE question — never let one bad
      // question block the rest of the batch, same per-item isolation
      // discipline extraction/classification already apply per-page.
      logger.error('[pyqEmbedBatch] failed to embed a question, skipping it this run', { questionId: next.id, code: err.code, status: err.status });
      // Move on by marking nothing — findNextUnembeddedQuestion would just
      // return the SAME row again, so guard against an infinite loop on a
      // permanently-broken question by giving it a harmless placeholder
      // that will never match anything, rather than looping forever.
      await prismaClient.question.update({ where: { id: next.id }, data: { embedding: JSON.stringify([]) } });
    }

    if (embedded < maxQuestions) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return { embedded, stoppedOnQuota };
}

/* istanbul ignore if -- real standalone entry point, not exercised by tests */
if (require.main === module) {
  runPyqEmbedBatch()
    .then(({ embedded, stoppedOnQuota }) => {
      console.log(`[pyqEmbedBatch] done — embedded ${embedded} question(s).${stoppedOnQuota ? ' Stopped early: quota exhausted.' : ''}`);
    })
    .catch((err) => {
      console.error('[pyqEmbedBatch] fatal error, exiting', { code: err.code, status: err.status });
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

module.exports = { findNextUnembeddedQuestion, embedAndPersistQuestion, runPyqEmbedBatch };
