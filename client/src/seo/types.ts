// Content model for the public "tool" and "guide" pages (see pages.ts).
//
// Text fields accept a tiny inline markup — `[label](/internal-path)` for
// links (also `[label](https://…)` for external sources) and `**bold**` — so
// a paragraph can carry descriptive internal links without every page needing
// bespoke JSX. Rendered by pages/ContentPage.tsx.

export type ContentBlock =
  | { type: 'p'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: { title?: string; text: string }[] }
  | { type: 'table'; caption?: string; headers: string[]; rows: string[][] }
  | { type: 'note'; title: string; text: string };

export interface ContentSection {
  id: string;
  heading: string;
  blocks: ContentBlock[];
}

export interface FaqItem {
  question: string;
  answer: string;
}

// 'about' is the company/entity page (seo/content/aboutSarasTech.ts). It reuses
// this template but is neither a tool nor a guide, so it sits outside
// TOOL_PAGES / GUIDE_PAGES and gets its own structured data (AboutPage).
export type PageKind = 'tool' | 'guide' | 'about';

export interface ContentPageData {
  kind: PageKind;
  path: string;
  // <title> and meta description — written per page, not templated.
  title: string;
  description: string;
  h1: string;
  eyebrow: string;
  // Short label used in the breadcrumb trail and footer/explore link lists.
  navLabel: string;
  // Compact label for the header nav (tool pages only).
  shortLabel: string;
  // One-line teaser shown on link cards elsewhere on the site.
  teaser: string;
  intro: string;
  // ISO dates (YYYY-MM-DD). `updated` is the sitemap <lastmod> and the
  // JSON-LD dateModified — bump it only when the page's content really changes.
  published: string;
  updated: string;
  sections: ContentSection[];
  faqs: FaqItem[];
  // Paths of other public pages to link to at the bottom.
  related: string[];
  cta: { heading: string; text: string };
  // Where a signed-in visitor's call-to-action goes (the real feature).
  appPath: string;
  appLabel: string;
}
