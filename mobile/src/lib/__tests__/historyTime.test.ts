import { formatTimestamp } from '../historyTime';

describe('formatTimestamp', () => {
  const NOW = new Date('2026-08-21T12:00:00.000Z').getTime();

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns "Just now" for under a minute', () => {
    expect(formatTimestamp(new Date(NOW - 30_000).toISOString())).toBe('Just now');
  });

  it('returns minutes ago under an hour', () => {
    expect(formatTimestamp(new Date(NOW - 5 * 60_000).toISOString())).toBe('5 min ago');
  });

  it('returns hours ago under a day', () => {
    expect(formatTimestamp(new Date(NOW - 3 * 3_600_000).toISOString())).toBe('3 hr ago');
  });

  it('falls back to a locale date string at a day or more', () => {
    const iso = new Date(NOW - 25 * 3_600_000).toISOString();
    expect(formatTimestamp(iso)).toBe(new Date(iso).toLocaleDateString());
  });
});
