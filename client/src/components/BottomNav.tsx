import { Link, useLocation } from 'react-router-dom';
import { Sparkles, Library as LibraryIcon, GraduationCap, ClipboardCheck, FileQuestion, type LucideIcon } from 'lucide-react';
import { CLASSROOM_MANAGEMENT_ENABLED, TEACHER_ATTENDANCE_ENABLED } from '../config';

// Mobile-only primary navigation. On desktop the top bar keeps the links; at <=640px those hide and these take over, so
// navigation isn't duplicated. Rendered once globally for authenticated users (App.tsx).
interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  isActive: (path: string) => boolean;
}

const BASE_ITEMS: NavItem[] = [
  { to: '/', label: 'Coach', icon: Sparkles, isActive: (p) => p === '/' },
  { to: '/library', label: 'Library', icon: LibraryIcon, isActive: (p) => p.startsWith('/library') },
  // Classroom Management (docs/classroom-feature-plan.md), not the "Classroom Mode" AI chat feature, which has no entry here.
  { to: '/classroom', label: 'Classroom', icon: GraduationCap, isActive: (p) => p.startsWith('/classroom') },
  // Teacher Attendance (docs/feature-teacher-attendance-implementation-plan.md): a teacher's own, not marking students (the item above).
  { to: '/attendance', label: 'Attendance', icon: ClipboardCheck, isActive: (p) => p.startsWith('/attendance') },
  { to: '/generator', label: 'Generator', icon: FileQuestion, isActive: (p) => p.startsWith('/generator') },
];

export default function BottomNav() {
  const { pathname } = useLocation();
  // Client-side cosmetic gate only; the server's CLASSROOM_MANAGEMENT_ENABLED/TEACHER_ATTENDANCE_ENABLED are the real kill
  // switches. When off, an item isn't rendered at all ("zero new UI" default).
  const items = BASE_ITEMS.filter((item) => {
    if (item.to === '/classroom') return CLASSROOM_MANAGEMENT_ENABLED;
    if (item.to === '/attendance') return TEACHER_ATTENDANCE_ENABLED;
    return true;
  });
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {items.map((item) => {
        const Icon = item.icon;
        const active = item.isActive(pathname);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={`bottom-nav-item${active ? ' active' : ''}`}
            aria-current={active ? 'page' : undefined}
            aria-label={item.label}
          >
            <Icon size={20} aria-hidden="true" />
            <span className="bottom-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
