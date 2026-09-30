import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { NOTIFICATIONS_ENABLED } from '../config';

// Sub-navigation shared by the admin overview and management pages. The "Support" tab isn't shown to every admin role: a
// ticket is product feedback, not a school's data, so only super_admin gets it (docs/help-support-architecture.md).
// On mobile the list no longer fits one line, so `.admin-tabs` becomes a horizontally scrollable strip below 640px
// (index.css); this component only keeps the active tab scrolled into view.
export default function AdminTabs() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const active = navRef.current?.querySelector<HTMLElement>('a.active');
    // 'nearest' is a no-op when the tab is fully in view, so an unchanged render doesn't animate.
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname]);

  return (
    <nav className="admin-tabs" aria-label="Admin sections" ref={navRef}>
      <Link to="/admin" className={pathname === '/admin' ? 'active' : ''} aria-current={pathname === '/admin' ? 'page' : undefined}>Overview</Link>
      <Link to="/admin/manage" className={pathname === '/admin/manage' ? 'active' : ''} aria-current={pathname === '/admin/manage' ? 'page' : undefined}>Manage</Link>
      {isSuperAdmin && (
        <Link to="/admin/support" className={pathname.startsWith('/admin/support') ? 'active' : ''} aria-current={pathname.startsWith('/admin/support') ? 'page' : undefined}>Support</Link>
      )}
      {/* Schedule a Call bookings are leads, not a school's data; super_admin only, like Support. */}
      {isSuperAdmin && (
        <Link to="/admin/demo-bookings" className={pathname.startsWith('/admin/demo-bookings') ? 'active' : ''} aria-current={pathname.startsWith('/admin/demo-bookings') ? 'page' : undefined}>Bookings</Link>
      )}
      {/* Notification send/broadcast is shown to every admin role, each scoped to what they can reach (docs/notification-system-plan.md). */}
      {NOTIFICATIONS_ENABLED && (
        <Link to="/admin/notifications" className={pathname.startsWith('/admin/notifications') ? 'active' : ''} aria-current={pathname.startsWith('/admin/notifications') ? 'page' : undefined}>Notifications</Link>
      )}
      {/* Feature Management is a global app-wide switch, not a school's data; super_admin only, like Support. */}
      {isSuperAdmin && (
        <Link to="/admin/settings" className={pathname.startsWith('/admin/settings') ? 'active' : ''} aria-current={pathname.startsWith('/admin/settings') ? 'page' : undefined}>Settings</Link>
      )}
    </nav>
  );
}
