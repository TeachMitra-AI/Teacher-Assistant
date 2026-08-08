import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';

// Sub-navigation shared between the admin overview and management pages.
//
// The "Support" tab is deliberately NOT shown to every admin role the way
// Overview/Manage are — a support ticket is product feedback, not a
// school's own data, so only super_admin gets it (see
// docs/help-support-architecture.md's access-control reasoning, carried
// forward unchanged into the Phase 2 admin inbox).
export default function AdminTabs() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';

  return (
    <div className="admin-tabs">
      <Link to="/admin" className={pathname === '/admin' ? 'active' : ''}>Overview</Link>
      <Link to="/admin/manage" className={pathname === '/admin/manage' ? 'active' : ''}>Manage</Link>
      {isSuperAdmin && (
        <Link to="/admin/support" className={pathname.startsWith('/admin/support') ? 'active' : ''}>Support</Link>
      )}
      {/* Feature Management is a global, app-wide switch, not a school's own
          data — same super_admin-only reasoning as Support above. */}
      {isSuperAdmin && (
        <Link to="/admin/settings" className={pathname.startsWith('/admin/settings') ? 'active' : ''}>Settings</Link>
      )}
    </div>
  );
}
