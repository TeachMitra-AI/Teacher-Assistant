import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

// Makes each new page start at the top: an SPA keeps the scroll position across routes, so a footer link opened the next page
// scrolled to where the footer was. Mounted once inside <BrowserRouter> (App.tsx), covering every link and navigate().
// - Only PUSH/REPLACE scrolls; back/forward (POP) and the initial load are left to the browser's scroll restoration.
// - Only a changed pathname or hash scrolls, not the query string, so changing `?tab=…` doesn't yank the reader up.
// - A `#hash` matching an element scrolls to it; otherwise to the top.
// - `behavior: 'instant'`, since the home and legal pages set `scroll-behavior: smooth` on <html> and scrollTo(0, 0) would
//   otherwise animate a long scroll up from the footer.
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
