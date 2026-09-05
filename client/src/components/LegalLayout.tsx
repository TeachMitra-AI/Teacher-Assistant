import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Clock, type LucideIcon } from 'lucide-react';

// Shared chrome for the standalone Terms of Service / Privacy Policy pages
// (see index.css .legal-* rules) — opened in their own browser tab from
// ProfileMenu's "Learn more" flyout, so this is its own document, isolated
// from the rest of the app. Smooth-scrolling the whole document for the
// table-of-contents anchor links is scoped to just this tab for that reason.
export interface TocEntry {
  id: string;
  label: string;
}

interface LegalLayoutProps {
  icon: LucideIcon;
  title: string;
  intro: string;
  updated: string;
  toc: TocEntry[];
  otherDoc: { to: string; label: string };
  children: ReactNode;
}

export default function LegalLayout({ icon: Icon, title, intro, updated, toc, otherDoc, children }: LegalLayoutProps) {
  const navigate = useNavigate();

  useEffect(() => {
    document.documentElement.style.scrollBehavior = 'smooth';
  }, []);

  // This page is reached by window.open()-ing a new tab from ProfileMenu's
  // "Learn more" flyout — the app itself stays open behind it. "Back to app"
  // should return to that original tab, so close this one rather than
  // navigating it. window.close() only works on a tab a script opened; if
  // it's refused (e.g. this tab was bookmarked, or reached via the Terms ↔
  // Privacy cross-link below, which stays in the same tab), fall back to an
  // in-page navigation instead of the click doing nothing.
  function handleBackToApp() {
    window.close();
    setTimeout(() => navigate('/'), 250);
  }

  // Scroll-spy: highlights whichever section is currently under a thin band
  // near the top of the viewport, so "On this page" tracks reading position
  // as you scroll up or down rather than only responding to a click.
  const [activeId, setActiveId] = useState<string | null>(toc[0]?.id ?? null);

  useEffect(() => {
    const sections = toc
      .map((entry) => document.getElementById(entry.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        const topmost = visible.reduce((a, b) => (a.boundingClientRect.top <= b.boundingClientRect.top ? a : b));
        setActiveId(topmost.target.id);
      },
      // A band near the top of the viewport counts as "current" — a section
      // has to reach roughly there, not merely appear at the bottom edge,
      // before it takes over the highlight.
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [toc]);

  // The band above only tracks a section once it reaches near the top of the
  // viewport — the last section(s) on the page may never get there, since
  // there's no more page left to scroll them up into it. Snap to the last
  // entry once the page is scrolled (at most a couple of pixels off, for
  // rounding) to its end, so reaching the bottom always highlights it.
  useEffect(() => {
    const lastId = toc[toc.length - 1]?.id;
    if (!lastId) return;
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
        if (atBottom) setActiveId(lastId);
        ticking = false;
      });
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [toc]);

  return (
    <div className="legal-page">
      <header className="legal-topbar">
        <Link to="/" className="brand" aria-label="SarasTech — home">
          <img src="/logo.png" alt="" className="brand-logo" aria-hidden="true" />
          <span className="brand-text">
            <strong className="brand-title">SarasTech</strong>
            <span className="brand-sub">Teacher Assistant</span>
          </span>
        </Link>
        <button type="button" className="legal-back" onClick={handleBackToApp}>
          <ArrowLeft size={15} aria-hidden="true" /> Back to app
        </button>
      </header>

      <div className="legal-hero">
        <div className="legal-hero-icon"><Icon size={24} aria-hidden="true" /></div>
        <h1 className="legal-title">{title}</h1>
        <p className="legal-intro">{intro}</p>
        <span className="legal-updated-pill">
          <Clock size={13} aria-hidden="true" /> Last updated {updated}
        </span>
      </div>

      <div className="legal-body">
        <nav className="legal-toc" aria-label="On this page">
          <span className="legal-toc-label">On this page</span>
          <ul>
            {toc.map((entry) => (
              <li key={entry.id}>
                <a
                  href={`#${entry.id}`}
                  className={entry.id === activeId ? 'active' : undefined}
                  aria-current={entry.id === activeId ? 'true' : undefined}
                >
                  {entry.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="legal-content">{children}</div>
      </div>

      <footer className="legal-footer">
        <p>
          Looking for the other policy? <Link to={otherDoc.to}>{otherDoc.label}</Link>
        </p>
      </footer>
    </div>
  );
}

export function LegalSection({ id, icon: Icon, title, children }: { id: string; icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section id={id} className="legal-section">
      <h2>
        <span className="legal-section-icon"><Icon size={16} aria-hidden="true" /></span>
        {title}
      </h2>
      {children}
    </section>
  );
}
