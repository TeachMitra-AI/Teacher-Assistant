import { CalendarCheck, History, ScrollText, Settings, BarChart3, type LucideIcon } from 'lucide-react';

// The sections of the Attendance workspace, all under one page shell (docs/feature-teacher-attendance-implementation-plan.md),
// with no separate nav entry per section, like components/classroom/ClassroomTabs.tsx. There's no 'review' tab, since
// nothing auto-flags a day for approval. Reports is the Principal's main view (corrections happen from its drill-down);
// 'activity' is the who/what/when/where/result log, a secondary investigative tab.
export type AttendanceTabKey = 'checkin' | 'history' | 'reports' | 'activity' | 'settings';

interface TabDef {
  key: AttendanceTabKey;
  label: string;
  icon: LucideIcon;
}

const BASE_TABS: TabDef[] = [
  { key: 'checkin', label: 'Check In', icon: CalendarCheck },
  { key: 'history', label: 'History', icon: History },
];

// school_admin only; the server is the real gate (adminGate in routes/teacherAttendance.js), this only decides whether the tab renders.
const ADMIN_TABS: TabDef[] = [
  { key: 'reports', label: 'Reports', icon: BarChart3 },
  { key: 'activity', label: 'Activity Log', icon: ScrollText },
  { key: 'settings', label: 'Settings', icon: Settings },
];

export default function AttendanceTabs({
  active,
  onSelect,
  isAdmin = false,
}: {
  active: AttendanceTabKey;
  onSelect: (key: AttendanceTabKey) => void;
  isAdmin?: boolean;
}) {
  const tabs = isAdmin ? [...BASE_TABS, ...ADMIN_TABS] : BASE_TABS;
  return (
    <nav className="attendance-tabs" aria-label="Attendance sections">
      {tabs.map((tab) => {
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
