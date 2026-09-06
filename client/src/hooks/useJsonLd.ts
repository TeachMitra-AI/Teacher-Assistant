import { useEffect } from 'react';

// Injects a single <script type="application/ld+json"> into <head> for the
// lifetime of the calling component, removing it on unmount — same lifecycle
// pattern as useDocumentMeta. Callers pass an already-built JSON-LD object
// (typically a single `@graph` of multiple schema.org types); this hook has
// no opinion on schema shape, it just serializes and mounts/unmounts it.
//
// Reuses an existing matching script tag rather than always creating a new
// one: the prerender step (scripts/prerender.mjs) already bakes one into the
// static HTML for "/", so an unconditional append left two identical copies
// in <head> after client hydration. Adopting that tag on mount (like
// useDocumentMeta adopts existing meta/link tags) and removing it on unmount
// keeps the count at exactly one across prerender -> hydrate and any number
// of later SPA navigations.
export function useJsonLd(data: object) {
  useEffect(() => {
    const existing = document.head.querySelector<HTMLScriptElement>('script[type="application/ld+json"]');
    const script = existing ?? document.createElement('script');
    script.type = 'application/ld+json';
    script.text = JSON.stringify(data);
    if (!existing) document.head.appendChild(script);

    return () => {
      document.head.removeChild(script);
    };
  }, [data]);
}
