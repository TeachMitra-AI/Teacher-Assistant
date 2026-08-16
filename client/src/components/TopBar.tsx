import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PanelLeft, Sun, Moon } from 'lucide-react';
import { useAuth } from '../auth';
import { usePreferences } from '../hooks/usePreferences';
import { ADMIN_ROLES, NOTIFICATIONS_ENABLED, CLASSROOM_MANAGEMENT_ENABLED } from '../config';
import ProfileMenu from './ProfileMenu';
import NotificationBell from './Notifications';

interface TopBarProps {
  preferences: ReturnType<typeof usePreferences>;
  // Present only on the Coach page. Branding, search, and the sidebar
  // collapse control now live in Sidebar's own header (see Sidebar.tsx) —
  // this callback remains here for exactly one case: opening the mobile
  // drawer, which is off-canvas while closed and so cannot hold its own
  // reopen button. See the isMobile/sidebarOpen guard below.
  onSidebarToggle?: () => void;
  sidebarOpen?: boolean;
  // Whether the viewport is at the mobile breakpoint — needed alongside
  // sidebarOpen to decide if the mobile "open drawer" button belongs here
  // (closed drawer only; an open drawer already has its own close button,
  // and desktop's collapsed rail has its own reopen button — see Sidebar.tsx).
  isMobile?: boolean;
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
  preferences, onSidebarToggle, sidebarOpen, isMobile, showProfileMenu = true, extraControl,
}: TopBarProps) {
  const { user } = useAuth();
  const location = useLocation();
  const { theme, toggleTheme } = preferences;
  const isAdmin = user && ADMIN_ROLES.includes(user.role);
  // Only the Coach page's mobile-closed state needs a control here — every
  // other combination (desktop, or mobile with the drawer open) has its
  // reopen/close control inside the Sidebar itself.
  const showMobileSidebarOpen = Boolean(onSidebarToggle) && isMobile && !sidebarOpen;

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-left">
          {/* Hidden on the Coach page (onSidebarToggle set): branding lives in
              Sidebar's header there instead — see Sidebar.tsx. */}
          {!onSidebarToggle && (
            <Link to="/" className="brand" aria-label="Teacher Assistant — home">
              <span className="brand-logo" aria-hidden="true">👨‍🏫</span>
              <span className="brand-text">
                <strong className="brand-title">शिक्षक सहायक</strong>
                <span className="brand-sub">Teacher Assistant</span>
              </span>
            </Link>
          )}
          {showMobileSidebarOpen && (
            <button
              type="button"
              className="icon-btn sidebar-toggle"
              onClick={onSidebarToggle}
              title="Open sidebar"
              aria-label="Open sidebar"
              aria-pressed={sidebarOpen}
            >
              <PanelLeft size={18} aria-hidden="true" />
            </button>
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
            {/* Classroom Management (docs/classroom-feature-plan.md) — NOT
                the unrelated "Classroom Mode" AI chat feature, which has no
                top-bar entry at all. Client-side cosmetic gate only (§14);
                the server's CLASSROOM_MANAGEMENT_ENABLED is the real kill
                switch. */}
            {CLASSROOM_MANAGEMENT_ENABLED && (
              <Link
                to="/classroom"
                className={`nav-link${location.pathname.startsWith('/classroom') ? ' active' : ''}`}
                aria-current={location.pathname.startsWith('/classroom') ? 'page' : undefined}
              >
                Classroom
              </Link>
            )}
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

          {NOTIFICATIONS_ENABLED && <NotificationBell />}
          {extraControl}
          {showProfileMenu && <ProfileMenu variant="topbar" />}
        </div>
      </div>
    </header>
  );
}
