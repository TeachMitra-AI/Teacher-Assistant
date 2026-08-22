// Ported verbatim from client/src/lib/historyTime.ts (docs/mobile-app-plan.md
// §9 — a pure function, no DOM dependency). Used by NotificationsScreen for
// the same relative-time metadata the web notification panel shows.
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return date.toLocaleDateString();
}
