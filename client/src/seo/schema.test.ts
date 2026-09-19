import { describe, expect, test } from 'vitest';
import { buildContentPageGraph, buildHomeGraph } from './schema';
import { CONTENT_PAGES, GUIDE_PAGES, TOOL_PAGES } from './pages';
import { SITE_ORIGIN } from './site';

type Node = Record<string, unknown> & { '@type': string };

function nodes(graph: { '@graph': unknown[] }): Node[] {
  return graph['@graph'] as Node[];
}

describe('home page structured data', () => {
  const faqs = [
    { question: 'Q1?', answer: 'A1.' },
    { question: 'Q2?', answer: 'A2.' },
  ];
  const graph = buildHomeGraph({ title: 'A Title', description: 'A description.', faqs });
  const byType = (type: string) => nodes(graph).find((n) => n['@type'] === type)!;

  test('WebSite carries the short brand name and alternate spellings for Google site names', () => {
    const site = byType('WebSite');
    expect(site.name).toBe('SarasTech');
    expect(site.alternateName).toEqual(expect.arrayContaining(['Saras Tech', 'SarasTech Teacher Assistant']));
    expect(site.url).toBe(`${SITE_ORIGIN}/`);
  });

  test('describes the product by name, not by the page title', () => {
    const app = byType('WebApplication');
    expect(app.name).toBe('SarasTech Teacher Assistant');
    expect(app.applicationCategory).toBe('EducationalApplication');
  });

  test('never invents ratings, reviews or prices', () => {
    const json = JSON.stringify(graph);
    expect(json).not.toMatch(/aggregateRating|"review"|"offers"|ratingValue|"price"/);
  });

  test('FAQPage mirrors exactly the FAQs passed in', () => {
    const faq = byType('FAQPage') as unknown as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(faq.mainEntity.map((q) => q.name)).toEqual(['Q1?', 'Q2?']);
    expect(faq.mainEntity.map((q) => q.acceptedAnswer.text)).toEqual(['A1.', 'A2.']);
  });

  test('is valid JSON and every @id reference resolves inside the graph', () => {
    const json = JSON.stringify(graph);
    expect(() => JSON.parse(json)).not.toThrow();
    const ids = new Set(nodes(graph).map((n) => n['@id']).filter(Boolean));
    for (const ref of json.matchAll(/\{"@id":"([^"]+)"\}/g)) {
      expect(ids.has(ref[1]), `dangling reference ${ref[1]}`).toBe(true);
    }
  });
});

describe('content page structured data', () => {
  test('tool pages are a WebPage about the product; guides are an Article with dates', () => {
    for (const page of TOOL_PAGES) {
      const types = nodes(buildContentPageGraph(page)).map((n) => n['@type']);
      expect(types).toEqual(['WebPage', 'BreadcrumbList']);
    }
    for (const page of GUIDE_PAGES) {
      const article = nodes(buildContentPageGraph(page)).find((n) => n['@type'] === 'Article')!;
      expect(article.datePublished).toBe(page.published);
      expect(article.dateModified).toBe(page.updated);
      expect(article.headline).toBe(page.h1);
    }
  });

  test('breadcrumbs point at real canonical URLs and start at the home page', () => {
    for (const page of CONTENT_PAGES) {
      const crumb = nodes(buildContentPageGraph(page)).find((n) => n['@type'] === 'BreadcrumbList')! as unknown as {
        itemListElement: { position: number; item: string }[];
      };
      expect(crumb.itemListElement[0].item).toBe(`${SITE_ORIGIN}/`);
      expect(crumb.itemListElement[crumb.itemListElement.length - 1].item).toBe(`${SITE_ORIGIN}${page.path}`);
      crumb.itemListElement.forEach((c, i) => expect(c.position).toBe(i + 1));
    }
  });

  test('never invents ratings, reviews or prices', () => {
    for (const page of CONTENT_PAGES) {
      expect(JSON.stringify(buildContentPageGraph(page))).not.toMatch(/aggregateRating|"review"|"offers"|ratingValue|"price"/);
    }
  });
});
