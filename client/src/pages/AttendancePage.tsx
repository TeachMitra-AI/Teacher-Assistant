import { useSearchParams } from 'react-router-dom';
import TopBar from '../components/TopBar';
import AttendanceTabs, { type AttendanceTabKey } from '../components/attendance/AttendanceTabs';
import CheckInTab from '../components/attendance/CheckInTab';
import HistoryTab from '../components/attendance/HistoryTab';
import ReportsTab from '../components/attendance/ReportsTab';
import ActivityLogTab from '../components/attendance/ActivityLogTab';
import SettingsTab from '../components/attendance/SettingsTab';
import { useAuth } from '../auth';
import { usePreferences } from '../hooks/usePreferences';

const TAB_KEYS: AttendanceTabKey[] = ['checkin', 'history', 'reports', 'activity', 'settings'];
const ADMIN_ONLY_TABS: AttendanceTabKey[] = ['reports', 'activity', 'settings'];

function isTabKey(value: string | null): value is AttendanceTabKey {
  return value !== null && (TAB_KEYS as string[]).includes(value);
}

export default function AttendancePage({ preferences }: { preferences: ReturnType<typeof usePreferences> }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'school_admin';
  const [searchParams, setSearchParams] = useSearchParams();

  const requestedTab = isTabKey(searchParams.get('tab')) ? (searchParams.get('tab') as AttendanceTabKey) : 'checkin';
  // A non-admin on an admin-only tab (stale link, typed URL) falls back to Check In instead of a tab they can't act on. The
  // server enforces this too (adminGate), but the fallback is one comparison away.
  const tab: AttendanceTabKey = ADMIN_ONLY_TABS.includes(requestedTab) && !isAdmin ? 'checkin' : requestedTab;

  function setTab(next: AttendanceTabKey) {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('tab', next);
      return params;
    });
  }

  const todayLabel = new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="page">
      <TopBar preferences={preferences} />

      {/* Reports is a wide table (name + 8 numeric columns); the 640px reading-width column the other tabs use squeezed it,
          blowing out the name/email column and pushing the numeric columns off screen. */}
      <main className={`attendance-main${tab === 'reports' ? ' attendance-main-wide' : ''}`}>
        <header className="library-header">
          <h1 className="library-title">Attendance</h1>
          <p className="library-subtitle">{todayLabel}</p>
        </header>

        <AttendanceTabs active={tab} onSelect={setTab} isAdmin={isAdmin} />

        {tab === 'checkin' && <CheckInTab />}
        {tab === 'history' && <HistoryTab />}
        {tab === 'reports' && isAdmin && <ReportsTab />}
        {tab === 'activity' && isAdmin && <ActivityLogTab />}
        {tab === 'settings' && isAdmin && <SettingsTab />}
      </main>
    </div>
  );
}
