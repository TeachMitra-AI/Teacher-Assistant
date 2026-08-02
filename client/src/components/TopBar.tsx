import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PanelLeft, Sun, Moon, Compass, Settings, LifeBuoy, LogOut } from 'lucide-react';
import { useAuth } from '../auth';
import { useOnboarding } from '../onboarding';
import { usePreferences } from '../hooks/usePreferences';
import { useDismissable } from '../hooks/useDismissable';
import { useHelpSupport } from './HelpSupport';
import { ADMIN_ROLES, HELP_SUPPORT_ENABLED, ROLE_LABELS } from '../config';

interface TopBarProps {
  preferences: ReturnType<typeof usePreferences>;
  onSidebarToggle?: () => void;
  sidebarOpen?: boolean;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.slice(0, 2).map((p) => p[0]);
  return letters.join('').toUpperCase();
}

export default function TopBar({ preferences, onSidebarToggle, sidebarOpen }: TopBarProps) {
  const { user, logout } = useAuth();
  const { reopenIntro } = useOnboarding();
  const { openMenu: openHelp } = useHelpSupport();
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = preferences;
  const isAdmin = user && ADMIN_ROLES.includes(user.role);
  const displayName = user ? user.displayName || user.name : '';
  const avatarEmoji = user?.preferences?.avatar;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismissable(menuOpen, menuRef, () => setMenuOpen(false));

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-left">
          {onSidebarToggle && (
            <button
              className="icon-btn sidebar-toggle"
              onClick={onSidebarToggle}
              title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              aria-pressed={sidebarOpen}
            >
              <PanelLeft size={18} aria-hidden="true" />
            </button>
          )}
          <Link to="/" className="brand" aria-label="Teacher Assistant — home">
            <span className="brand-logo" aria-hidden="true">👨‍🏫</span>
            <span className="brand-text">
              <strong className="brand-title">शिक्षक सहायक</strong>
              <span className="brand-sub">Teacher Assistant</span>
            </span>
          </Link>
        </div>

        <div className="topbar-controls">
          <nav className="topbar-nav" aria-label="Primary">
            <Link
              to="/"
              className={`nav-link${location.pathname === '/' ? ' active' : ''}`}
              aria-current={location.pathname === '/' ? 'page' : undefined}
            >
              Coach
            </Link>
            <Link
              to="/library"
              className={`nav-link${location.pathname.startsWith('/library') ? ' active' : ''}`}
              aria-current={location.pathname.startsWith('/library') ? 'page' : undefined}
            >
              Library
            </Link>
            <Link
              to="/generator"
              className={`nav-link${location.pathname.startsWith('/generator') ? ' active' : ''}`}
              aria-current={location.pathname.startsWith('/generator') ? 'page' : undefined}
            >
              Generator
            </Link>
            {isAdmin && (
              <Link
                to="/admin"
                className={`nav-link${location.pathname.startsWith('/admin') ? ' active' : ''}`}
                aria-current={location.pathname.startsWith('/admin') ? 'page' : undefined}
              >
                Dashboard
              </Link>
            )}
          </nav>
          <span className="topbar-divider" aria-hidden="true" />

          <button
            className="icon-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-pressed={theme === 'dark'}
          >
            {theme === 'dark' ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </button>

          {user && (
            <div className="profile-menu" ref={menuRef}>
              <button
                className="user-chip user-chip-btn"
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={`Account menu for ${displayName}`}
              >
                <span className={`user-avatar${avatarEmoji ? ' user-avatar-emoji' : ''}`} aria-hidden="true">
                  {avatarEmoji || initialsOf(displayName)}
                </span>
                <span className="user-meta">
                  <span className="user-name">{displayName}</span>
                  <span className="user-role">{ROLE_LABELS[user.role]}</span>
                </span>
              </button>

              {menuOpen && (
                <div className="profile-dropdown" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="profile-dropdown-item"
                    onClick={() => { setMenuOpen(false); reopenIntro(); navigate('/'); }}
                  >
                    <Compass size={15} aria-hidden="true" /> Getting started
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="profile-dropdown-item"
                    onClick={() => { setMenuOpen(false); navigate('/settings'); }}
                  >
                    <Settings size={15} aria-hidden="true" /> Settings
                  </button>
                  {HELP_SUPPORT_ENABLED && (
                    <button
                      type="button"
                      role="menuitem"
                      className="profile-dropdown-item"
                      onClick={() => { setMenuOpen(false); openHelp(); }}
                    >
                      <LifeBuoy size={15} aria-hidden="true" /> Need Help?
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    className="profile-dropdown-item profile-dropdown-danger"
                    onClick={() => { setMenuOpen(false); logout(); }}
                  >
                    <LogOut size={15} aria-hidden="true" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
