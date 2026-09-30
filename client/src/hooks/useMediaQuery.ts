import { useEffect, useState } from 'react';

/**
 * Subscribes a component to a CSS media query. For layout decisions the stylesheet already makes in CSS but that need a DOM
 * change, mainly the Coach page, where the context row renders in a different place on phone and desktop (rendering it
 * twice and hiding one would put two "Grade" comboboxes in the accessibility tree). The query must match the stylesheet's
 * breakpoint for the same decision.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    // Set once on (re)subscribe: the query may have changed, or the viewport moved before this effect ran.
    setMatches(mq.matches);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
