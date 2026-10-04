import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreferences } from './usePreferences';

// An OS set to dark must not make a first-time visitor dark.
function stubOsDark() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('dark'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('usePreferences theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    stubOsDark();
  });

  it('defaults to light for first-time users even if the OS prefers dark', () => {
    const { result } = renderHook(() => usePreferences());
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('persists the chosen theme and restores it on the next visit', () => {
    const first = renderHook(() => usePreferences());
    act(() => first.result.current.toggleTheme());
    expect(first.result.current.theme).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    first.unmount();

    const second = renderHook(() => usePreferences());
    expect(second.result.current.theme).toBe('dark');
  });

  it('falls back to light for an invalid stored value', () => {
    localStorage.setItem('theme', 'purple');
    const { result } = renderHook(() => usePreferences());
    expect(result.current.theme).toBe('light');
  });
});
