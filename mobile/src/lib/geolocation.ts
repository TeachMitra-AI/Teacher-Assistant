// GPS read + retry, for the check-in/check-out evidence capture step —
// native port of client/src/lib/geolocation.ts using expo-location instead
// of the browser Geolocation API. Same retry-until-accurate-enough shape,
// same haversine distanceMeters() (must match server/src/lib/
// teacherAttendance.js exactly so the on-screen "you are Xm away" preview
// never disagrees with what the server computes — that preview is only a
// UX nudge; the server always recomputes distance independently).
import * as Location from 'expo-location';

export interface LocationReading {
  lat: number;
  lon: number;
  accuracyMeters: number;
}

export interface GeolocationRetryOptions {
  maxAttempts?: number;
  accuracyThresholdMeters?: number;
  timeoutMs?: number;
}

export class LocationUnavailableError extends Error {}
export class LocationPermissionDeniedError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new LocationUnavailableError('Getting your location took too long. Please try again.')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * Requests foreground location permission (if not already granted) and reads
 * one GPS fix. Throws LocationPermissionDeniedError / LocationUnavailableError
 * with a message ready to show directly — callers don't need to inspect a
 * platform-specific error code the way the web version's isGeolocationError
 * check does.
 */
export async function requestCurrentPosition(timeoutMs = 10000): Promise<Location.LocationObject> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new LocationPermissionDeniedError('Location permission was denied. Please allow location access and try again.');
  }
  try {
    return await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }), timeoutMs);
  } catch (err) {
    if (err instanceof LocationUnavailableError) throw err;
    throw new LocationUnavailableError('Could not get your location. Please try again.');
  }
}

/**
 * Reads location up to `maxAttempts` times, returning as soon as one reading
 * is at or under `accuracyThresholdMeters`. If none ever meet the threshold,
 * returns the best (lowest-accuracy-number) reading seen rather than failing
 * outright — a genuine teacher standing at school still deserves a check-in
 * even on a phone with a noisy GPS chip; the server is what ultimately
 * decides if the reading is good enough.
 */
export async function getLocationWithRetry(
  getPosition: (timeoutMs: number) => Promise<Location.LocationObject>,
  { maxAttempts = 3, accuracyThresholdMeters = 100, timeoutMs = 10000 }: GeolocationRetryOptions = {}
): Promise<LocationReading> {
  let best: LocationReading | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const position = await getPosition(timeoutMs);
    const reading: LocationReading = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracyMeters: position.coords.accuracy ?? Number.MAX_SAFE_INTEGER,
    };
    if (!best || reading.accuracyMeters < best.accuracyMeters) best = reading;
    if (reading.accuracyMeters <= accuracyThresholdMeters) return reading;
  }

  // best is guaranteed non-null: the loop above always runs at least once
  // (maxAttempts defaults to 3 and is never called with 0 in this app), and
  // every iteration either returns early or sets best.
  return best as LocationReading;
}

/**
 * Haversine distance in metres — mirrors server/src/lib/teacherAttendance.js's
 * distanceMeters() exactly.
 */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const EARTH_RADIUS_METERS = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}
