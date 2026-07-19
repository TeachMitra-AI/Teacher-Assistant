import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { usePreferences } from '../hooks/usePreferences';
import { ADMIN_ROLES, ROLE_LABELS } from '../config';

interface TopBarProps {
  preferences: ReturnType<typeof usePreferences>;
  onHistoryToggle?: () => void;
  historyCount?: number;
}

export default function TopBar({ preferences, onHistoryToggle, historyCount = 0 }: TopBarProps) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const { theme, toggleTheme, changeFont, canIncrease, canDecrease } = preferences;
  const isAdmin = user && ADMIN_ROLES.includes(user.role);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">👨‍🏫</span>
          <div className="brand-text">
            <strong>शिक्षक सहायक</strong>
            <span className="brand-sub">Teacher Assistant</span>
          </div>
        </div>

        <div className="topbar-controls">
          {isAdmin && (
            <nav className="topbar-nav">
              <Link to="/" className={`nav-link${location.pathname === '/' ? ' active' : ''}`}>Coach</Link>
              <Link to="/admin" className={`nav-link${location.pathname === '/admin' ? ' active' : ''}`}>Dashboard</Link>
            </nav>
          )}

          <button className="icon-btn" onClick={() => changeFont(-2)} disabled={!canDecrease} title="Smaller text" aria-label="Decrease text size">A−</button>
          <button className="icon-btn" onClick={() => changeFont(2)} disabled={!canIncrease} title="Larger text" aria-label="Increase text size">A+</button>
          <button className="icon-btn" onClick={toggleTheme} title="Toggle theme" aria-label="Toggle dark mode">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>

          {user && (
            <Link
              to="/settings"
              className={`icon-btn${location.pathname === '/settings' ? ' active' : ''}`}
              title="Settings"
              aria-label="Settings"
            >
              ⚙️
            </Link>
          )}

          {onHistoryToggle && (
            <button className="icon-btn history-toggle" onClick={onHistoryToggle} title="Recent questions" aria-label="Recent questions">
              🕘
              {historyCount > 0 && <span className="history-badge">{historyCount}</span>}
            </button>
          )}

          {user && (
            <div className="user-chip">
              {user.preferences?.avatar && (
                <span className="user-avatar" aria-hidden="true">{user.preferences.avatar}</span>
              )}
              <span className="user-meta">
                <span className="user-name">{user.displayName || user.name}</span>
                <span className="user-role">{ROLE_LABELS[user.role]}</span>
              </span>
            </div>
          )}
          <button className="btn-text" onClick={logout} title="Sign out">Sign out</button>
        </div>
      </div>
    </header>
  );
}
