import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { SITE_NAME, SOCIAL_PROFILES } from '../seo/site';

// "Follow SarasTech" — the compact social section between the home page's final
// CTA and the footer. The profiles come from SOCIAL_PROFILES (seo/site.ts), the
// same list that feeds Organization `sameAs`, so adding a platform is a data
// change there plus, optionally, an icon here. lucide-react ships no brand
// icons, hence the small inline SVGs (24x24 stroke, matching lucide's style).
// No `.home-reveal` entrance animation on purpose: its view() timeline binds to
// the non-scrolling `.home-page` container, so anything near the page bottom
// stays stuck partly transparent (measured 0.24 opacity here) — unreadable.

const svgProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

// Keyed by SocialProfile.id. A profile with no entry falls back to a generic
// external-link icon, so a new platform never renders as a broken/empty link.
const ICONS: Record<string, ReactNode> = {
  linkedin: (
    <svg {...svgProps}>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  ),
  instagram: (
    <svg {...svgProps}>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  ),
  x: (
    <svg {...svgProps}>
      <path d="M4 4l11.733 16h4.267l-11.733 -16z" />
      <path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772" />
    </svg>
  ),
  youtube: (
    <svg {...svgProps}>
      <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </svg>
  ),
  substack: (
    <svg {...svgProps}>
      <line x1="4" y1="4" x2="20" y2="4" />
      <line x1="4" y1="9" x2="20" y2="9" />
      <path d="M4 13h16v8l-8-5-8 5z" />
    </svg>
  ),
  reddit: (
    <svg {...svgProps}>
      <ellipse cx="12" cy="14" rx="8" ry="6" />
      <circle cx="9" cy="13" r="1" />
      <circle cx="15" cy="13" r="1" />
      <path d="M9.5 16.5c1.5 1 3.5 1 5 0" />
      <path d="M12 8l1-5 4 1" />
      <circle cx="18" cy="4.5" r="1.3" />
    </svg>
  ),
};

export function SocialLinks() {
  return (
    <section className="home-social" id="follow" aria-labelledby="home-social-heading">
      <div className="home-social-inner">
        <h2 id="home-social-heading">Follow {SITE_NAME}</h2>
        <p>Stay connected for teaching tips, AI tools, and classroom ideas.</p>
        <ul className="home-social-list">
          {SOCIAL_PROFILES.map((profile) => (
            <li key={profile.id}>
              <a
                className="home-social-link"
                href={profile.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${SITE_NAME} on ${profile.name}`}
              >
                {ICONS[profile.id] ?? <ExternalLink size={18} aria-hidden="true" />}
                <span>{profile.name}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
