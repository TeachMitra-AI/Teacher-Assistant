// Ported from client/src/index.css's :root / [data-theme='dark'] custom
// properties (docs/mobile-app-plan.md §22) — values copied 1:1, re-expressed
// as a TypeScript object since there is no design-token file to import from
// on the web side either.
export interface ThemeColors {
  orange: string;
  orangeDark: string;
  amber: string;
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textMuted: string;
}

export const light: ThemeColors = {
  orange: '#ff6b35',
  orangeDark: '#e85a26',
  amber: '#f7931e',
  bg: '#f5f6f8',
  surface: '#ffffff',
  surface2: '#f0f2f5',
  border: '#e2e5ea',
  text: '#1f2430',
  textMuted: '#5c6472',
};

export const dark: ThemeColors = {
  // Brand colors are unchanged in dark theme too (index.css:44-52 only
  // overrides bg/surface/text/border).
  orange: '#ff6b35',
  orangeDark: '#e85a26',
  amber: '#f7931e',
  bg: '#12151c',
  surface: '#1b1f29',
  surface2: '#232833',
  border: '#2c313d',
  text: '#e8eaef',
  textMuted: '#a1a8b6',
};

// --radius-sm / --radius.
export const radius = { sm: 10, md: 14 };

// Spacing scale — not present as CSS custom properties on the web (it uses
// literal rem values per component), but a scale is worth having once for
// RN StyleSheets rather than repeating magic numbers across every screen.
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

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
