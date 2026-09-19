// Site-wide constants for the public, indexable part of the site. One place, so
// the canonical URLs, sitemap, JSON-LD and meta tags can never disagree about
// the origin or the brand's spelling.
export const SITE_ORIGIN = 'https://www.sarastech.co.in';
export const SITE_NAME = 'SarasTech';
// People type the brand both ways ("SarasTech" / "Saras Tech") and with the
// product name attached. Declared once as WebSite/Organization alternate names.
export const SITE_ALTERNATE_NAMES = ['Saras Tech', 'SarasTech Teacher Assistant'];
export const PRODUCT_NAME = 'SarasTech Teacher Assistant';
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/og-image.png`;
export const OG_IMAGE_ALT = 'SarasTech — an AI teaching assistant for lesson plans, worksheets and quizzes';
export const LOGO_URL = `${SITE_ORIGIN}/logo.png`;

// "/" -> "https://www.sarastech.co.in/" ; "/terms" -> "https://www.sarastech.co.in/terms".
// Canonicals never carry a trailing slash except for the home page, matching
// what the prerendered files and the sitemap use.
export function absoluteUrl(path: string): string {
  return path === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`;
}
