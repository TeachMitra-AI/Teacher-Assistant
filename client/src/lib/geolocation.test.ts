import { describe, expect, test, vi } from 'vitest';
import { getLocationWithRetry, distanceMeters } from './geolocation';

function fakePosition(accuracy: number, lat = 12.9716, lon = 77.5946): GeolocationPosition {
  return {
    coords: {
      latitude: lat,
      longitude: lon,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      toJSON: () => ({}),
    },
    timestamp: Date.now(),
    toJSON: () => ({}),
  } as GeolocationPosition;
}

describe('getLocationWithRetry', () => {
  test('returns immediately once a reading meets the accuracy threshold', async () => {
    const getPosition = vi.fn().mockResolvedValueOnce(fakePosition(30));
    const reading = await getLocationWithRetry(getPosition, { accuracyThresholdMeters: 100 });

    expect(reading).toEqual({ lat: 12.9716, lon: 77.5946, accuracyMeters: 30 });
    expect(getPosition).toHaveBeenCalledTimes(1);
  });

  test('retries a poor reading up to maxAttempts, then returns the best one seen', async () => {
    const getPosition = vi
      .fn()
      .mockResolvedValueOnce(fakePosition(500))
      .mockResolvedValueOnce(fakePosition(300))
      .mockResolvedValueOnce(fakePosition(400));

    const reading = await getLocationWithRetry(getPosition, { maxAttempts: 3, accuracyThresholdMeters: 100 });

    expect(getPosition).toHaveBeenCalledTimes(3);
    expect(reading.accuracyMeters).toBe(300); // the best of the three, not the last
  });

  test('stops retrying as soon as the threshold is met, even mid-sequence', async () => {
    const getPosition = vi
      .fn()
      .mockResolvedValueOnce(fakePosition(500))
      .mockResolvedValueOnce(fakePosition(50));

    const reading = await getLocationWithRetry(getPosition, { maxAttempts: 5, accuracyThresholdMeters: 100 });

    expect(getPosition).toHaveBeenCalledTimes(2);
    expect(reading.accuracyMeters).toBe(50);
  });

  test('passes high-accuracy request options through to the reader', async () => {
    const getPosition = vi.fn().mockResolvedValueOnce(fakePosition(20));
    await getLocationWithRetry(getPosition, { timeoutMs: 5000 });

    expect(getPosition).toHaveBeenCalledWith({ enableHighAccuracy: true, timeout: 5000, maximumAge: 0 });
  });
});

describe('distanceMeters', () => {
  test('the same point is zero metres from itself', () => {
    expect(distanceMeters(12.9716, 77.5946, 12.9716, 77.5946)).toBeCloseTo(0, 6);
  });

  test('one degree of latitude is approximately 111km, sanity-checking the haversine formula', () => {
    expect(distanceMeters(0, 0, 1, 0)).toBeCloseTo(111320, -3);
  });
});
