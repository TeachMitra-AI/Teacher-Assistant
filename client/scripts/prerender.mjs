// Prerenders the public SEO routes ("/", "/terms", "/privacy", plus every tool
// and guide page in src/seo/pages.ts) to static HTML after `vite build`, so a
// crawler that doesn't execute JS still gets real page content instead of the
// empty `<div id="root">` shell. Also writes dist/sitemap.xml (from the same
// registry, so it can't drift from the pages) and dist/404.html (served with a
// real 404 status for unknown URLs — see vercel.json). Run as part of
// `npm run build` (see package.json), never on its own.
//
// Deliberately dependency-free beyond what's already installed: Vite's own
// `ssrLoadModule` (the documented way to import app TSX from a plain Node
// script) loads the real page components, and jsdom (already a devDependency
// for the Vitest suite) stands in for the browser so those components' own
// hooks — including useDocumentMeta and useJsonLd, unmodified — run for
// real and write the correct <title>/meta/canonical/JSON-LD themselves. This
// script never duplicates any of that content; it only captures what the
// real components already produce.
//
// Only the public, signed-out routes are prerendered — HomePage,
// TermsOfServicePage, PrivacyPolicyPage and the ContentPage template are
// rendered standalone (wrapped in just a BrowserRouter, not the full
// App/AuthProvider/GoogleOAuthProvider tree), since none of that
// authenticated-app plumbing is needed to render their content and pulling it
// in would risk real network/script side effects during a build.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
// Plain npm packages are imported natively by Node (not via ssrLoadModule) so
// react/react-dom/react-router-dom resolve to the one instance also used by
// the app's own .tsx modules below — Vite externalizes them for SSR anyway,
// but loading React's CJS entry through Vite's SSR module transform directly
// (rather than externalized) fails, since that transform expects ESM.
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.resolve(__dirname, '..');
const distDir = path.join(clientRoot, 'dist');
const SITE_ORIGIN = 'https://www.sarastech.co.in';

const BASE_ROUTES = [
  { urlPath: '/', component: '/src/pages/HomePage.tsx', outFile: 'index.html' },
  { urlPath: '/terms', component: '/src/pages/TermsOfServicePage.tsx', outFile: 'terms/index.html' },
  { urlPath: '/privacy', component: '/src/pages/PrivacyPolicyPage.tsx', outFile: 'privacy/index.html' },
];

// jsdom doesn't implement these; the app only ever touches them defensively
// (theme/reduced-motion detection, a scroll-spy observer) inside effects, so
// a no-op/false-default stub is enough for the real components to render
// without throwing — no app code is changed to accommodate this.
function installBrowserGlobals(dom) {
  const { window } = dom;

  window.matchMedia =
    window.matchMedia ||
    (() => ({
      matches: false,
      media: '',
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }));

  window.IntersectionObserver =
    window.IntersectionObserver ||
    class NoopIntersectionObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

  // Node 21+ defines a read-only `navigator` global of its own — a plain
  // `global.navigator = ...` throws on it, so every global here goes through
  // defineProperty instead, which can override a configurable getter.
  const define = (name, value) => Object.defineProperty(global, name, { value, configurable: true, writable: true });
  define('window', window);
  define('document', window.document);
  define('navigator', window.navigator);
  define('localStorage', window.localStorage);
  define('sessionStorage', window.sessionStorage);
  define('HTMLElement', window.HTMLElement);
  define('Node', window.Node);
  define('getComputedStyle', window.getComputedStyle.bind(window));
  define('matchMedia', window.matchMedia.bind(window));
  define('IntersectionObserver', window.IntersectionObserver);
  define('IS_REACT_ACT_ENVIRONMENT', true);
}

async function main() {
  const shellHtml = await readFile(path.join(distDir, 'index.html'), 'utf8');

  const vite = await createServer({
    root: clientRoot,
    // No dev server is ever served to a browser here — middlewareMode skips
    // the HTTP listener, and hmr:false skips the HMR websocket (which,
    // without a real server for it to attach to, otherwise tries to open its
    // own and can collide with a port already in use).
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });

  const { CONTENT_PAGES, SITEMAP_ENTRIES } = await vite.ssrLoadModule('/src/seo/pages.ts');
  const { buildSitemapXml } = await vite.ssrLoadModule('/src/seo/sitemap.ts');

  const routes = [
    ...BASE_ROUTES,
    ...CONTENT_PAGES.map((page) => ({
      urlPath: page.path,
      component: '/src/pages/ContentPage.tsx',
      props: { page },
      outFile: `${page.path.slice(1)}/index.html`,
    })),
  ];

  for (const route of routes) {
    const dom = new JSDOM(shellHtml, {
      url: `${SITE_ORIGIN}${route.urlPath}`,
      pretendToBeVisual: true,
    });
    installBrowserGlobals(dom);

    const { default: Page } = await vite.ssrLoadModule(route.component);
    const container = dom.window.document.getElementById('root');
    const reactRoot = createRoot(container);

    await act(async () => {
      reactRoot.render(React.createElement(BrowserRouter, null, React.createElement(Page, route.props)));
    });

    const outPath = path.join(distDir, route.outFile);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `<!doctype html>\n${dom.window.document.documentElement.outerHTML}\n`, 'utf8');
    console.log(`Prerendered ${route.urlPath} -> dist/${route.outFile}`);

    act(() => {
      reactRoot.unmount();
    });
    dom.window.close();
  }

  await writeFile(path.join(distDir, 'sitemap.xml'), buildSitemapXml(SITEMAP_ENTRIES), 'utf8');
  console.log(`Wrote dist/sitemap.xml (${SITEMAP_ENTRIES.length} URLs)`);

  await write404(shellHtml);

  await vite.close();
}

// dist/404.html: the untouched app shell with noindex, no canonical and a
// neutral title. Vercel serves it with a real 404 status for any URL that
// isn't a static file or a listed app route (vercel.json), so unknown URLs no
// longer answer 200 with the home page's HTML (a soft 404). A visitor with
// JavaScript still gets the SPA, which redirects unknown paths to "/" exactly
// as before — only the HTTP status changes.
async function write404(shellHtml) {
  const dom = new JSDOM(shellHtml);
  const { document } = dom.window;
  document.title = 'Page not found — SarasTech';
  document.head.querySelector('link[rel="canonical"]')?.remove();
  document.head.querySelector('meta[name="robots"]')?.setAttribute('content', 'noindex');
  await writeFile(path.join(distDir, '404.html'), `<!doctype html>\n${document.documentElement.outerHTML}\n`, 'utf8');
  console.log('Wrote dist/404.html');
  dom.window.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
