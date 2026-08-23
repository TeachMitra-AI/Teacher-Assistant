import { describe, expect, test } from 'vitest';
import { normalizeApiBase } from './apiBase';

describe('normalizeApiBase', () => {
  test('leaves a correctly suffixed base alone', () => {
    expect(normalizeApiBase('http://localhost:3000/api')).toBe('http://localhost:3000/api');
    expect(normalizeApiBase('https://api.example.org/api')).toBe('https://api.example.org/api');
  });

  test('appends /api to a bare origin', () => {
    // The production misconfiguration this guard exists for: the base was set
    // to the API origin with no /api, so every call built `<origin>/auth/login`
    // and 404ed, login included.
    expect(normalizeApiBase('https://teacher-assistant-production-d3a4.up.railway.app'))
      .toBe('https://teacher-assistant-production-d3a4.up.railway.app/api');
  });

  test('strips trailing slashes either way', () => {
    expect(normalizeApiBase('https://api.example.org/api/')).toBe('https://api.example.org/api');
    expect(normalizeApiBase('https://api.example.org/')).toBe('https://api.example.org/api');
    expect(normalizeApiBase('https://api.example.org//')).toBe('https://api.example.org/api');
  });

  test('tolerates surrounding whitespace from an env var', () => {
    expect(normalizeApiBase('  https://api.example.org  ')).toBe('https://api.example.org/api');
  });

  test('keeps a base already mounted under a path prefix', () => {
    expect(normalizeApiBase('https://example.org/backend')).toBe('https://example.org/backend/api');
    expect(normalizeApiBase('https://example.org/backend/api'))
      .toBe('https://example.org/backend/api');
  });

  test('the result still yields the bare origin when SOCKET_BASE strips /api', () => {
    // config.ts derives SOCKET_BASE as API_BASE.replace(/\/api\/?$/, ''), so a
    // normalized base has to round-trip back to the origin Socket.IO needs.
    expect(normalizeApiBase('https://api.example.org').replace(/\/api\/?$/, ''))
      .toBe('https://api.example.org');
  });
});
