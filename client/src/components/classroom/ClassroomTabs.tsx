import { GraduationCap, Users, ClipboardCheck, Wallet, FileBarChart, type LucideIcon } from 'lucide-react';

// The five sections of the Classroom workspace, all living under ONE page
// shell (docs/classroom-feature-plan.md §3/§4) — no separate bottom-nav or
// top-bar entries per section. Horizontally-scrollable on mobile, same
// pattern as AdminTabs.tsx (see index.css's .classroom-tabs).
export type ClassroomTabKey = 'classes' | 'students' | 'attendance' | 'fees' | 'reports';

interface TabDef {
  key: ClassroomTabKey;
  label: string;
  icon: LucideIcon;
}

const TABS: TabDef[] = [
  { key: 'classes', label: 'My Classes', icon: GraduationCap },
  { key: 'students', label: 'Students', icon: Users },
  { key: 'attendance', label: 'Attendance', icon: ClipboardCheck },
  { key: 'fees', label: 'Fees', icon: Wallet },
  { key: 'reports', label: 'Reports', icon: FileBarChart },
];

export default function ClassroomTabs({
  active,
  onSelect,
}: {
  active: ClassroomTabKey;
  onSelect: (key: ClassroomTabKey) => void;
}) {
  return (
    <nav className="classroom-tabs" aria-label="Classroom sections">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            className={isActive ? 'active' : ''}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(tab.key)}
          >
            <Icon size={15} aria-hidden="true" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
