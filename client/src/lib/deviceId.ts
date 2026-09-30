// A stable per-browser id sent as raw evidence on check-in/check-out. Just an opaque persisted random id, not a verified
// device identity; it only gives a future device-binding feature something to compare against.
const STORAGE_KEY = 'attendance_device_id';

export function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const id = crypto.randomUUID();
  localStorage.setItem(STORAGE_KEY, id);
  return id;
}
