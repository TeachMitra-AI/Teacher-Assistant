import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PanelLeft, Sun, Moon } from 'lucide-react';
import { useAuth } from '../auth';
import { usePreferences } from '../hooks/usePreferences';
import { ADMIN_ROLES, NOTIFICATIONS_ENABLED, CLASSROOM_MANAGEMENT_ENABLED, TEACHER_ATTENDANCE_ENABLED } from '../config';
import ProfileMenu from './ProfileMenu';
import NotificationBell from './Notifications';

interface TopBarProps {
  preferences: ReturnType<typeof usePreferences>;
  // Coach page only. Branding, search and collapse live in Sidebar's header; this stays for one case: opening the mobile
  // drawer, which is off-canvas while closed and can't hold its own reopen button.
  onSidebarToggle?: () => void;
  sidebarOpen?: boolean;
  // Whether the viewport is at the mobile breakpoint; with sidebarOpen it decides if the "open drawer" button belongs here
  // (a closed drawer only; an open drawer and the desktop rail have their own controls, see Sidebar.tsx).
  isMobile?: boolean;
  // False only on the Coach page, where the account menu lives at the bottom of the Sidebar; true (the default) elsewhere.
  showProfileMenu?: boolean;
  // A page-specific control where the bar has room, e.g. the Coach page's teaching-context icon (in the slot the profile chip used to occupy there).
  extraControl?: ReactNode;
}

export default function TopBar({
  preferences, onSidebarToggle, sidebarOpen, isMobile, showProfileMenu = true, extraControl,
}: TopBarProps) {
  const { user } = useAuth();
  const location = useLocation();
  const { theme, toggleTheme } = preferences;
  const isAdmin = user && ADMIN_ROLES.includes(user.role);
  // Only the Coach page's mobile-closed state needs a control here; other cases have it inside the Sidebar.
  const showMobileSidebarOpen = Boolean(onSidebarToggle) && isMobile && !sidebarOpen;

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="topbar-left">
          {/* Hidden on the Coach page (onSidebarToggle set), where branding lives in Sidebar's header. */}
          {!onSidebarToggle && (
            <Link to="/" className="brand" aria-label="SarasTech — home">
              <img src="/logo.png" alt="" className="brand-logo" aria-hidden="true" />
              <span className="brand-text">
                <strong className="brand-title">SarasTech</strong>
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
            {/* Classroom Management (docs/classroom-feature-plan.md), not the "Classroom Mode" AI chat feature. Client-side
                cosmetic gate only; the server's CLASSROOM_MANAGEMENT_ENABLED is the real kill switch. */}
            {CLASSROOM_MANAGEMENT_ENABLED && (
              <Link
                to="/classroom"
                className={`nav-link${location.pathname.startsWith('/classroom') ? ' active' : ''}`}
                aria-current={location.pathname.startsWith('/classroom') ? 'page' : undefined}
              >
                Classroom
              </Link>
            )}
            {/* Teacher Attendance (docs/feature-teacher-attendance-implementation-plan.md): a teacher's own attendance, not
                marking students (the Classroom Management link above). Client-side cosmetic gate only; the server's
                TEACHER_ATTENDANCE_ENABLED is the real kill switch. */}
            {TEACHER_ATTENDANCE_ENABLED && (
              <Link
                to="/attendance"
                className={`nav-link${location.pathname.startsWith('/attendance') ? ' active' : ''}`}
                aria-current={location.pathname.startsWith('/attendance') ? 'page' : undefined}
              >
                Attendance
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
