import { useEffect } from 'react';

// Injects one <script type="application/ld+json"> into <head> for the component's lifetime, like useDocumentMeta. Callers
// pass a built JSON-LD object; the hook doesn't care about its shape. It reuses an existing matching tag because the
// prerender step (scripts/prerender.mjs) already bakes one into "/", and appending again left two copies after hydration.
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
