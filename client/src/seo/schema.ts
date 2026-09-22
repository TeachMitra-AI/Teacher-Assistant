import type { ContentPageData } from './types';
import {
  SITE_ORIGIN,
  SITE_NAME,
  SITE_ALTERNATE_NAMES,
  PRODUCT_NAME,
  LOGO_URL,
  DEFAULT_OG_IMAGE,
  SOCIAL_PROFILES,
  absoluteUrl,
} from './site';

// JSON-LD builders. Everything emitted here restates something visible on the
// page (or a plain fact about the product) — no ratings, review counts,
// prices or other claims that the site cannot back up. In particular there is
// deliberately no `offers`, `aggregateRating` or `review` on the application:
// SarasTech has no verifiable rating data, and inventing it would breach
// Google's structured-data guidelines.

const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`;
const WEBSITE_ID = `${SITE_ORIGIN}/#website`;
const APPLICATION_ID = `${SITE_ORIGIN}/#app`;

export const organizationNode = {
  '@type': 'Organization',
  '@id': ORGANIZATION_ID,
  name: SITE_NAME,
  alternateName: SITE_ALTERNATE_NAMES,
  url: `${SITE_ORIGIN}/`,
  logo: { '@type': 'ImageObject', url: LOGO_URL, width: 512, height: 512 },
  sameAs: SOCIAL_PROFILES.map((profile) => profile.url),
};

// The application itself. Named after the product, not the page <title> (the
// old markup repeated the whole title string here).
export function applicationNode(description: string) {
  return {
    '@type': 'WebApplication',
    '@id': APPLICATION_ID,
    name: PRODUCT_NAME,
    url: `${SITE_ORIGIN}/`,
    description,
    applicationCategory: 'EducationalApplication',
    operatingSystem: 'Web',
    inLanguage: ['en', 'hi', 'bn', 'te', 'mr', 'ta', 'gu', 'kn', 'or'],
    audience: { '@type': 'Audience', audienceType: 'Teachers' },
    provider: { '@id': ORGANIZATION_ID },
  };
}

// Home page graph. `name` on WebSite is the short brand name — Google's site
// name feature reads it (and alternateName) from the home page only.
export function buildHomeGraph(args: {
  title: string;
  description: string;
  faqs: { question: string; answer: string }[];
}) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      organizationNode,
      {
        '@type': 'WebSite',
        '@id': WEBSITE_ID,
        name: SITE_NAME,
        alternateName: SITE_ALTERNATE_NAMES,
        url: `${SITE_ORIGIN}/`,
        inLanguage: 'en-IN',
        publisher: { '@id': ORGANIZATION_ID },
      },
      {
        '@type': 'WebPage',
        '@id': `${SITE_ORIGIN}/#webpage`,
        url: `${SITE_ORIGIN}/`,
        name: args.title,
        description: args.description,
        isPartOf: { '@id': WEBSITE_ID },
        about: { '@id': APPLICATION_ID },
        inLanguage: 'en-IN',
      },
      applicationNode(args.description),
      {
        '@type': 'FAQPage',
        mainEntity: args.faqs.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: { '@type': 'Answer', text: faq.answer },
        })),
      },
    ],
  };
}

function faqPageNode(faqs: ContentPageData['faqs']) {
  return {
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };
}

function breadcrumbNode(page: ContentPageData) {
  // Mirrors the visible breadcrumb in ContentPage. There is no /guides index
  // page, so guides sit directly under Home rather than under a made-up parent.
  const items = [
    { name: 'Home', url: absoluteUrl('/') },
    { name: page.navLabel, url: absoluteUrl(page.path) },
  ];
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

// Graph for a tool or guide page. Tool pages are a WebPage about the product;
// guides are an Article. Both carry a BreadcrumbList that mirrors the visible
// breadcrumb.
export function buildContentPageGraph(page: ContentPageData) {
  const url = absoluteUrl(page.path);

  // The About page is the one place besides the home page that defines the
  // Organization, using the very same node (same @id, name, alternateName and
  // sameAs) so the two can never disagree. The AboutPage points at it by @id.
  if (page.kind === 'about') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'AboutPage',
          '@id': `${url}#webpage`,
          url,
          name: page.title,
          description: page.description,
          inLanguage: 'en-IN',
          dateModified: page.updated,
          isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE_ORIGIN}/` },
          about: { '@id': ORGANIZATION_ID },
          mainEntity: { '@id': ORGANIZATION_ID },
        },
        organizationNode,
        faqPageNode(page.faqs),
        breadcrumbNode(page),
      ],
    };
  }

  const publisher = { '@type': 'Organization', name: SITE_NAME, url: `${SITE_ORIGIN}/`, logo: { '@type': 'ImageObject', url: LOGO_URL } };

  const main =
    page.kind === 'guide'
      ? {
          '@type': 'Article',
          '@id': `${url}#article`,
          headline: page.h1,
          description: page.description,
          image: DEFAULT_OG_IMAGE,
          datePublished: page.published,
          dateModified: page.updated,
          inLanguage: 'en-IN',
          mainEntityOfPage: url,
          author: { '@type': 'Organization', name: `${SITE_NAME} team`, url: `${SITE_ORIGIN}/` },
          publisher,
        }
      : {
          '@type': 'WebPage',
          '@id': `${url}#webpage`,
          url,
          name: page.title,
          description: page.description,
          inLanguage: 'en-IN',
          dateModified: page.updated,
          isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: `${SITE_ORIGIN}/` },
          about: {
            '@type': 'WebApplication',
            name: PRODUCT_NAME,
            url: `${SITE_ORIGIN}/`,
            applicationCategory: 'EducationalApplication',
            operatingSystem: 'Web',
          },
          publisher,
        };

  return {
    '@context': 'https://schema.org',
    '@graph': [main, breadcrumbNode(page)],
  };
}
