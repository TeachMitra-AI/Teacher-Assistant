import { useSearchParams } from 'react-router-dom';
import { Sun, Moon, Lightbulb, Languages, BookOpen } from 'lucide-react';
import AuthForm from '../components/AuthForm';
import { usePreferences } from '../hooks/usePreferences';

export default function LoginPage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  // The landing page's "Start Teaching Smarter" CTA links here with ?mode=register to open straight into sign-up. Read once on
  // mount to set the initial tab, not kept in sync afterwards.
  const [searchParams] = useSearchParams();
  const { theme, toggleTheme } = preferences;

  return (
    <div className="auth-screen">
      <button
        className="icon-btn auth-theme"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        aria-pressed={theme === 'dark'}
      >
        {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
      </button>

      <div className="auth-layout auth-layout--split">
        <aside className="auth-hero" aria-hidden="true">
          <div className="auth-hero-inner">
            <img src="/logo.png" alt="" className="auth-hero-logo" />
            <h2 className="auth-hero-title">SarasTech</h2>
            <p className="auth-hero-tagline">
              Your AI teaching companion — practical, classroom-ready advice in your language.
            </p>
            <ul className="auth-hero-points">
              <li><span><Lightbulb size={15} aria-hidden="true" /></span> Instant lesson ideas &amp; activities</li>
              <li><span><Languages size={15} aria-hidden="true" /></span> Answers in 9 Indian languages</li>
              <li><span><BookOpen size={15} aria-hidden="true" /></span> Built for real classrooms</li>
            </ul>
          </div>
        </aside>

        <div className="auth-card">
          <AuthForm theme={theme} initialMode={searchParams.get('mode') === 'register' ? 'register' : 'login'} />
        </div>
      </div>
    </div>
  );
}
