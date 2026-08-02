import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureAutoContext } from './support';

describe('captureAutoContext', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('captures route, theme, and language without needing anything opt-in', () => {
    const ctx = captureAutoContext('dark', 'hi');
    expect(ctx.route).toBe(window.location.pathname);
    expect(ctx.theme).toBe('dark');
    expect(ctx.language).toBe('hi');
    expect(typeof ctx.buildId).toBe('string');
    expect(typeof ctx.userAgent).toBe('string');
    expect(ctx.viewport).toMatch(/^\d+x\d+$/);
  });

  it('never includes fields beyond the closed, non-sensitive set', () => {
    const ctx = captureAutoContext('light');
    const allowedKeys = [
      'route', 'buildId', 'userAgent', 'viewport', 'theme', 'language', 'requestId', 'grade', 'subject', 'classroomType',
    ];
    for (const key of Object.keys(ctx)) {
      expect(allowedKeys).toContain(key);
    }
  });

  it('omits language when the caller has none to give', () => {
    const ctx = captureAutoContext('light');
    expect(ctx.language).toBeUndefined();
  });

  it('lets call-site "extra" fold in a requestId or teaching context without this helper knowing about them', () => {
    const ctx = captureAutoContext('dark', 'en', { requestId: 'req-123', grade: 'Class 3-5' });
    expect(ctx.requestId).toBe('req-123');
    expect(ctx.grade).toBe('Class 3-5');
    // Still carries the base fields alongside the extras.
    expect(ctx.theme).toBe('dark');
  });

  it('truncates an oversized userAgent rather than sending it whole', () => {
    vi.stubGlobal('navigator', { userAgent: 'x'.repeat(500) });
    const ctx = captureAutoContext('light');
    expect(ctx.userAgent?.length).toBe(300);
  });
});
