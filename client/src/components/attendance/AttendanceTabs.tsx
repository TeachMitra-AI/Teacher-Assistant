import { CalendarCheck, History, ScrollText, Settings, BarChart3, type LucideIcon } from 'lucide-react';

// The sections of the Attendance workspace, all living under ONE page shell
// (docs/feature-teacher-attendance-implementation-plan.md §4) — no separate
// bottom-nav or top-bar entry per section, mirroring
// components/classroom/ClassroomTabs.tsx's own reasoning exactly.
//
// No 'review' tab any more — there is no review queue (§1.7/§4: nothing
// auto-flags a day for approval, so there's nothing to queue). Reports is
// the Principal's main view; corrections happen on-demand from its
// drill-down. 'activity' is new — the who/what/when/where/result log
// (§1.10), a secondary/investigative tab, not the landing screen.
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

// school_admin only — the server is the real gate (adminGate in
// routes/teacherAttendance.js); this only decides whether the tab renders.
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
