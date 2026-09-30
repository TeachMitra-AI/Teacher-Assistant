import { useState } from 'react';
import AttendanceDaily from './AttendanceDaily';
import AttendanceMonthly from './AttendanceMonthly';

type AttendanceView = 'mark' | 'monthly';

// Entry point for the Attendance tab once a class is selected (docs/classroom-feature-plan.md). A small segmented control,
// not another ClassroomTabs entry: "Mark Attendance" and "Monthly Summary" are both scoped to the same class, unlike the
// five outer tabs which switch the kind of data.
export default function AttendancePanel({ classId, className }: { classId: string; className: string }) {
  const [view, setView] = useState<AttendanceView>('mark');

  return (
    <div>
      <div className="classroom-subtabs" role="tablist" aria-label="Attendance view">
        <button type="button" role="tab" aria-selected={view === 'mark'} className={view === 'mark' ? 'active' : ''} onClick={() => setView('mark')}>
          Mark Attendance
        </button>
        <button type="button" role="tab" aria-selected={view === 'monthly'} className={view === 'monthly' ? 'active' : ''} onClick={() => setView('monthly')}>
          Monthly Summary
        </button>
      </div>

      {view === 'mark'
        ? <AttendanceDaily classId={classId} className={className} />
        : <AttendanceMonthly classId={classId} className={className} />}
    </div>
  );
}
