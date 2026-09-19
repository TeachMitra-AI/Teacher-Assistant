import { absoluteUrl } from './site';
import type { SitemapEntry } from './pages';

// Google ignores <priority> and <changefreq>, and uses <lastmod> only when it
// is consistently accurate — so each entry carries just <loc> and a real
// <lastmod> (see SITEMAP_ENTRIES in pages.ts).
export function buildSitemapXml(entries: SitemapEntry[]): string {
  const urls = entries
    .map(
      (entry) =>
        `  <url>\n    <loc>${absoluteUrl(entry.path)}</loc>\n    <lastmod>${entry.lastmod}</lastmod>\n  </url>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
