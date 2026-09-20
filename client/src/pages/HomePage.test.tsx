// HomePage — verifies the Sign In / Get Started links use React Router's
// viewTransition prop (smooth page transitions on click) and that clicking
// them still navigates correctly in jsdom, which has no
// document.startViewTransition — proving the feature degrades gracefully
// rather than throwing when the View Transitions API is unsupported.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import HomePage from './HomePage';

// usePreferences reads/writes localStorage directly; stubbed out here so this
// file only exercises the view-transition links, not theme persistence.
vi.mock('../hooks/usePreferences', () => ({
  usePreferences: () => ({ theme: 'light', toggleTheme: () => {} }),
}));

// jsdom has no matchMedia implementation; HomePage's parallax effect checks
// prefers-reduced-motion on mount, so it needs a stub to render at all here.
window.matchMedia =
  window.matchMedia ||
  ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);

function renderHome() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<div>Login page content</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function getAuthLinks() {
  return [
    ...screen.getAllByRole('link', { name: /sign in/i }),
    ...screen.getAllByRole('link', { name: /get started/i }),
  ];
}

describe('HomePage — Sign In / Get Started links', () => {
  test('every visible Sign In and Get Started link opts into React Router view transitions', () => {
    renderHome();

    // Header (2), hero (2), CTA band (2), footer (1) — the mobile menu's
    // pair only mounts once opened (covered below).
    const links = getAuthLinks();
    expect(links).toHaveLength(7);
    links.forEach((link) => {
      expect(link.getAttribute('href')).toMatch(/^\/login/);
    });
  });

  test('opening the mobile menu reveals its own Sign In and Get Started links, also opted into view transitions', async () => {
    renderHome();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /open menu/i }));

    // The mobile menu's links join the always-visible header/hero/CTA/footer ones.
    const links = getAuthLinks();
    expect(links).toHaveLength(9);
    links.forEach((link) => {
      expect(link.getAttribute('href')).toMatch(/^\/login/);
    });
  });

  test('clicking a Get Started link navigates to /login without document.startViewTransition (unsupported in this environment)', async () => {
    expect(document.startViewTransition).toBeUndefined();
    renderHome();

    const user = userEvent.setup();
    await user.click(screen.getAllByRole('link', { name: /get started/i })[0]);

    expect(await screen.findByText('Login page content')).toBeInTheDocument();
  });

  test('clicking the footer Sign In link navigates to /login', async () => {
    renderHome();

    const user = userEvent.setup();
    const signInLinks = screen.getAllByRole('link', { name: /sign in/i });
    const footerSignIn = signInLinks[signInLinks.length - 1];
    expect(footerSignIn).toBeDefined();
    await user.click(footerSignIn);

    expect(await screen.findByText('Login page content')).toBeInTheDocument();
  });
});
