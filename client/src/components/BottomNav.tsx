import { Link, useLocation } from 'react-router-dom';
import { Sparkles, Library as LibraryIcon, FileQuestion, type LucideIcon } from 'lucide-react';

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

const ITEMS: NavItem[] = [
  { to: '/', label: 'Coach', icon: Sparkles, isActive: (p) => p === '/' },
  { to: '/library', label: 'Library', icon: LibraryIcon, isActive: (p) => p.startsWith('/library') },
  { to: '/generator', label: 'Generator', icon: FileQuestion, isActive: (p) => p.startsWith('/generator') },
];

export default function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {ITEMS.map((item) => {
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
