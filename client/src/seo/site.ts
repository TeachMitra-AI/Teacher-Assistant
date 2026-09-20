// Site-wide constants for the public, indexable part of the site. One place, so
// the canonical URLs, sitemap, JSON-LD and meta tags can never disagree about
// the origin or the brand's spelling.
export const SITE_ORIGIN = 'https://www.sarastech.co.in';
export const SITE_NAME = 'SarasTech';
// People type the brand both ways ("SarasTech" / "Saras Tech"), with the
// product name attached, and as "SarasTech AI" — the name the official social
// profiles use. "SarasTech" stays the primary name; these are alternates only.
// Declared once as WebSite/Organization alternate names.
export const SITE_ALTERNATE_NAMES = ['SarasTech AI', 'Saras Tech', 'SarasTech Teacher Assistant'];
export const PRODUCT_NAME = 'SarasTech Teacher Assistant';
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-image.png`;
export const OG_IMAGE_ALT = 'SarasTech — an AI teaching assistant for lesson plans, worksheets and quizzes';
export const LOGO_URL = `${SITE_ORIGIN}/logo.png`;

// Official SarasTech social profiles — the single source for both the home
// page's "Follow SarasTech" section and the Organization `sameAs` in JSON-LD,
// so the visible links and the structured data can never disagree. To add a
// platform (YouTube, Facebook, WhatsApp…): append an entry here, and give its
// `id` an icon in components/SocialLinks.tsx (without one it still renders as a
// text link). Only list accounts that are live and official, and use the exact
// public profile URL — no tracking parameters. Existing entries keep their
// position so `sameAs` stays stable; append new ones at the end.
export interface SocialProfile {
  id: string;
  // Platform name as shown to visitors ("LinkedIn").
  name: string;
  url: string;
}

export const SOCIAL_PROFILES: readonly SocialProfile[] = [
  { id: 'linkedin', name: 'LinkedIn', url: 'https://www.linkedin.com/company/sarastechai/' },
  { id: 'instagram', name: 'Instagram', url: 'https://www.instagram.com/sarastechai/' },
  { id: 'x', name: 'X', url: 'https://x.com/SarasTechAI' },
  { id: 'youtube', name: 'YouTube', url: 'https://www.youtube.com/@SarasTechAI' },
  { id: 'substack', name: 'Substack', url: 'https://substack.com/@sarastechai' },
  { id: 'reddit', name: 'Reddit', url: 'https://www.reddit.com/user/SarasTechAI/' },
];

// "/" -> "https://www.sarastech.co.in/" ; "/terms" -> "https://www.sarastech.co.in/terms".
// Canonicals never carry a trailing slash except for the home page, matching
// what the prerendered files and the sitemap use.
export function absoluteUrl(path: string): string {
  return path === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`;
}
