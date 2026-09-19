import { Fragment, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronDown, Info } from 'lucide-react';
import { usePreferences } from '../hooks/usePreferences';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useJsonLd } from '../hooks/useJsonLd';
import { useAuthModal } from '../hooks/useAuthModal';
import AuthModal from '../components/AuthModal';
import { PublicFooter, PublicHeader } from '../components/PublicSiteChrome';
import { buildContentPageGraph } from '../seo/schema';
import { absoluteUrl } from '../seo/site';
import { getContentPage } from '../seo/pages';
import type { ContentBlock, ContentPageData } from '../seo/types';

// Template for the public tool and guide pages defined in seo/pages.ts. Content
// lives in seo/content/*.ts; this file only decides how it is laid out, so every
// page gets the same semantics: one <h1>, <h2> per section, a breadcrumb that
// mirrors the JSON-LD, a visible last-updated date, related links, and a
// call-to-action. Rendered standalone by scripts/prerender.mjs (no providers)
// and inside the real app by App.tsx.

const LINK_OR_BOLD = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g;

// Inline markup: `[label](/path)` internal link, `[label](https://…)` external
// link, `**bold**`. Anything else is plain text (React escapes it).
function renderInline(text: string): ReactNode {
  return text.split(LINK_OR_BOLD).map((part, index) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const [, label, href] = link;
      return href.startsWith('/') ? (
        <Link key={index} to={href}>
          {label}
        </Link>
      ) : (
        <a key={index} href={href} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      );
    }
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={index}>{bold[1]}</strong>;
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function formatDate(iso: string): string {
  // Fixed en-IN/UTC formatting so the prerendered HTML and the client agree.
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function Block({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'p':
      return <p>{renderInline(block.text)}</p>;
    case 'h3':
      return <h3>{block.text}</h3>;
    case 'ul':
      return (
        <ul>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol className="seo-steps">
          {block.items.map((item, i) => (
            <li key={i}>
              {item.title && <strong>{item.title} </strong>}
              {renderInline(item.text)}
            </li>
          ))}
        </ol>
      );
    case 'table':
      return (
        <div className="seo-table-wrap">
          <table className="seo-table">
            {block.caption && <caption>{block.caption}</caption>}
            <thead>
              <tr>
                {block.headers.map((header) => (
                  <th key={header} scope="col">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) =>
                    c === 0 ? (
                      <th key={c} scope="row">
                        {renderInline(cell)}
                      </th>
                    ) : (
                      <td key={c}>{renderInline(cell)}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'note':
      return (
        <aside className="seo-note">
          <Info size={18} aria-hidden="true" />
          <div>
            <strong>{block.title}</strong>
            <p>{renderInline(block.text)}</p>
          </div>
        </aside>
      );
  }
}

export default function ContentPage({ page, signedIn = false }: { page: ContentPageData; signedIn?: boolean }) {
  const { theme, toggleTheme } = usePreferences();
  const { authMode, openAuth, closeAuth } = useAuthModal();

  useDocumentMeta({
    title: page.title,
    description: page.description,
    canonical: absoluteUrl(page.path),
  });
  // Memoised: useJsonLd re-serialises whenever the object identity changes.
  const structuredData = useMemo(() => buildContentPageGraph(page), [page]);
  useJsonLd(structuredData);

  const related = page.related
    .map((path) => getContentPage(path))
    .filter((p): p is ContentPageData => p !== undefined);

  const primaryCta = signedIn ? (
    <Link to={page.appPath} className="btn-primary home-cta-primary">
      {page.appLabel}
      <ArrowRight size={18} aria-hidden="true" />
    </Link>
  ) : (
    <button type="button" className="btn-primary home-cta-primary" onClick={() => openAuth('register')}>
      Get Started
      <ArrowRight size={18} aria-hidden="true" />
    </button>
  );

  return (
    <div className="home-page seo-page">
      <PublicHeader theme={theme} toggleTheme={toggleTheme} signedIn={signedIn} onOpenAuth={openAuth} />

      <main>
        <article className="seo-article">
          <header className="seo-hero">
            <nav className="seo-breadcrumb" aria-label="Breadcrumb">
              <ol>
                <li>
                  <Link to="/">Home</Link>
                </li>
                <li aria-current="page">{page.navLabel}</li>
              </ol>
            </nav>
            <span className="home-eyebrow">{page.eyebrow}</span>
            <h1>{page.h1}</h1>
            <p className="seo-intro">{renderInline(page.intro)}</p>
            <div className="seo-hero-cta">{primaryCta}</div>
            <p className="seo-meta">
              Written by the SarasTech team · Last updated{' '}
              <time dateTime={page.updated}>{formatDate(page.updated)}</time>
            </p>
          </header>

          {page.kind === 'guide' && (
            <nav className="seo-toc" aria-label="In this guide">
              <span className="seo-toc-label">In this guide</span>
              <ul>
                {page.sections.map((section) => (
                  <li key={section.id}>
                    <a href={`#${section.id}`}>{section.heading}</a>
                  </li>
                ))}
                {page.faqs.length > 0 && (
                  <li>
                    <a href="#faq">Frequently asked questions</a>
                  </li>
                )}
              </ul>
            </nav>
          )}

          <div className="seo-body">
            {page.sections.map((section) => (
              <section key={section.id} id={section.id} className="seo-section" aria-labelledby={`${section.id}-heading`}>
                <h2 id={`${section.id}-heading`}>{section.heading}</h2>
                {section.blocks.map((block, index) => (
                  <Block key={index} block={block} />
                ))}
              </section>
            ))}

            {page.faqs.length > 0 && (
              <section id="faq" className="seo-section" aria-labelledby="faq-heading">
                <h2 id="faq-heading">Frequently asked questions</h2>
                <div className="home-faq-list">
                  {page.faqs.map((faq) => (
                    <details className="home-faq-item" key={faq.question} name="seo-faq">
                      <summary className="home-faq-question">
                        <span>{faq.question}</span>
                        <ChevronDown className="home-faq-chevron" size={18} aria-hidden="true" />
                      </summary>
                      <p className="home-faq-answer">{faq.answer}</p>
                    </details>
                  ))}
                </div>
              </section>
            )}
          </div>
        </article>

        {related.length > 0 && (
          <section className="home-section seo-related" aria-labelledby="related-heading">
            <h2 id="related-heading">Keep exploring</h2>
            <div className="seo-related-grid">
              {related.map((item) => (
                <Link key={item.path} to={item.path} className="seo-related-card">
                  <span className="seo-related-kind">{item.kind === 'guide' ? 'Guide' : 'Tool'}</span>
                  <strong>{item.navLabel}</strong>
                  <span>{item.teaser}</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="home-cta-band" aria-labelledby="seo-final-cta-heading">
          <div className="home-cta-band-inner">
            <h2 id="seo-final-cta-heading">{page.cta.heading}</h2>
            <p>{page.cta.text}</p>
            <div className="home-hero-cta">
              {signedIn ? (
                <Link to={page.appPath} className="btn-primary home-cta-primary">
                  {page.appLabel}
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
              ) : (
                <>
                  <button type="button" className="btn-primary home-cta-primary" onClick={() => openAuth('register')}>
                    Get Started
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-outline home-cta-outline-inverse"
                    onClick={() => openAuth('login')}
                  >
                    Sign In
                  </button>
                </>
              )}
            </div>
          </div>
        </section>
      </main>

      <PublicFooter signedIn={signedIn} onOpenAuth={openAuth} />

      {!signedIn && <AuthModal open={authMode !== null} mode={authMode ?? 'login'} theme={theme} onClose={closeAuth} />}
    </div>
  );
}
