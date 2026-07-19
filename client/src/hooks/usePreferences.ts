import { useCallback, useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const MIN_FONT = 14;
const MAX_FONT = 22;
const DEFAULT_FONT = 16;

function readTheme(): Theme {
  const saved = localStorage.getItem('theme') as Theme | null;
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readFont(): number {
  const saved = parseInt(localStorage.getItem('fontScale') || '', 10);
  return Number.isFinite(saved) ? Math.min(Math.max(saved, MIN_FONT), MAX_FONT) : DEFAULT_FONT;
}

export function usePreferences() {
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [fontScale, setFontScale] = useState<number>(readFont);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-base', `${fontScale}px`);
    localStorage.setItem('fontScale', String(fontScale));
  }, [fontScale]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  const changeFont = useCallback((delta: number) => {
    setFontScale((f) => Math.min(Math.max(f + delta, MIN_FONT), MAX_FONT));
  }, []);

  return { theme, toggleTheme, fontScale, changeFont, canIncrease: fontScale < MAX_FONT, canDecrease: fontScale > MIN_FONT };
}
