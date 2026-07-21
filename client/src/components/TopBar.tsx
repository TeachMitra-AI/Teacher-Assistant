import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { usePreferences } from '../hooks/usePreferences';
import { useDismissable } from '../hooks/useDismissable';
import { ADMIN_ROLES, ROLE_LABELS } from '../config';

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
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <line x1="9" y1="4" x2="9" y2="20" />
              </svg>
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
          {isAdmin && (
            <>
              <nav className="topbar-nav" aria-label="Primary">
                <Link
                  to="/"
                  className={`nav-link${location.pathname === '/' ? ' active' : ''}`}
                  aria-current={location.pathname === '/' ? 'page' : undefined}
                >
                  Coach
                </Link>
                <Link
                  to="/admin"
                  className={`nav-link${location.pathname.startsWith('/admin') ? ' active' : ''}`}
                  aria-current={location.pathname.startsWith('/admin') ? 'page' : undefined}
                >
                  Dashboard
                </Link>
              </nav>
              <span className="topbar-divider" aria-hidden="true" />
            </>
          )}

          <button
            className="icon-btn"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-pressed={theme === 'dark'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
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
                    onClick={() => { setMenuOpen(false); navigate('/settings'); }}
                  >
                    ⚙️ Settings
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="profile-dropdown-item profile-dropdown-danger"
                    onClick={() => { setMenuOpen(false); logout(); }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
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
