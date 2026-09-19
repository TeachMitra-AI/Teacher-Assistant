import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// Global "new page starts at the top" behaviour. A single-page app keeps the
// window's scroll position across route changes, so clicking a footer link
// opened the next page scrolled down to where the footer had been. Mounted once
// inside <BrowserRouter> (see App.tsx) so it covers every link and every
// programmatic navigate() without any page having to remember to scroll itself.
//
// - Only a PUSH/REPLACE navigation scrolls. A back/forward (POP) navigation is
//   left alone so the browser's own scroll restoration keeps working, and so
//   does the initial page load (a reload keeps its position).
// - Scrolls only when the pathname or hash actually changed — NOT for the query
//   string — so changing only `?tab=…` on the same page doesn't yank the reader
//   to the top.
// - A `#hash` that matches an element scrolls to that element instead (an
//   in-page anchor); otherwise the page goes to the top.
// - `behavior: 'instant'` on purpose: the home and legal pages set
//   `scroll-behavior: smooth` on <html>, and a plain scrollTo(0, 0) would then
//   animate a long, visible scroll up from the footer instead of just opening
//   the new page at its top.
// - A layout effect, so the position is set before the new page paints.
export default function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  const previous = useRef({ pathname, hash });

  useLayoutEffect(() => {
    const changed = previous.current.pathname !== pathname || previous.current.hash !== hash;
    previous.current = { pathname, hash };
    if (!changed || navigationType === 'POP') return;

    if (hash) {
      let id = hash.slice(1);
      try {
        id = decodeURIComponent(id);
      } catch {
        // Malformed escape in the hash — fall back to the raw text.
      }
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView();
        return;
      }
    }

    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, hash, navigationType]);

  return null;
}
