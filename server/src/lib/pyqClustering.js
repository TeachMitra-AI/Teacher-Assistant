// PYQ duplicate/paraphrase detection + recurrence — Phase 6
// (docs/pyq-implementation-plan.md §9/§20). Pure, DB-free functions only —
// server/src/pyqClusterBatch.js and server/src/pyqEmbedBatch.js own all
// Prisma reads/writes and call these as pure steps, mirroring the
// extraction/classification split already established in
// attachments/extractPyqPage.js + lib/pyqWorker.js and
// attachments/classifyPyqChapter.js + lib/pyqWorker.js.
//
// THREE PASSES, CHEAPEST FIRST, EXACTLY AS APPROVED IN §9 (a product
// decision confirmed unchanged for Phase 6, including the exact worked
// example "force = 20N, mass = 4kg" / "force = 15N, mass = 3kg" collapsing
// into ONE cluster despite different numbers — numeric literals ARE masked,
// deliberately, at both the exact and lexical passes):
//   1. exact    — numeric-masked normalized text, byte-identical after masking
//   2. lexical  — character-trigram similarity on the SAME masked text, for
//                 near-identical wording the exact hash doesn't catch
//   3. semantic — cosine similarity over Gemini embeddings of the RAW
//                 (unmasked) text, chapter-scoped only, never corpus-wide
//
// CLUSTER MEMBERSHIP: a question belongs to AT MOST ONE cluster (confirmed
// product decision). Passes run in this fixed order and a question claimed
// by an earlier pass is removed from every later pass's candidate pool —
// this alone is what makes clustering idempotent AND avoids any cluster
// merge/split logic (never needed, because a question can never be
// reconsidered once matched).
//
// REFERENCE QUESTION: QuestionClusterMember.similarity is documented
// (schema.prisma) as "vs. the cluster's reference question," but no field
// stores which member IS the reference — recomputed deterministically every
// time (earliest `year`, tie-broken by `id`) rather than stored, so no
// schema change is needed.

const { classifyGeminiError, computeBackoffMs, parseRetryAfter } = require('./geminiPolicy');

// §9's own starting point for the semantic pass.
const SEMANTIC_SIMILARITY_THRESHOLD = 0.85;

// The lexical pass has no value named in the plan, so this was measured
// empirically against §9's own worked paraphrase example ("roots" vs
// "zeroes" of the same masked quadratic) rather than reused from the
// semantic threshold: whole-string character-trigram Dice similarity for
// that realistic single-word paraphrase swap measures ~0.46 (NOT anywhere
// near 0.85 — trigram overlap degrades fast once a key word's length
// differs, even though the surrounding text is identical). 0.4 is chosen to
// sit just below that measured value. Same "not empirically tuned against
// real approved content yet" caveat §9 applies to the semantic threshold
// applies here too.
const LEXICAL_SIMILARITY_THRESHOLD = 0.4;

const DEFAULT_EMBEDDING_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent';

// ---- Text normalization --------------------------------------------------

/**
 * Lowercases, masks every numeric literal (int or decimal) with a single
 * placeholder token, strips punctuation, and collapses whitespace. Used as
 * the shared input to BOTH the exact pass (grouped by exact string equality)
 * and the lexical pass (trigram similarity over this same normalized form) —
 * one normalization convention, not two incompatible ones.
 * @param {unknown} text
 * @returns {string}
 */
function normalizeAndMaskNumbers(text) {
  if (typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/\d+(\.\d+)?/g, '#')
    .replace(/[^\p{L}\p{N}#\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The exact-pass grouping key. Two questions with the same signature are candidate exact duplicates. */
function exactSignature(text) {
  return normalizeAndMaskNumbers(text);
}

/** Character trigrams (3-grams), padded at the edges — a standard, simple shingle scheme. */
function characterTrigrams(text) {
  const padded = `  ${text} `;
  const grams = new Set();
  for (let i = 0; i < padded.length - 2; i += 1) grams.add(padded.slice(i, i + 3));
  return grams;
}

/** Dice coefficient over character trigrams — 1.0 identical, 0.0 nothing in common. */
function trigramSimilarity(textA, textB) {
  const a = characterTrigrams(textA);
  const b = characterTrigrams(textB);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) if (b.has(gram)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

/** Cosine similarity between two equal-length embedding vectors. 0 for any malformed/mismatched input, never throws. */
function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ---- Gemini embeddings ----------------------------------------------------

/**
 * One embedding call for one question's RAW text (never masked — embeddings
 * need real semantic content). Deliberately NOT built on GeminiService
 * (generateContent's request/response shape is entirely different from
 * embedContent's) — a small, dedicated fetch wrapper reusing the SAME
 * reliability primitives (lib/geminiPolicy.js) every other Gemini call in
 * this codebase already shares, rather than a parallel, undocumented retry
 * scheme.
 *
 * @param {{ apiKey: string, endpoint?: string, text: string, fetchImpl?: Function,
 *   timeoutMs?: number, maxRetries?: number, backoffBaseMs?: number, backoffCapMs?: number,
 *   now?: () => number, rng?: () => number, sleep?: (ms:number) => Promise<void> }} params
 * @returns {Promise<{ embedding: number[] }>}
 */
async function embedText({
  apiKey,
  endpoint = DEFAULT_EMBEDDING_ENDPOINT,
  text,
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = 15000,
  maxRetries = 2,
  backoffBaseMs = 500,
  backoffCapMs = 8000,
  now = () => Date.now(),
  rng = Math.random,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  let attempt = 0;
  for (;;) {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (fetchError) {
      const { retriable } = classifyGeminiError(fetchError);
      if (!retriable || attempt >= maxRetries) throw fetchError;
      await sleep(computeBackoffMs(attempt, { baseMs: backoffBaseMs, capMs: backoffCapMs, rng }));
      attempt += 1;
      continue;
    }

    if (!response.ok) {
      const errorText = await response.text();
      const err = new Error(`Gemini embedding API error: ${response.status}`);
      err.status = response.status;
      err.details = errorText;
      const { retriable } = classifyGeminiError(err);
      if (!retriable || attempt >= maxRetries) throw err;
      const retryAfterMs = parseRetryAfter(
        response.headers && typeof response.headers.get === 'function' ? response.headers.get('retry-after') : null,
        now()
      );
      await sleep(computeBackoffMs(attempt, { baseMs: backoffBaseMs, capMs: backoffCapMs, retryAfterMs, rng }));
      attempt += 1;
      continue;
    }

    const body = await response.json();
    const values = body && body.embedding && body.embedding.values;
    if (!Array.isArray(values) || values.length === 0) {
      const err = new Error('Gemini embedding response was malformed (no embedding.values array).');
      err.code = 'INVALID_AI_RESPONSE';
      throw err;
    }
    return { embedding: values };
  }
}

// ---- Reference question ---------------------------------------------------

/**
 * The deterministic "reference" of a set of questions (a cluster's existing
 * members, or a freshly-matched group about to become a new cluster):
 * earliest `year`, tie-broken by `id` (stable — cuid()s never repeat).
 * Never stored — recomputed every time it's needed.
 * @param {Array<{id: string, year: number}>} questions
 */
function pickReferenceQuestion(questions) {
  return questions.slice().sort((a, b) => (a.year !== b.year ? a.year - b.year : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))[0];
}

// ---- Clustering passes -----------------------------------------------------
//
// Every pass takes:
//   pool         — still-unclustered, eligible questions in ONE chapter:
//                  Array<{id, text, year, embedding?: number[]|null}>
//   existingRefs — one reference row per existing (non-rejected) cluster in
//                  the SAME chapter: Array<{clusterId, text, year, id, embedding?}>
// and returns:
//   { joins: Array<{clusterId, questionId, similarity: number|null}>,
//     newClusters: Array<{method, members: Array<{questionId, similarity: number|null}>}>,
//     claimed: Set<string> }
// `similarity` is always null for exact/lexical members, per schema.prisma's
// own comment on QuestionClusterMember.similarity.

function runExactPass(pool, existingRefs) {
  const claimed = new Set();
  const joins = [];
  const newClusters = [];

  const existingBySignature = new Map();
  for (const ref of existingRefs) {
    const sig = exactSignature(ref.text);
    if (sig) existingBySignature.set(sig, ref.clusterId);
  }

  const groups = new Map();
  for (const q of pool) {
    const sig = exactSignature(q.text);
    if (!sig) continue; // empty/invalid text can never match anything
    if (existingBySignature.has(sig)) {
      joins.push({ clusterId: existingBySignature.get(sig), questionId: q.id, similarity: null });
      claimed.add(q.id);
      continue;
    }
    if (!groups.has(sig)) groups.set(sig, []);
    groups.get(sig).push(q);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    newClusters.push({ method: 'exact', members: group.map((q) => ({ questionId: q.id, similarity: null })) });
    for (const q of group) claimed.add(q.id);
  }

  return { joins, newClusters, claimed };
}

function runLexicalPass(pool, existingRefs, threshold = LEXICAL_SIMILARITY_THRESHOLD) {
  const claimed = new Set();
  const joins = [];
  const newClusters = [];

  const withSignature = pool.map((q) => ({ ...q, sig: exactSignature(q.text) })).filter((q) => q.sig);
  const remaining = [];

  for (const q of withSignature) {
    let matchedClusterId = null;
    for (const ref of existingRefs) {
      if (trigramSimilarity(q.sig, exactSignature(ref.text)) >= threshold) { matchedClusterId = ref.clusterId; break; }
    }
    if (matchedClusterId) {
      joins.push({ clusterId: matchedClusterId, questionId: q.id, similarity: null });
      claimed.add(q.id);
    } else {
      remaining.push(q);
    }
  }

  const used = new Set();
  for (let i = 0; i < remaining.length; i += 1) {
    if (used.has(remaining[i].id)) continue;
    const group = [remaining[i]];
    for (let j = i + 1; j < remaining.length; j += 1) {
      if (used.has(remaining[j].id)) continue;
      if (trigramSimilarity(remaining[i].sig, remaining[j].sig) >= threshold) group.push(remaining[j]);
    }
    if (group.length >= 2) {
      newClusters.push({ method: 'lexical', members: group.map((q) => ({ questionId: q.id, similarity: null })) });
      for (const q of group) { used.add(q.id); claimed.add(q.id); }
    }
  }

  return { joins, newClusters, claimed };
}

function runSemanticPass(pool, existingRefs, threshold = SEMANTIC_SIMILARITY_THRESHOLD) {
  const claimed = new Set();
  const joins = [];
  const newClusters = [];

  // Only questions with an already-computed embedding are candidates —
  // pyqEmbedBatch.js is the only thing that ever populates Question.embedding,
  // and this pass never calls Gemini itself (offline-batch cost discipline).
  const embedded = pool.filter((q) => Array.isArray(q.embedding) && q.embedding.length > 0);
  const embeddedRefs = existingRefs.filter((r) => Array.isArray(r.embedding) && r.embedding.length > 0);

  for (const q of embedded) {
    let best = null;
    for (const ref of embeddedRefs) {
      const sim = cosineSimilarity(q.embedding, ref.embedding);
      if (sim >= threshold && (!best || sim > best.similarity)) best = { clusterId: ref.clusterId, similarity: sim };
    }
    if (best) {
      joins.push({ clusterId: best.clusterId, questionId: q.id, similarity: best.similarity });
      claimed.add(q.id);
    }
  }

  const remaining = embedded.filter((q) => !claimed.has(q.id));
  const used = new Set();
  for (let i = 0; i < remaining.length; i += 1) {
    if (used.has(remaining[i].id)) continue;
    const group = [remaining[i]];
    for (let j = i + 1; j < remaining.length; j += 1) {
      if (used.has(remaining[j].id)) continue;
      if (cosineSimilarity(remaining[i].embedding, remaining[j].embedding) >= threshold) group.push(remaining[j]);
    }
    if (group.length < 2) continue;

    // Similarity is stored "vs. the cluster's reference question" (schema
    // comment) — recompute every member's similarity against the
    // DETERMINISTIC reference (pickReferenceQuestion), not against whichever
    // question happened to be the pivot during matching above.
    const reference = pickReferenceQuestion(group);
    const members = group.map((q) => ({
      questionId: q.id,
      similarity: q.id === reference.id ? null : cosineSimilarity(q.embedding, reference.embedding),
    }));
    newClusters.push({ method: 'semantic', members });
    for (const q of group) { used.add(q.id); claimed.add(q.id); }
  }

  return { joins, newClusters, claimed };
}

/**
 * Runs all three passes, in order, over one chapter's still-unclustered
 * eligible questions. Pure — takes and returns plain data; the caller
 * (pyqClusterBatch.js) does every Prisma read/write.
 * @param {{ pool: Array<object>, existingRefs: Array<object>, thresholds?: {lexical?: number, semantic?: number} }} params
 */
function planChapterClustering({ pool, existingRefs, thresholds = {} }) {
  const lexicalThreshold = thresholds.lexical ?? LEXICAL_SIMILARITY_THRESHOLD;
  const semanticThreshold = thresholds.semantic ?? SEMANTIC_SIMILARITY_THRESHOLD;

  const joins = [];
  const newClusters = [];

  const exact = runExactPass(pool, existingRefs);
  joins.push(...exact.joins);
  newClusters.push(...exact.newClusters);
  let remaining = pool.filter((q) => !exact.claimed.has(q.id));

  const lexical = runLexicalPass(remaining, existingRefs, lexicalThreshold);
  joins.push(...lexical.joins);
  newClusters.push(...lexical.newClusters);
  remaining = remaining.filter((q) => !lexical.claimed.has(q.id));

  const semantic = runSemanticPass(remaining, existingRefs, semanticThreshold);
  joins.push(...semantic.joins);
  newClusters.push(...semantic.newClusters);

  return { joins, newClusters };
}

// ---- Recurrence -------------------------------------------------------------

/**
 * `occurrenceCount` per §9's pseudocode, with the Phase-3 architecture
 * review's approved correction applied: dedupe on the SITTING tuple
 * (boardId, subjectId, year, examType), not raw examPaperId — so sibling
 * sets/series of the SAME sitting (different setLabel, same year+examType)
 * collapse to ONE occurrence instead of inflating the count. A question
 * duplicated within one paper collapses for the same reason (same sitting
 * tuple). Hindi/English translation pairs collapse to their translation
 * target's own sitting, via `translationTargets`.
 *
 * @param {Array<{questionId: string, boardId: string, subjectId: string, year: number, examType: string, translationOfId: string|null}>} members
 * @param {Map<string, {boardId: string, subjectId: string, year: number, examType: string}>} [translationTargets]
 *   sitting info for any translationOfId TARGET not already present among `members`, keyed by questionId.
 * @param {{yearFrom?: number, yearTo?: number}} [range]
 * @returns {{ count: number, years: number[] }}
 */
function occurrenceCount(members, translationTargets = new Map(), range = {}) {
  const { yearFrom, yearTo } = range;
  const inRange = (year) => (yearFrom == null || year >= yearFrom) && (yearTo == null || year <= yearTo);

  const canonical = [];
  for (const m of members) {
    let sitting = m;
    if (m.translationOfId) {
      const target = translationTargets.get(m.translationOfId);
      if (target) sitting = target; // resolved to the canonical original's own sitting
      // else: target unknown to the caller — fall back to this row's own
      // sitting rather than silently dropping a real occurrence.
    }
    if (!inRange(sitting.year)) continue;
    canonical.push(sitting);
  }

  const sittingKey = (s) => `${s.boardId}|${s.subjectId}|${s.year}|${s.examType}`;
  const distinctSittings = new Set(canonical.map(sittingKey));
  const years = [...new Set(canonical.map((s) => s.year))].sort((a, b) => a - b);
  return { count: distinctSittings.size, years };
}

module.exports = {
  SEMANTIC_SIMILARITY_THRESHOLD,
  LEXICAL_SIMILARITY_THRESHOLD,
  DEFAULT_EMBEDDING_ENDPOINT,
  normalizeAndMaskNumbers,
  exactSignature,
  characterTrigrams,
  trigramSimilarity,
  cosineSimilarity,
  embedText,
  pickReferenceQuestion,
  runExactPass,
  runLexicalPass,
  runSemanticPass,
  planChapterClustering,
  occurrenceCount,
};
