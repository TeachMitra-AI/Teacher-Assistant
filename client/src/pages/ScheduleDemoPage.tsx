import { Link } from 'react-router-dom';
import { CalendarClock, Check, Users } from 'lucide-react';
import { usePreferences } from '../hooks/usePreferences';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useAuthModal } from '../hooks/useAuthModal';
import AuthModal from '../components/AuthModal';
import { PublicHeader, PublicFooter } from '../components/PublicSiteChrome';
import { DemoBookingWidget } from '../components/DemoBookingWidget';

const SITE_URL = 'https://www.sarastech.co.in/schedule-demo';

const COVERS = [
  'A walkthrough of the Coach, Generator, and Library for your teachers’ day-to-day use',
  'Multilingual support relevant to your state or board',
  'How teacher accounts and school admin roles work',
  'Rollout and onboarding for your staff',
];

// Public marketing/utility page for schools and organizations booking a demo
// call — see docs/schedule-a-call-plan.md. Reuses the same PublicHeader/
// PublicFooter and `.home-*` design language as ContentPage.tsx, so it reads
// as a natural part of the site rather than a bolted-on booking tool.
export default function ScheduleDemoPage({ signedIn = false }: { signedIn?: boolean }) {
  const { theme, toggleTheme } = usePreferences();
  const { authMode, openAuth, closeAuth } = useAuthModal();

  useDocumentMeta({
    title: 'Talk to SarasTech — Schedule a Call',
    description:
      'Book a 30-minute call to see how SarasTech can help your school or organization bring AI-assisted lesson planning, worksheets, and classroom tools to your teachers.',
    canonical: SITE_URL,
  });

  return (
    <div className="home-page seo-page demo-page">
      <PublicHeader theme={theme} toggleTheme={toggleTheme} signedIn={signedIn} onOpenAuth={openAuth} />

      <main>
        <header className="demo-hero">
          <span className="home-eyebrow">Schedule a Call</span>
          <h1>Talk to SarasTech</h1>
          <p>
            See how SarasTech can help your school or organization bring AI-assisted lesson planning, worksheets, and
            classroom tools to your teachers.
          </p>
        </header>

        <div className="demo-layout">
          <aside className="demo-info">
            <span className="demo-info-badge">
              <CalendarClock size={16} aria-hidden="true" /> 30-minute call
            </span>

            <h2>What we&rsquo;ll cover</h2>
            <ul className="demo-info-list">
              {COVERS.map((item) => (
                <li key={item}>
                  <Check size={14} aria-hidden="true" /> {item}
                </li>
              ))}
            </ul>

            <h2>Who this is for</h2>
            <p>
              <Users size={14} aria-hidden="true" /> School admins, principals, and organization or trust leadership
              evaluating SarasTech for their teachers.
            </p>
            <p className="demo-info-aside">
              Just want to try SarasTech yourself?{' '}
              {signedIn ? (
                <Link to="/" className="auth-link">
                  Open the app
                </Link>
              ) : (
                <button type="button" className="auth-link" onClick={() => openAuth('register')}>
                  Get Started
                </button>
              )}{' '}
              takes seconds.
            </p>

            <h2>What to expect</h2>
            <p>A live demo of the real product and time for your questions — not a slide deck.</p>
          </aside>

          <div className="demo-booking-panel">
            <DemoBookingWidget />
          </div>
        </div>
      </main>

      <PublicFooter signedIn={signedIn} onOpenAuth={openAuth} />

      {!signedIn && <AuthModal open={authMode !== null} mode={authMode ?? 'login'} theme={theme} onClose={closeAuth} />}
    </div>
  );
}
