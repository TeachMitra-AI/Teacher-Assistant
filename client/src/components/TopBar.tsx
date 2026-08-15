import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PanelLeft, Search, Sun, Moon } from 'lucide-react';
import { useAuth } from '../auth';
import { usePreferences } from '../hooks/usePreferences';
import { ADMIN_ROLES } from '../config';
import ProfileMenu from './ProfileMenu';

interface TopBarProps {
  preferences: ReturnType<typeof usePreferences>;
  onSidebarToggle?: () => void;
  sidebarOpen?: boolean;
  // Toggles ChatSearchOverlay, an overlay in the main content column (NOT
  // inside Sidebar — see CoachPage.tsx/ChatSearchOverlay.tsx). Only present
  // where onSidebarToggle is, since search has nothing to search without a
  // history sidebar's data to search within.
  onSearchToggle?: () => void;
  searchOpen?: boolean;
  // False only on the Coach page, where the account menu now lives at the
  // bottom of the history Sidebar instead — see Sidebar.tsx. Every other page
  // has no such sidebar, so this stays true (the default) there.
  showProfileMenu?: boolean;
  // A page-specific control rendered where this bar has room for one, e.g.
  // the Coach page's teaching-context icon (which sits in the slot the
  // profile chip used to occupy there, now that it moved to the Sidebar).
  extraControl?: ReactNode;
}

export default function TopBar({
  preferences, onSidebarToggle, sidebarOpen, onSearchToggle, searchOpen, showProfileMenu = true, extraControl,
}: TopBarProps) {
  const { user } = useAuth();
  const location = useLocation();
  const { theme, toggleTheme } = preferences;
  const isAdmin = user && ADMIN_ROLES.includes(user.role);

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-left">
          <Link to="/" className="brand" aria-label="Teacher Assistant — home">
            <span className="brand-logo" aria-hidden="true">👨‍🏫</span>
            <span className="brand-text">
              <strong className="brand-title">शिक्षक सहायक</strong>
              <span className="brand-sub">Teacher Assistant</span>
            </span>
          </Link>
          {onSidebarToggle && (
            <>
              <button
                type="button"
                className="icon-btn"
                onClick={onSearchToggle}
                title="Search chats"
                aria-label="Search chats"
                aria-pressed={searchOpen}
              >
                <Search size={18} aria-hidden="true" />
              </button>
              <button
                className="icon-btn sidebar-toggle"
                onClick={onSidebarToggle}
                title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                aria-pressed={sidebarOpen}
              >
                <PanelLeft size={18} aria-hidden="true" />
              </button>
            </>
          )}
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

          {extraControl}
          {showProfileMenu && <ProfileMenu variant="topbar" />}
        </div>
      </div>
    </header>
  );
}
