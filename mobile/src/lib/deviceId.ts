// A stable per-install identifier sent as raw evidence on check-in/check-out
// — native port of client/src/lib/deviceId.ts using AsyncStorage instead of
// localStorage. Deliberately just an opaque, persisted random id — NOT a
// verified or bound device identity (same scope note as the web version).
// Built without a UUID dependency: `crypto.randomUUID()` isn't available in
// Hermes, and this id only needs to be unique-enough-per-install, not
// cryptographically unpredictable.
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'attendance_device_id';

function randomId(): string {
  const part = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${part()}-${part()}`;
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const id = randomId();
  await AsyncStorage.setItem(STORAGE_KEY, id);
  return id;
}
