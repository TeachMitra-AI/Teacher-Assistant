import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { usePreferences } from '../hooks/usePreferences';
import { ADMIN_ROLES, ROLE_LABELS } from '../config';

interface TopBarProps {
  preferences: ReturnType<typeof usePreferences>;
  onHistoryToggle?: () => void;
  historyCount?: number;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const letters = parts.slice(0, 2).map((p) => p[0]);
  return letters.join('').toUpperCase();
}

export default function TopBar({ preferences, onHistoryToggle, historyCount = 0 }: TopBarProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const { theme, toggleTheme, changeFont, canIncrease, canDecrease } = preferences;
  const isAdmin = user && ADMIN_ROLES.includes(user.role);
  const displayName = user ? user.displayName || user.name : '';
  const avatarEmoji = user?.preferences?.avatar;

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link to="/" className="brand" aria-label="Teacher Assistant — home">
          <span className="brand-logo" aria-hidden="true">👨‍🏫</span>
          <span className="brand-text">
            <strong className="brand-title">शिक्षक सहायक</strong>
            <span className="brand-sub">Teacher Assistant</span>
          </span>
        </Link>

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

          <div className="btn-group" role="group" aria-label="Text size">
            <button className="icon-btn" onClick={() => changeFont(-2)} disabled={!canDecrease} title="Smaller text" aria-label="Decrease text size">A−</button>
            <button className="icon-btn" onClick={() => changeFont(2)} disabled={!canIncrease} title="Larger text" aria-label="Increase text size">A+</button>
          </div>

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
            <Link
              to="/settings"
              className={`icon-btn${location.pathname === '/settings' ? ' active' : ''}`}
              title="Settings"
              aria-label="Settings"
              aria-current={location.pathname === '/settings' ? 'page' : undefined}
            >
              ⚙️
            </Link>
          )}

          {onHistoryToggle && (
            <button
              className="icon-btn history-toggle"
              onClick={onHistoryToggle}
              title="Recent questions"
              aria-label={historyCount > 0 ? `Recent questions (${historyCount})` : 'Recent questions'}
            >
              🕘
              {historyCount > 0 && <span className="history-badge">{historyCount}</span>}
            </button>
          )}

          {user && (
            <>
              <span className="topbar-divider" aria-hidden="true" />
              <div className="user-chip">
                <span className={`user-avatar${avatarEmoji ? ' user-avatar-emoji' : ''}`} aria-hidden="true">
                  {avatarEmoji || initialsOf(displayName)}
                </span>
                <span className="user-meta">
                  <span className="user-name">{displayName}</span>
                  <span className="user-role">{ROLE_LABELS[user.role]}</span>
                </span>
              </div>
            </>
          )}

          <button className="btn-signout" onClick={logout} title="Sign out" aria-label="Sign out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span className="btn-signout-label">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
