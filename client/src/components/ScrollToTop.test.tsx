import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, useNavigate } from 'react-router-dom';
import ScrollToTop from './ScrollToTop';

let scrollTo: ReturnType<typeof vi.fn>;
let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollTo = vi.fn();
  scrollIntoView = vi.fn();
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo;
  // jsdom doesn't implement scrollIntoView.
  Element.prototype.scrollIntoView = scrollIntoView as unknown as typeof Element.prototype.scrollIntoView;
});

afterEach(() => {
  vi.restoreAllMocks();
});

let navigateRef: ReturnType<typeof useNavigate>;
function Harness() {
  navigateRef = useNavigate();
  return (
    <>
      <ScrollToTop />
      <Link to="/ai-worksheet-generator">worksheet</Link>
      <Link to="/?tab=one">query-only</Link>
      <Link to="/#target">anchor</Link>
      <Link to="/#missing">missing anchor</Link>
      <div id="target">target</div>
    </>
  );
}

function setup(initial = '/') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Harness />
    </MemoryRouter>,
  );
}

describe('ScrollToTop', () => {
  test('does not scroll on the initial page load (a reload keeps its position)', () => {
    setup();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  test('a link click to a different route scrolls to the top, instantly', async () => {
    setup();
    await userEvent.click(screen.getByText('worksheet'));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    // 'instant' so the home/legal pages' `scroll-behavior: smooth` doesn't animate it.
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });

  test('programmatic navigate() (push and replace) scrolls to the top too', () => {
    setup();
    act(() => navigateRef('/guides/lesson-plan-format'));
    expect(scrollTo).toHaveBeenCalledTimes(1);
    act(() => navigateRef('/ai-quiz-generator', { replace: true }));
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  test('back/forward navigation is left to the browser and does not scroll', () => {
    setup();
    act(() => navigateRef('/ai-worksheet-generator'));
    scrollTo.mockClear();

    act(() => navigateRef(-1));
    expect(scrollTo).not.toHaveBeenCalled();
    act(() => navigateRef(1));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  test('changing only the query string on the same page does not scroll', async () => {
    setup();
    await userEvent.click(screen.getByText('query-only'));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  test('a hash that matches an element scrolls to it instead of the top', async () => {
    setup();
    await userEvent.click(screen.getByText('anchor'));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  test('a hash with no matching element falls back to the top', async () => {
    setup();
    await userEvent.click(screen.getByText('missing anchor'));
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'instant' });
  });
});
