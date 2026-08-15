// Shared by Sidebar.tsx and ChatSearchOverlay.tsx — both show the same
// relative-time metadata on a history item, and neither is the natural
// owner of the other's copy.
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
