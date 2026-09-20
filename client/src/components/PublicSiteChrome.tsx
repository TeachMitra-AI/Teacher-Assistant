import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sun, Moon, Menu, X } from 'lucide-react';
import type { Mode } from './AuthForm';
import { ABOUT_PAGE, GUIDE_PAGES, TOOL_PAGES } from '../seo/pages';

// Header and footer shared by the public tool/guide pages
// (pages/ContentPage.tsx). Deliberately reuses the landing page's `.home-*`
// classes so these pages look like the same site; HomePage keeps its own
// header (it has in-page anchor links) and shares only <FooterSeoColumns />.

interface HeaderProps {
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  signedIn: boolean;
  onOpenAuth: (mode: Mode) => void;
}

export function PublicHeader({ theme, toggleTheme, signedIn, onOpenAuth }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="home-header-bar">
      <header className="home-header">
        <Link to="/" className="home-brand">
          <img src="/logo.png" alt="SarasTech" className="home-brand-logo" width={34} height={34} />
          <span className="home-brand-name">SarasTech</span>
        </Link>

        <nav className="home-nav" aria-label="Primary">
          {TOOL_PAGES.map((page) => (
            <Link key={page.path} to={page.path} className="home-nav-link">
              {page.shortLabel}
            </Link>
          ))}
        </nav>

        <div className="home-header-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-pressed={theme === 'dark'}
          >
            <span className="home-theme-icon" aria-hidden="true">
              <Sun size={18} className={`home-theme-icon-sun${theme === 'dark' ? ' is-active' : ''}`} />
              <Moon size={18} className={`home-theme-icon-moon${theme === 'dark' ? '' : ' is-active'}`} />
            </span>
          </button>
          {signedIn ? (
            <Link to="/" className="btn-primary home-header-cta home-desktop-only">
              Open app
            </Link>
          ) : (
            <>
              <button type="button" className="btn-text home-desktop-only" onClick={() => onOpenAuth('login')}>
                Sign In
              </button>
              <button
                type="button"
                className="btn-primary home-header-cta home-desktop-only"
                onClick={() => onOpenAuth('register')}
              >
                Get Started
              </button>
            </>
          )}
          <button
            type="button"
            className="icon-btn home-mobile-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="public-mobile-menu"
          >
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </header>

      {menuOpen && (
        <nav className="home-mobile-menu" id="public-mobile-menu" aria-label="Mobile">
          <Link to="/" className="home-mobile-menu-link" onClick={closeMenu}>
            Home
          </Link>
          {TOOL_PAGES.map((page) => (
            <Link key={page.path} to={page.path} className="home-mobile-menu-link" onClick={closeMenu}>
              {page.navLabel}
            </Link>
          ))}
          {signedIn ? (
            <Link to="/" className="btn-primary" onClick={closeMenu}>
              Open app
            </Link>
          ) : (
            <>
              <button
                type="button"
                className="btn-outline"
                onClick={() => {
                  closeMenu();
                  onOpenAuth('login');
                }}
              >
                Sign In
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  closeMenu();
                  onOpenAuth('register');
                }}
              >
                Get Started
              </button>
            </>
          )}
        </nav>
      )}
    </div>
  );
}

// The "Tools" and "Guides" link columns — crawlable, descriptive internal links
// to every public page, on the home page and every content page.
export function FooterSeoColumns() {
  return (
    <>
      <div className="home-footer-col">
        <h4>Tools</h4>
        <ul>
          {TOOL_PAGES.map((page) => (
            <li key={page.path}>
              <Link to={page.path}>{page.navLabel}</Link>
            </li>
          ))}
        </ul>
      </div>
      <div className="home-footer-col">
        <h4>Guides</h4>
        <ul>
          {GUIDE_PAGES.map((page) => (
            <li key={page.path}>
              <Link to={page.path}>{page.navLabel}</Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

export function PublicFooter({ signedIn, onOpenAuth }: { signedIn: boolean; onOpenAuth: (mode: Mode) => void }) {
  return (
    <footer className="home-footer">
      <div className="home-footer-inner">
        <div className="home-footer-col">
          <div className="home-footer-brand-row">
            <img src="/logo.png" alt="" className="home-footer-logo" width={24} height={24} />
            <span>SarasTech</span>
          </div>
          <p className="home-footer-tagline">An AI teaching assistant built for everyday classroom work in India.</p>
        </div>
        <FooterSeoColumns />
        <div className="home-footer-col">
          <h4>Account &amp; Legal</h4>
          <ul>
            <li>
              <Link to="/">Home</Link>
            </li>
            {!signedIn && (
              <li>
                <button type="button" className="home-footer-link-btn" onClick={() => onOpenAuth('login')}>
                  Sign In
                </button>
              </li>
            )}
            <li>
              <Link to={ABOUT_PAGE.path}>About SarasTech</Link>
            </li>
            <li>
              <Link to="/terms">Terms of Service</Link>
            </li>
            <li>
              <Link to="/privacy">Privacy Policy</Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="home-footer-bottom">© {new Date().getFullYear()} SarasTech</div>
    </footer>
  );
}
