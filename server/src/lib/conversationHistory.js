// Coach conversational memory (COACH_MEMORY_ENABLED). Builds the earlier turns of a chat thread from the database, never
// from client-supplied text, so the client can't forge or inflate history. Scoped to the signed-in user, so another
// user's identical conversationId yields nothing. Only question and answer text are read; classroomPlan and
// classroomArtifacts (up to five documents per row) are never selected.

// A thread's rows: those sharing its conversationId, plus the row whose id IS that key (a pre-thread row a teacher kept
// chatting under: it has no conversationId, and its own id becomes the key for the turns that follow).
function threadKeyWhere(userId, key) {
  return { userId, OR: [{ id: key }, { conversationId: key }] };
}

const MAX_EXCHANGES = 3;
const MAX_ANSWER_CHARS = 1200;
const MAX_HISTORY_CHARS = 6000;

/**
 * Trim rows (oldest first) to the memory budget: the last MAX_EXCHANGES exchanges, each answer cut to MAX_ANSWER_CHARS,
 * then the oldest exchanges dropped until the total fits MAX_HISTORY_CHARS. The latest exchange is always kept.
 * @param {{queryText: string, responseText: string}[]} rows
 * @returns {{query: string, answer: string}[]}
 */
function trimHistory(rows) {
  const exchanges = rows.slice(-MAX_EXCHANGES).map((r) => ({
    query: r.queryText,
    answer: r.responseText.length > MAX_ANSWER_CHARS ? `${r.responseText.slice(0, MAX_ANSWER_CHARS)}…` : r.responseText,
  }));
  const size = (e) => e.query.length + e.answer.length;
  while (exchanges.length > 1 && exchanges.reduce((n, e) => n + size(e), 0) > MAX_HISTORY_CHARS) exchanges.shift();
  const last = exchanges[exchanges.length - 1];
  if (last && size(last) > MAX_HISTORY_CHARS) last.answer = last.answer.slice(0, Math.max(0, MAX_HISTORY_CHARS - last.query.length));
  return exchanges;
}

/**
 * Load the earlier turns of a thread.
 * @param {object} prisma
 * @param {{userId: string, conversationId: string, supersedes?: string|null}} params
 *   `supersedes` is the row an edit-and-resubmit replaces: that row and every later one are left out, since the edited
 *   question replaces that turn and the turns after it were answered against the old text.
 * @returns {Promise<{exchanges: {query: string, answer: string}[], superseded: {id: string, createdAt: Date}|null}>}
 */
async function loadThreadHistory(prisma, { userId, conversationId, supersedes }) {
  const where = threadKeyWhere(userId, conversationId);
  const superseded = supersedes
    ? await prisma.query.findFirst({ where: { AND: [where, { id: supersedes }] }, select: { id: true, createdAt: true } })
    : null;
  const rows = await prisma.query.findMany({
    where: superseded ? { AND: [where, { createdAt: { lt: superseded.createdAt } }] } : where,
    orderBy: { createdAt: 'desc' },
    take: MAX_EXCHANGES,
    select: { queryText: true, responseText: true },
  });
  return { exchanges: trimHistory(rows.reverse()), superseded };
}

module.exports = { threadKeyWhere, trimHistory, loadThreadHistory, MAX_EXCHANGES, MAX_ANSWER_CHARS, MAX_HISTORY_CHARS };
