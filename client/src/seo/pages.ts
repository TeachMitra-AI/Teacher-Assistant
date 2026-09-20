import type { ContentPageData } from './types';
import { aiLessonPlanGenerator } from './content/aiLessonPlanGenerator';
import { aiWorksheetGenerator } from './content/aiWorksheetGenerator';
import { aiQuizGenerator } from './content/aiQuizGenerator';
import { aiTeachingAssistantIndianLanguages } from './content/aiTeachingAssistantIndianLanguages';
import { guideLessonPlanFormat } from './content/guideLessonPlanFormat';
import { guideAiLessonPlanning } from './content/guideAiLessonPlanning';
import { guideMultigradeClassroom } from './content/guideMultigradeClassroom';
import { aboutSarasTech } from './content/aboutSarasTech';

// The single registry of indexable public pages. App.tsx builds its routes from
// it, scripts/prerender.mjs prerenders it, sitemap.ts lists it, and the
// footer/"Explore" link lists read from it — so adding a page here is the one
// step that makes it routable, crawlable and discoverable.
//
// Deliberately small. Each entry is a hand-written page targeting a distinct
// search intent that SarasTech genuinely serves; this is not a template for
// generating pages in bulk (see the SEO strategy in the PR description).
//
// NAMING RULE: a path must not start with any prefix disallowed in
// public/robots.txt (/login, /library, /classroom, /attendance, /generator,
// /settings, /admin, …), because robots.txt Disallow rules are prefix matches —
// "/generator-for-quizzes" would be blocked. pages.test.ts enforces this.
export const TOOL_PAGES: ContentPageData[] = [
  aiLessonPlanGenerator,
  aiWorksheetGenerator,
  aiQuizGenerator,
  aiTeachingAssistantIndianLanguages,
];

export const GUIDE_PAGES: ContentPageData[] = [
  guideLessonPlanFormat,
  guideAiLessonPlanning,
  guideMultigradeClassroom,
];

// The company/entity page. Not in TOOL_PAGES or GUIDE_PAGES: it doesn't belong
// in the header nav or the footer's "Tools"/"Guides" columns — the footer links
// to it directly.
export const ABOUT_PAGE: ContentPageData = aboutSarasTech;

export const CONTENT_PAGES: ContentPageData[] = [...TOOL_PAGES, ...GUIDE_PAGES, ABOUT_PAGE];

export function getContentPage(path: string): ContentPageData | undefined {
  return CONTENT_PAGES.find((page) => page.path === path);
}

// Every URL that belongs in sitemap.xml. `lastmod` for the content pages comes
// from each page's own `updated` field; the home and legal pages carry theirs
// here. Bump a date only when that page's content genuinely changes — Google
// only trusts lastmod if it is consistently accurate.
export interface SitemapEntry {
  path: string;
  lastmod: string;
}

export const SITEMAP_ENTRIES: SitemapEntry[] = [
  { path: '/', lastmod: '2026-09-20' },
  ...CONTENT_PAGES.map((page) => ({ path: page.path, lastmod: page.updated })),
  { path: '/terms', lastmod: '2026-09-05' },
  { path: '/privacy', lastmod: '2026-09-05' },
];
