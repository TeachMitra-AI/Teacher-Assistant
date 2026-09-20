import { describe, expect, test } from 'vitest';
import robotsTxt from '../../public/robots.txt?raw';
import vercelConfig from '../../vercel.json';
import appSource from '../App.tsx?raw';
import { ABOUT_PAGE, CONTENT_PAGES, SITEMAP_ENTRIES, TOOL_PAGES, GUIDE_PAGES } from './pages';
import { buildSitemapXml } from './sitemap';
import { SITE_ORIGIN, SOCIAL_PROFILES } from './site';
import type { ContentBlock } from './types';

const KNOWN_STATIC_PATHS = ['/', '/terms', '/privacy'];
const KNOWN_PATHS = new Set([...KNOWN_STATIC_PATHS, ...CONTENT_PAGES.map((p) => p.path)]);

function allBlockText(blocks: ContentBlock[]): string[] {
  return blocks.flatMap((block) => {
    switch (block.type) {
      case 'p':
      case 'h3':
        return [block.text];
      case 'ul':
        return block.items;
      case 'ol':
        return block.items.map((item) => item.text);
      case 'table':
        return block.rows.flat();
      case 'note':
        return [block.text];
    }
  });
}

function allPageText(page: (typeof CONTENT_PAGES)[number]): string[] {
  return [
    page.intro,
    ...page.sections.flatMap((s) => allBlockText(s.blocks)),
    ...page.faqs.map((f) => f.answer),
    page.cta.text,
  ];
}

describe('public content page registry', () => {
  test('has both tool and guide pages, and stays deliberately small', () => {
    expect(TOOL_PAGES.length).toBeGreaterThan(0);
    expect(GUIDE_PAGES.length).toBeGreaterThan(0);
    // Not a page factory: adding pages should be a deliberate act, so a big
    // jump in this number is worth a second look in review.
    expect(CONTENT_PAGES.length).toBeLessThanOrEqual(12);
  });

  test('paths are unique, lowercase, kebab-case and have no trailing slash', () => {
    const paths = CONTENT_PAGES.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const path of paths) {
      expect(path).toMatch(/^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/);
    }
  });

  test('titles, descriptions and H1s are unique and sized for search results', () => {
    for (const key of ['title', 'description', 'h1'] as const) {
      const values = CONTENT_PAGES.map((p) => p[key]);
      expect(new Set(values).size).toBe(values.length);
    }
    for (const page of CONTENT_PAGES) {
      expect(page.title.length, `${page.path} title`).toBeLessThanOrEqual(65);
      expect(page.description.length, `${page.path} description`).toBeGreaterThanOrEqual(90);
      expect(page.description.length, `${page.path} description`).toBeLessThanOrEqual(165);
    }
  });

  test('every page has real depth: sections, FAQs, a valid date pair and no empty text', () => {
    for (const page of CONTENT_PAGES) {
      expect(page.sections.length, page.path).toBeGreaterThanOrEqual(4);
      expect(page.faqs.length, page.path).toBeGreaterThanOrEqual(3);
      expect(page.published).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(page.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(page.updated >= page.published, `${page.path} updated before published`).toBe(true);

      const ids = page.sections.map((s) => s.id);
      expect(new Set(ids).size, `${page.path} duplicate section ids`).toBe(ids.length);
      expect(ids).not.toContain('faq'); // reserved for the FAQ section the template adds

      for (const text of allPageText(page)) {
        expect(text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('related links and every inline internal link point at a real page', () => {
    for (const page of CONTENT_PAGES) {
      for (const related of page.related) {
        expect(KNOWN_PATHS.has(related), `${page.path} relates to unknown ${related}`).toBe(true);
        expect(related).not.toBe(page.path);
      }
      for (const text of allPageText(page)) {
        for (const match of text.matchAll(/\]\((\/[^)#]*)\)/g)) {
          expect(KNOWN_PATHS.has(match[1]), `${page.path} links to unknown ${match[1]}`).toBe(true);
        }
      }
    }
  });

  test('pages that make product claims never promise features SarasTech does not have', () => {
    const forbidden = [/\bfree\b/i, /\bunlimited\b/i, /auto-?grad/i, /\bguarantee/i, /\d+%/, /\d[\d,]*\+? (teachers|schools|users)/i];
    for (const page of CONTENT_PAGES) {
      const text = [page.title, page.description, page.h1, ...allPageText(page)].join('\n');
      for (const pattern of forbidden) {
        // "Does SarasTech grade my students' answers? No." is the one honest
        // mention of grading — it must say "No".
        const stripped = text.replace(/does sarastech grade[^?]*\?\s*no\./gi, '');
        expect(stripped, `${page.path} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});

describe('About page', () => {
  test('is a registered, routable page that is neither a tool nor a guide', () => {
    expect(ABOUT_PAGE.path).toBe('/about');
    expect(CONTENT_PAGES).toContain(ABOUT_PAGE);
    expect(TOOL_PAGES).not.toContain(ABOUT_PAGE);
    expect(GUIDE_PAGES).not.toContain(ABOUT_PAGE);
    expect(SITEMAP_ENTRIES.map((e) => e.path)).toContain('/about');
  });

  test('names the product "SarasTech AI" in its title, H1 and intro, with SarasTech as the brand', () => {
    expect(ABOUT_PAGE.title).toContain('SarasTech AI');
    expect(ABOUT_PAGE.h1).toContain('SarasTech AI');
    expect(ABOUT_PAGE.intro).toContain('SarasTech AI');
    expect(ABOUT_PAGE.intro).toContain('SarasTech for short');
  });

  test('links every official social profile, straight from the shared SOCIAL_PROFILES list', () => {
    const text = ABOUT_PAGE.sections.flatMap((s) => allBlockText(s.blocks)).join('\n');
    for (const profile of SOCIAL_PROFILES) expect(text).toContain(`](${profile.url})`);
  });

  test('links to the product pages it describes', () => {
    expect(ABOUT_PAGE.related).toEqual(expect.arrayContaining(['/ai-lesson-plan-generator', '/ai-worksheet-generator', '/ai-quiz-generator']));
  });
});

describe('robots.txt', () => {
  const disallowed = robotsTxt
    .split(/\r?\n/)
    .filter((line) => /^disallow:/i.test(line))
    .map((line) => line.replace(/^disallow:\s*/i, '').trim())
    .filter(Boolean);

  test('never blocks an indexable page (Disallow is a prefix match)', () => {
    for (const entry of SITEMAP_ENTRIES) {
      if (entry.path === '/') continue;
      for (const prefix of disallowed) {
        expect(entry.path.startsWith(prefix), `${entry.path} is blocked by "Disallow: ${prefix}"`).toBe(false);
      }
    }
    expect(robotsTxt).not.toMatch(/^disallow:\s*\/\s*$/im);
  });

  test('advertises the sitemap on the canonical origin', () => {
    expect(robotsTxt).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
  });
});

describe('sitemap', () => {
  const xml = buildSitemapXml(SITEMAP_ENTRIES);

  test('lists the home page, legal pages and every content page exactly once', () => {
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(new Set(locs).size).toBe(locs.length);
    expect(locs).toContain(`${SITE_ORIGIN}/`);
    expect(locs).toContain(`${SITE_ORIGIN}/terms`);
    expect(locs).toContain(`${SITE_ORIGIN}/privacy`);
    for (const page of CONTENT_PAGES) expect(locs).toContain(`${SITE_ORIGIN}${page.path}`);
    expect(locs).toHaveLength(CONTENT_PAGES.length + KNOWN_STATIC_PATHS.length);
  });

  test('uses only canonical, absolute URLs with a real lastmod, and no ignored tags', () => {
    expect(xml).not.toMatch(/<priority>|<changefreq>/);
    for (const m of xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)) {
      expect(m[1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      expect(m[1].startsWith(`${SITE_ORIGIN}/`)).toBe(true);
      expect(m[1]).not.toMatch(/[?#]/);
    }
  });
});

// The 404 fix replaces vercel.json's catch-all rewrite with an explicit list of
// SPA routes. That list has to keep pace with App.tsx or a real page would
// silently start returning 404 in production — so this test derives every route
// from App.tsx's own source and proves each one is still rewritten.
describe('vercel.json rewrites', () => {
  type Rewrite = { source: string; destination: string };
  const rewrites = (vercelConfig as { rewrites: Rewrite[] }).rewrites;

  function sourceToRegExp(source: string): RegExp {
    const pattern = source
      .replace(/\/:\w+\*/g, '(?:/.*)?')
      .replace(/:\w+/g, '[^/]+');
    return new RegExp(`^${pattern}$`);
  }
  const matchers = rewrites.map((r) => sourceToRegExp(r.source));

  test('does not use a catch-all (that would make every unknown URL a soft 404)', () => {
    for (const r of rewrites) {
      expect(r.source).not.toMatch(/\(\.\*\)|\*\*|^\/:\w+\*?$/);
      expect(r.destination).toBe('/index.html');
    }
  });

  test('covers every app route declared in App.tsx', () => {
    const routePaths = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
    // "/" and the prerendered public pages are static files, not rewrites.
    const needsRewrite = routePaths
      .filter((p) => p !== '*' && !KNOWN_PATHS.has(p))
      .map((p) => p.replace(/:\w+/g, 'x'));
    expect(needsRewrite.length).toBeGreaterThan(5); // sanity: the regex found the app routes
    for (const concrete of needsRewrite) {
      expect(
        matchers.some((re) => re.test(concrete)),
        `App.tsx route ${concrete} has no matching rewrite in vercel.json`,
      ).toBe(true);
    }
  });

  test('does not swallow the prerendered public pages or unknown URLs', () => {
    for (const path of [...KNOWN_PATHS].filter((p) => p !== '/')) {
      expect(matchers.some((re) => re.test(path)), `${path} must be served from its prerendered file`).toBe(false);
    }
    for (const path of ['/nonexistent-page', '/ai-worksheet-generator-typo', '/guides', '/.env']) {
      expect(matchers.some((re) => re.test(path)), `${path} should reach 404.html`).toBe(false);
    }
  });
});
