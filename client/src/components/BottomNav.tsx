import { Link, useLocation } from 'react-router-dom';
import { Sparkles, Library as LibraryIcon, GraduationCap, ClipboardCheck, FileQuestion, type LucideIcon } from 'lucide-react';
import { CLASSROOM_MANAGEMENT_ENABLED, TEACHER_ATTENDANCE_ENABLED } from '../config';

// Mobile-only primary navigation. On desktop this is hidden (the top bar keeps
// the nav links); at <=640px the top-bar links are hidden and these take over,
// so navigation is never duplicated. Rendered once, globally, for authenticated
// users (see App.tsx) so it appears on every page.
interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  isActive: (path: string) => boolean;
}

const BASE_ITEMS: NavItem[] = [
  { to: '/', label: 'Coach', icon: Sparkles, isActive: (p) => p === '/' },
  { to: '/library', label: 'Library', icon: LibraryIcon, isActive: (p) => p.startsWith('/library') },
  // Classroom Management (docs/classroom-feature-plan.md) — NOT the unrelated
  // "Classroom Mode" AI chat feature, which has no bottom-nav entry at all.
  { to: '/classroom', label: 'Classroom', icon: GraduationCap, isActive: (p) => p.startsWith('/classroom') },
  // Teacher Attendance (docs/feature-teacher-attendance-implementation-plan.md)
  // — NOT the Classroom Management item above, which is a teacher marking
  // their STUDENTS attendance; this is a teacher's own.
  { to: '/attendance', label: 'Attendance', icon: ClipboardCheck, isActive: (p) => p.startsWith('/attendance') },
  { to: '/generator', label: 'Generator', icon: FileQuestion, isActive: (p) => p.startsWith('/generator') },
];

export default function BottomNav() {
  const { pathname } = useLocation();
  // Client-side cosmetic gate only (§14 of the plan) — the server's
  // CLASSROOM_MANAGEMENT_ENABLED/TEACHER_ATTENDANCE_ENABLED are the real
  // kill switches. When off, an item is never rendered at all, same "zero
  // new UI" default as every other flagged feature in this app.
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
