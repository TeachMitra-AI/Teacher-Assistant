import { useEffect } from 'react';

interface DocumentMeta {
  title: string;
  description: string;
  canonical: string;
}

// Updates the shared index.html title, description, canonical and the mirrored Open Graph/Twitter tags for the current public
// route (so shares on WhatsApp or LinkedIn preview the page's own title and URL), and restores the previous values on unmount.
export function useDocumentMeta({ title, description, canonical }: DocumentMeta) {
  useEffect(() => {
    const targets: { selector: string; attribute: 'content' | 'href'; value: string }[] = [
      { selector: 'meta[name="description"]', attribute: 'content', value: description },
      { selector: 'link[rel="canonical"]', attribute: 'href', value: canonical },
      { selector: 'meta[property="og:title"]', attribute: 'content', value: title },
      { selector: 'meta[property="og:description"]', attribute: 'content', value: description },
      { selector: 'meta[property="og:url"]', attribute: 'content', value: canonical },
      { selector: 'meta[name="twitter:title"]', attribute: 'content', value: title },
      { selector: 'meta[name="twitter:description"]', attribute: 'content', value: description },
    ];

    const previousTitle = document.title;
    const previous = targets.map(({ selector, attribute }) => {
      const element = document.head.querySelector(selector);
      return { element, value: element?.getAttribute(attribute) ?? '' };
    });

    document.title = title;
    targets.forEach(({ selector, attribute, value }) => {
      document.head.querySelector(selector)?.setAttribute(attribute, value);
    });

    return () => {
      document.title = previousTitle;
      targets.forEach(({ attribute }, index) => {
        previous[index].element?.setAttribute(attribute, previous[index].value);
      });
    };
  }, [title, description, canonical]);
}
