// Ported from client/src/index.css's :root / [data-theme='dark'] custom
// properties (docs/mobile-ui-refinement-plan.md §4) — values copied 1:1, re-
// expressed as a TypeScript object since there is no design-token file to
// import from on the web side either.
export interface SemanticShades {
  /** Body/label text — index.css .auth-field-error / .toast-error text. */
  text: string;
  /** Border of a tinted panel — index.css .toast-error / .status-pill border. */
  border: string;
  /** Background of a tinted panel — index.css .toast-error / .status-pill bg. */
  bg: string;
}

export interface DangerShades extends SemanticShades {
  /** Interactive danger elements (delete icons, invalid-input borders) —
   * index.css .profile-dropdown-danger / .library-card-delete:hover /
   * aria-invalid input border-color: #dc2626. */
  action: string;
}

export interface SemanticColors {
  danger: DangerShades;
  success: SemanticShades;
  warning: SemanticShades;
}

export interface ThemeColors {
  orange: string;
  orangeDark: string;
  amber: string;
  /** index.css --orange-soft — every soft-active state (action chip active,
   * unread notification row, composer focus ring). */
  orangeSoft: string;
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textMuted: string;
  /** index.css --sk-base/--sk-mid/--sk-peak — the answer-skeleton shimmer stops. */
  skBase: string;
  skMid: string;
  skPeak: string;
  semantic: SemanticColors;
}

export const light: ThemeColors = {
  orange: '#ff6b35',
  orangeDark: '#e85a26',
  amber: '#f7931e',
  orangeSoft: 'rgba(255, 107, 53, 0.1)',
  bg: '#f5f6f8',
  surface: '#ffffff',
  surface2: '#f0f2f5',
  border: '#e2e5ea',
  text: '#1f2430',
  textMuted: '#5c6472',
  skBase: '#dde1e8',
  skMid: '#e6e9ef',
  skPeak: '#eef1f6',
  semantic: {
    danger: { text: '#b91c1c', action: '#dc2626', border: '#fca5a5', bg: '#fef2f2' },
    success: { text: '#15803d', border: '#86efac', bg: '#f0fdf4' },
    warning: { text: '#b45309', border: '#fcd34d', bg: '#fffbeb' },
  },
};

export const dark: ThemeColors = {
  // Brand colors are unchanged in dark theme too (index.css:44-52 only
  // overrides bg/surface/text/border).
  orange: '#ff6b35',
  orangeDark: '#e85a26',
  amber: '#f7931e',
  orangeSoft: 'rgba(255, 107, 53, 0.16)',
  bg: '#12151c',
  surface: '#1b1f29',
  surface2: '#232833',
  border: '#2c313d',
  text: '#e8eaef',
  textMuted: '#a1a8b6',
  skBase: '#232833',
  skMid: '#2a3040',
  skPeak: '#333b4c',
  semantic: {
    danger: { text: '#fca5a5', action: '#f87171', border: '#7f1d1d', bg: 'rgba(127, 29, 29, 0.35)' },
    success: { text: '#6ee7a8', border: '#14532d', bg: 'rgba(20, 83, 45, 0.35)' },
    warning: { text: '#fcd34d', border: '#78350f', bg: 'rgba(120, 53, 15, 0.35)' },
  },
};

// --radius-sm / --radius.
export const radius = { sm: 10, md: 14 };

// Spacing scale — not present as CSS custom properties on the web (it uses
// literal rem values per component), but a scale is worth having once for
// RN StyleSheets rather than repeating magic numbers across every screen.
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

// Layout constants derived from index.css (docs/mobile-ui-refinement-plan.md
// §6) so screens stop re-deriving the same numbers.
export const layout = {
  /** Matches the web's ~1.25rem mobile page padding (.library-main etc). */
  screenPadding: spacing.lg,
  /** Matches .library-grid's ~0.9rem card gap. */
  cardGap: spacing.md,
  /** index.css --bottomnav-h — excludes the safe-area inset, added on top. */
  bottomNavHeight: 58,
};

// Type scale formalising the web's per-component rem literals (there is no
// CSS type-scale token to port 1:1 — index.css:64's base is 16px, so
// 1rem = 16dp) — docs/mobile-ui-refinement-plan.md §5.
export interface TypeVariant {
  fontSize: number;
  fontWeight: '400' | '500' | '600' | '700';
  lineHeight: number;
  letterSpacing?: number;
  textTransform?: 'uppercase';
}

export const typography: Record<string, TypeVariant> = {
  display: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  pageTitle: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  sectionTitle: { fontSize: 18, fontWeight: '700', lineHeight: 23 },
  cardTitle: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 23 },
  bodyStrong: { fontSize: 15, fontWeight: '600', lineHeight: 22 },
  subtitle: { fontSize: 15, fontWeight: '400', lineHeight: 21 },
  label: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '400', lineHeight: 16 },
  micro: { fontSize: 11, fontWeight: '600', lineHeight: 14 },
  eyebrow: { fontSize: 12, fontWeight: '700', lineHeight: 15, letterSpacing: 0.5, textTransform: 'uppercase' },
};

// Platform-appropriate elevation for --shadow's visual intent (index.css:15,
// 49) — RN has no single shadow property that works on both platforms.
export const shadow = {
  ios: {
    shadowColor: '#141821',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  android: { elevation: 3 },
};
