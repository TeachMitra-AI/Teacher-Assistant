import { Link, useLocation } from 'react-router-dom';

// Sub-navigation shared between the admin overview and management pages.
export default function AdminTabs() {
  const { pathname } = useLocation();
  return (
    <div className="admin-tabs">
      <Link to="/admin" className={pathname === '/admin' ? 'active' : ''}>Overview</Link>
      <Link to="/admin/manage" className={pathname === '/admin/manage' ? 'active' : ''}>Manage</Link>
    </div>
  );
}
