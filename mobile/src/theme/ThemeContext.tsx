// Native translation of client/src/hooks/usePreferences.ts's theme handling
// (docs/mobile-app-plan.md §22). Deviation from the plan, scoped
// deliberately: §22 describes a stored (SecureStore/AsyncStorage) override
// persisted across app restarts, mirroring the web's localStorage-backed
// preference. That persistence belongs with the rest of Settings (a later
// phase — nothing to persist TO yet, no settings screen exists). Phase 2
// ships the override as in-memory-only state, which already satisfies this
// phase's own acceptance criterion ("theme toggle works") — persistence is a
// pure addition on top when Settings lands, not a redesign of this API.
import React, { createContext, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { light, dark, paper, type ThemeColors } from './tokens';

export type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  /** Explicit user override, if any — null means "follow the OS setting". */
  override: ThemeMode | null;
  setOverride: (mode: ThemeMode | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [override, setOverride] = useState<ThemeMode | null>(null);

  const mode: ThemeMode = override ?? (systemScheme === 'dark' ? 'dark' : 'light');
  const colors = mode === 'dark' ? dark : light;

  const value = useMemo(() => ({ mode, colors, override, setOverride }), [mode, colors, override]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}

// Fixed-value override for the exam-paper preview (GeneratorResultScreen's
// and ResourceEditScreen's read-only Preview tab) — every ThemedText/
// QuestionCard/ExamHeaderView inside picks up tokens.ts's `paper` colors via
// the same useTheme() call they already make, so the paper look needs no
// prop plumbing through those shared components. Mirrors how index.css's
// `.workspace-preview.exam-paper` repaints its custom properties for
// everything nested inside via `currentColor`, without a parallel stylesheet.
const PAPER_VALUE: ThemeContextValue = {
  mode: 'light',
  colors: paper,
  override: null,
  setOverride: () => {},
};

export function PaperThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeContext.Provider value={PAPER_VALUE}>{children}</ThemeContext.Provider>;
}
