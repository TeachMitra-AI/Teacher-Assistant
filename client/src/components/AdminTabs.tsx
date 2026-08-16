import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { NOTIFICATIONS_ENABLED } from '../config';

// Sub-navigation shared between the admin overview and management pages.
//
// The "Support" tab is deliberately NOT shown to every admin role the way
// Overview/Manage are — a support ticket is product feedback, not a
// school's own data, so only super_admin gets it (see
// docs/help-support-architecture.md's access-control reasoning, carried
// forward unchanged into the Phase 2 admin inbox).
//
// On mobile this list no longer fits one line (and will only grow — PYQ,
// Reports, Users are coming). Rather than wrap or hide tabs, `.admin-tabs`
// becomes its own horizontally-scrollable strip below the 640px breakpoint
// (see index.css); this component only needs to keep the active tab
// scrolled into view when it isn't already visible, e.g. landing directly
// on a tab near the end of the strip.
export default function AdminTabs() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('a.active');
    // 'nearest' is a no-op when the tab is already fully in view, so this
    // never produces a scroll animation on a render where nothing changed.
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname]);

  return (
    <nav className="admin-tabs" aria-label="Admin sections" ref={navRef}>
      <Link to="/admin" className={pathname === '/admin' ? 'active' : ''} aria-current={pathname === '/admin' ? 'page' : undefined}>Overview</Link>
      <Link to="/admin/manage" className={pathname === '/admin/manage' ? 'active' : ''} aria-current={pathname === '/admin/manage' ? 'page' : undefined}>Manage</Link>
      {isSuperAdmin && (
        <Link to="/admin/support" className={pathname.startsWith('/admin/support') ? 'active' : ''} aria-current={pathname.startsWith('/admin/support') ? 'page' : undefined}>Support</Link>
      )}
      {/* Notification System send/broadcast — shown to every admin role
          (unlike Support/Settings above), each scoped to what they can
          reach (see docs/notification-system-plan.md §2). */}
      {NOTIFICATIONS_ENABLED && (
        <Link to="/admin/notifications" className={pathname.startsWith('/admin/notifications') ? 'active' : ''} aria-current={pathname.startsWith('/admin/notifications') ? 'page' : undefined}>Notifications</Link>
      )}
      {/* Feature Management is a global, app-wide switch, not a school's own
          data — same super_admin-only reasoning as Support above. */}
      {isSuperAdmin && (
        <Link to="/admin/settings" className={pathname.startsWith('/admin/settings') ? 'active' : ''} aria-current={pathname.startsWith('/admin/settings') ? 'page' : undefined}>Settings</Link>
      )}
    </nav>
  );
}
