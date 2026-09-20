import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ContentPage from './ContentPage';
import { ABOUT_PAGE, CONTENT_PAGES } from '../seo/pages';
import { absoluteUrl, SOCIAL_PROFILES } from '../seo/site';

// jsdom has no matchMedia; usePreferences reads it for the initial theme.
beforeEach(() => {
  window.matchMedia =
    window.matchMedia ||
    ((() => ({
      matches: false,
      media: '',
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia);
});

afterEach(() => {
  // Unmount first (vitest runs a file's afterEach before the setup file's
  // cleanup), so useJsonLd/useDocumentMeta can tidy <head> themselves; only
  // then wipe whatever a test put there.
  cleanup();
  document.head.innerHTML = '';
});

function renderPage(page: (typeof CONTENT_PAGES)[number], signedIn = false) {
  return render(
    <MemoryRouter initialEntries={[page.path]}>
      <ContentPage page={page} signedIn={signedIn} />
    </MemoryRouter>,
  );
}

describe('ContentPage', () => {
  test.each(CONTENT_PAGES.map((p) => [p.path, p] as const))('%s renders one H1 and a heading per section', (_path, page) => {
    const { container } = renderPage(page);

    const h1s = container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent(page.h1);

    const article = container.querySelector('article')!;
    const h2Text = [...article.querySelectorAll('h2')].map((h) => h.textContent);
    for (const section of page.sections) expect(h2Text).toContain(section.heading);
    expect(h2Text).toContain('Frequently asked questions');

    // Every FAQ answer is in the DOM (collapsed <details> still indexes).
    for (const faq of page.faqs) expect(screen.getByText(faq.question)).toBeInTheDocument();
  });

  test('shows a breadcrumb, a visible last-updated date and related links to other pages', () => {
    const page = CONTENT_PAGES[0];
    renderPage(page);

    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumb).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(within(crumb).getByText(page.navLabel)).toHaveAttribute('aria-current', 'page');

    expect(document.querySelector(`time[datetime="${page.updated}"]`)).not.toBeNull();

    const related = screen.getByRole('heading', { name: 'Keep exploring' }).closest('section')!;
    for (const path of page.related) {
      expect(related.querySelector(`a[href="${path}"]`), `related link ${path}`).not.toBeNull();
    }
  });

  test('renders inline links as real anchors and bold text as <strong>', () => {
    const page = CONTENT_PAGES.find((p) => p.path === '/guides/how-to-use-ai-for-lesson-planning')!;
    const { container } = renderPage(page);
    // Internal: a client-side router link.
    expect(container.querySelector('article a[href="/ai-worksheet-generator"]')).not.toBeNull();
    // External: safe target/rel.
    const external = container.querySelector<HTMLAnchorElement>('article a[href^="https://www.unesco.org"]')!;
    expect(external.rel).toContain('noopener');
    expect(container.querySelector('article strong')).not.toBeNull();
    // No raw markup leaks through.
    expect(container.querySelector('article')!.textContent).not.toMatch(/\]\(|\*\*/);
  });

  test('sets the document title, description, canonical and social tags — and restores them on unmount', () => {
    document.head.innerHTML = `
      <title>Original</title>
      <meta name="description" content="orig desc">
      <link rel="canonical" href="https://example.com/orig">
      <meta property="og:title" content="orig og">
      <meta property="og:url" content="https://example.com/orig">
      <meta name="twitter:title" content="orig tw">`;
    const page = CONTENT_PAGES[1];
    const { unmount } = renderPage(page);

    expect(document.title).toBe(page.title);
    expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute('content', page.description);
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', absoluteUrl(page.path));
    expect(document.head.querySelector('meta[property="og:title"]')).toHaveAttribute('content', page.title);
    expect(document.head.querySelector('meta[property="og:url"]')).toHaveAttribute('content', absoluteUrl(page.path));
    expect(document.head.querySelector('meta[name="twitter:title"]')).toHaveAttribute('content', page.title);

    unmount();
    expect(document.title).toBe('Original');
    expect(document.head.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://example.com/orig');
    expect(document.head.querySelector('meta[property="og:title"]')).toHaveAttribute('content', 'orig og');
  });

  test('injects exactly one JSON-LD script and removes it on unmount', () => {
    const { unmount } = renderPage(CONTENT_PAGES[0]);
    const scripts = document.head.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts).toHaveLength(1);
    expect(() => JSON.parse(scripts[0].textContent ?? '')).not.toThrow();
    unmount();
    expect(document.head.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(0);
  });

  test('signed-out visitors get sign-up calls to action; signed-in visitors get a link into the feature', () => {
    const page = CONTENT_PAGES.find((p) => p.path === '/ai-worksheet-generator')!;

    const out = renderPage(page, false);
    expect(screen.getAllByRole('button', { name: /Get Started/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: new RegExp(page.appLabel) })).toBeNull();
    out.unmount();

    renderPage(page, true);
    const links = screen.getAllByRole('link', { name: new RegExp(page.appLabel) });
    expect(links[0]).toHaveAttribute('href', page.appPath);
    expect(screen.queryByRole('button', { name: /Get Started/ })).toBeNull();
  });
});

describe('About page', () => {
  test('lists the official profiles as crawlable external links and is linked from the footer', () => {
    const { container } = renderPage(ABOUT_PAGE);

    const article = container.querySelector('article')!;
    for (const profile of SOCIAL_PROFILES) {
      const link = article.querySelector<HTMLAnchorElement>(`a[href="${profile.url}"]`);
      expect(link, `${profile.name} link`).not.toBeNull();
      expect(link!.rel).toContain('noopener');
      expect(link).toHaveTextContent(`SarasTech on ${profile.name}`);
    }

    const footer = container.querySelector('footer')!;
    expect(within(footer).getByRole('link', { name: 'About SarasTech' })).toHaveAttribute('href', '/about');
  });

  test('emits an AboutPage + Organization graph whose Organization keeps SarasTech as its name', () => {
    renderPage(ABOUT_PAGE);
    const script = document.head.querySelector('script[type="application/ld+json"]')!;
    const graph = JSON.parse(script.textContent ?? '') as { '@graph': { '@type': string; name?: string; alternateName?: string[] }[] };
    const org = graph['@graph'].find((n) => n['@type'] === 'Organization')!;
    expect(org.name).toBe('SarasTech');
    expect(org.alternateName).toContain('SarasTech AI');
    expect(graph['@graph'].some((n) => n['@type'] === 'AboutPage')).toBe(true);
  });
});
