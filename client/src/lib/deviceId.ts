// A stable per-browser identifier sent as raw evidence on check-in/check-out
// (attendance-plan-review.md §11: "device id" is part of what gets
// recorded). Deliberately just an opaque, persisted random id — NOT a
// verified or bound device identity. Recognizing/flagging an unfamiliar
// device is Phase 4 (device binding), not built yet; this only exists so
// that future feature has something to compare against.
const STORAGE_KEY = 'attendance_device_id';

export function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const id = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, id);
  return id;
}
