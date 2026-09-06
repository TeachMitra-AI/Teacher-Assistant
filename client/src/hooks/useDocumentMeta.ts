import { useEffect } from 'react';

interface DocumentMeta {
  title: string;
  description: string;
  canonical: string;
}

// Updates the shared index.html title/description/canonical tags for the
// current public route, and restores whatever was there before on unmount —
// so navigating away to a route that doesn't call this hook (e.g. /login)
// doesn't keep showing a previous page's title/description/canonical.
export function useDocumentMeta({ title, description, canonical }: DocumentMeta) {
  useEffect(() => {
    const descriptionTag = document.head.querySelector('meta[name="description"]');
    const canonicalTag = document.head.querySelector('link[rel="canonical"]');

    const previousTitle = document.title;
    const previousDescription = descriptionTag?.getAttribute('content') ?? '';
    const previousCanonical = canonicalTag?.getAttribute('href') ?? '';

    document.title = title;
    descriptionTag?.setAttribute('content', description);
    canonicalTag?.setAttribute('href', canonical);

    return () => {
      document.title = previousTitle;
      descriptionTag?.setAttribute('content', previousDescription);
      canonicalTag?.setAttribute('href', previousCanonical);
    };
  }, [title, description, canonical]);
}
