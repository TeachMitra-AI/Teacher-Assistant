// GPS read + retry for check-in/check-out evidence (attendance-system-design.html: an accuracy floor and a couple of retries
// before accepting a reading). A pure retry loop (getLocationWithRetry) plus a thin browser wrapper (requestCurrentPosition),
// so the loop is testable with an injected reader.
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
 * Reads location up to `maxAttempts` times, returning at the first reading at or under `accuracyThresholdMeters`. If none
 * qualifies it returns the most accurate reading seen rather than failing, so a teacher at school with a noisy GPS chip can
 * still check in; the server recomputes and decides.
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

  // best is non-null: the loop runs at least once (maxAttempts defaults to 3) and each iteration returns or sets it.
  return best as LocationReading;
}

/** Haversine distance in metres, mirroring distanceMeters() in server/src/lib/teacherAttendance.js so a "you are Xm away" hint never disagrees with the server. A UX nudge only; the server decides. */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const EARTH_RADIUS_METERS = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/** Thin Promise wrapper over the browser API; not unit tested (see the split above). */
export function requestCurrentPosition(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new LocationUnavailableError('Location is not available on this device.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}
