// GPS read + retry, for the check-in/check-out evidence capture step
// (attendance-system-design.html §3: "set an accuracy floor... retry a
// couple of times before accepting a reading"). Split into a pure retry
// loop (getLocationWithRetry) and a thin browser-API wrapper
// (requestCurrentPosition) so the retry logic is testable with an injected
// fake reader — no real navigator.geolocation needed in tests, same
// reasoning as resolveFeatureFlag's own extraction.
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

/**
 * Reads location up to `maxAttempts` times, returning as soon as one
 * reading is at or under `accuracyThresholdMeters`. If none ever meet the
 * threshold, returns the best (lowest-accuracy-number) reading seen rather
 * than failing outright — a genuine teacher standing at school still
 * deserves a check-in even on a phone with a noisy GPS chip; the server is
 * what ultimately decides if the reading is good enough (it always
 * recomputes independently, see teacherAttendanceApi.ts's own comment).
 */
export async function getLocationWithRetry(
  getPosition: (options: PositionOptions) => Promise<GeolocationPosition>,
  { maxAttempts = 3, accuracyThresholdMeters = 100, timeoutMs = 10000 }: GeolocationRetryOptions = {}
): Promise<LocationReading> {
  let best: LocationReading | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const position = await getPosition({ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 });
    const reading: LocationReading = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracyMeters: position.coords.accuracy,
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
 * distanceMeters() exactly, so a "you are Xm away" shown before check-in
 * never disagrees with what the server computes once the request lands.
 * Purely a UX nudge (greys out the button early) — the server always
 * recomputes this independently and is what actually decides the result.
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

/** Thin Promise wrapper over the real browser API — not itself unit tested, by design (see the split above). */
export function requestCurrentPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new LocationUnavailableError('Location is not available on this device.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}
