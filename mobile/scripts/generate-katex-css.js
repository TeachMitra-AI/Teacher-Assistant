#!/usr/bin/env node
// Regenerates src/lib/katexEmbeddedCss.ts from the installed katex package.
// Run after bumping the `katex` version in package.json:
//   node scripts/generate-katex-css.js
//
// Rewrites katex/dist/katex.min.css so every @font-face's src is a single
// inline base64 woff2 data: URI (dropping the woff/ttf fallbacks) instead of
// a relative fonts/*.woff2 path — see katexEmbeddedCss.ts's own header for
// why that's necessary (expo-print/WebView render this HTML with no access
// to the app bundle's asset files and no guaranteed network connectivity).
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, '..', 'node_modules', 'katex', 'dist');
const fontsDir = path.join(distDir, 'fonts');
let css = fs.readFileSync(path.join(distDir, 'katex.min.css'), 'utf8');

css = css.replace(/@font-face\{([^}]+)\}/g, (full, body) => {
  const family = /font-family:([^;]+);/.exec(body)[1];
  const style = /font-style:([^;]+);/.exec(body)[1];
  const weight = /font-weight:([^;]+);/.exec(body)[1];
  const urlMatch = /url\(fonts\/([^)]+\.woff2)\)/.exec(body);
  if (!urlMatch) throw new Error(`no woff2 source in @font-face rule: ${body}`);
  const data = fs.readFileSync(path.join(fontsDir, urlMatch[1]));
  const b64 = data.toString('base64');
  return `@font-face{font-display:block;font-family:${family};font-style:${style};font-weight:${weight};src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
});

const header = `// GENERATED FILE — do not hand-edit. Regenerate with:
//   node scripts/generate-katex-css.js
//
// katex/dist/katex.min.css (version pinned in package.json) with every
// @font-face src rewritten from a relative fonts/*.woff2 path to an inline
// base64 data: URI, and the woff/ttf fallback sources dropped (both
// expo-print's PDF renderer and react-native-webview's WebView fully
// support woff2). expo-print/WebView render this HTML with no access to the
// app bundle's asset files and no guaranteed network connectivity, so the
// fonts must be self-contained inside the CSS string itself — a
// relative/https font URL would silently fall back to an unstyled glyph (or
// nothing) offline.

export const KATEX_EMBEDDED_CSS = ${JSON.stringify(css)};
`;

fs.writeFileSync(path.join(__dirname, '..', 'src', 'lib', 'katexEmbeddedCss.ts'), header);
console.log(`wrote src/lib/katexEmbeddedCss.ts (${header.length} bytes)`);
