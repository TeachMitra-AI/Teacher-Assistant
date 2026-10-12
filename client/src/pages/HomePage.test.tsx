import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from './HomePage';

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
  // Unmount first so useJsonLd/useDocumentMeta tidy <head> themselves; then wipe whatever a test put there.
  cleanup();
  document.head.innerHTML = '';
});

function renderFaq() {
  const { container } = render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
  const section = container.querySelector<HTMLElement>('#faq')!;
  // A button group, not a navigation landmark: the buttons switch which questions are shown rather than navigate.
  expect(within(section).queryByRole('navigation')).toBeNull();
  return { section, nav: within(section).getByRole('group', { name: 'FAQ categories' }) };
}

describe('HomePage FAQ', () => {
  test('lists the four categories with the first one active', () => {
    const { nav } = renderFaq();
    const buttons = within(nav).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Getting Started',
      'Features & Teaching Tools',
      'Languages & Classroom Support',
      'Privacy & Accuracy',
    ]);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
  });

  test('selecting a category shows only its questions, and every answer stays in the DOM', () => {
    const { section, nav } = renderFaq();
    expect(within(section).getByText('What is SarasTech?')).toBeVisible();
    expect(within(section).getByText('Which languages does it support?')).not.toBeVisible();

    fireEvent.click(within(nav).getByRole('button', { name: 'Languages & Classroom Support' }));

    expect(within(nav).getByRole('button', { name: 'Languages & Classroom Support' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(nav).getByRole('button', { name: 'Getting Started' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(section).getByText('Which languages does it support?')).toBeVisible();
    expect(within(section).getByText('What is SarasTech?')).not.toBeVisible();
    // Hidden panels are still rendered, so their text is present for indexing.
    expect(within(section).getByText('Can the AI make mistakes?')).toBeInTheDocument();
  });

  test('FAQPage JSON-LD lists every question across all categories', () => {
    const { section } = renderFaq();
    const rendered = [...section.querySelectorAll('.home-faq-question span')].map((s) => s.textContent);
    expect(rendered).toHaveLength(12);

    const graphs = [...document.head.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent!));
    const nodes = graphs.flatMap((g) => g['@graph'] ?? [g]);
    const faqPage = nodes.find((n) => n['@type'] === 'FAQPage');
    expect(faqPage.mainEntity.map((q: { name: string }) => q.name)).toEqual(rendered);
  });

  test('each panel is its own exclusive accordion', () => {
    const { section } = renderFaq();
    const names = [...section.querySelectorAll('details')].map((d) => d.getAttribute('name'));
    expect(new Set(names)).toEqual(
      new Set(['home-faq-getting-started', 'home-faq-features', 'home-faq-languages', 'home-faq-privacy']),
    );
  });
});
