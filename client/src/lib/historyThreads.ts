import type { HistoryItem } from '../types';

// A chat thread is several server rows (one per turn) sharing a conversationId; a row saved before threads existed has
// none and is its own thread, and its id becomes the thread key if the teacher keeps chatting in it (see
// routes/queries.js threadWhere). Folds the server's newest-first rows into one sidebar item per thread, in recency order.
// The item's `id` is the OLDEST row's, so it stays stable as turns are added; `query` is the first question (the default
// label); everything else (answer, title, pin, time) is the newest turn's, which is what the server keeps in step.
export function groupHistory(rows: HistoryItem[]): HistoryItem[] {
  const threads = new Map<string, HistoryItem[]>();
  for (const row of rows) {
    const key = row.conversationId || row.id;
    const turns = threads.get(key);
    if (turns) turns.push(row);
    else threads.set(key, [row]);
  }
  return [...threads.entries()].map(([key, newestFirst]) => {
    const turns = [...newestFirst].reverse();
    const newest = newestFirst[0];
    return { ...newest, id: turns[0].id, query: turns[0].query, conversationId: key, turns };
  });
}
