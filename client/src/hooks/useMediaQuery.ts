import { useEffect, useState } from 'react';

/**
 * Subscribes a component to a CSS media query.
 *
 * Exists because a few places need a layout decision in JS that the stylesheet
 * is already making in CSS — most importantly the Coach page, where the context
 * row is rendered in a DIFFERENT PLACE on a phone (under the header) than on a
 * desktop (in the composer dock). That is a DOM change, not a style change, so
 * it cannot be done with a media query alone, and rendering the row twice and
 * hiding one copy would put two "Grade" comboboxes in the accessibility tree.
 *
 * Whatever query is passed must match the breakpoint the stylesheet uses for
 * the same decision, or the JS and the CSS will disagree in the gap between
 * them.
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
    // Set once on (re)subscribe: the query may have changed, or the viewport
    // may have moved between the initial render and this effect.
    setMatches(mq.matches);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
