// Light coverage of the request-shaping logic in classroomApi.ts (query
// strings, method/body composition) — the wrapper functions themselves are
// otherwise a direct, mechanical port of the already-tested web client.
import { listClasses, getDailyAttendance, saveAttendance, setFeeStatus, getClassAnalytics } from '../classroomApi';

jest.mock('../client', () => ({ api: jest.fn() }));
const { api } = jest.requireMock('../client') as { api: jest.Mock };

describe('classroomApi', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('listClasses omits the query string by default', async () => {
    api.mockResolvedValueOnce({ classes: [] });
    await listClasses();
    expect(api).toHaveBeenCalledWith('/classroom/classes');
  });

  it('listClasses(true) includes archived classes', async () => {
    api.mockResolvedValueOnce({ classes: [] });
    await listClasses(true);
    expect(api).toHaveBeenCalledWith('/classroom/classes?includeArchived=true');
  });

  it('getDailyAttendance builds the date query param', async () => {
    api.mockResolvedValueOnce({ date: '2026-08-20', roster: [], summary: {} });
    await getDailyAttendance('class-1', '2026-08-20');
    expect(api).toHaveBeenCalledWith('/classroom/classes/class-1/attendance?date=2026-08-20');
  });

  it('saveAttendance POSTs the full marks batch in one call', async () => {
    api.mockResolvedValueOnce({ date: '2026-08-20', saved: 2 });
    const marks = [
      { studentId: 's1', status: 'present' as const },
      { studentId: 's2', status: 'absent' as const },
    ];
    await saveAttendance('class-1', '2026-08-20', marks);
    expect(api).toHaveBeenCalledWith('/classroom/classes/class-1/attendance', {
      method: 'POST',
      body: { date: '2026-08-20', marks },
    });
  });

  it('getClassAnalytics requests the per-class analytics endpoint', async () => {
    api.mockResolvedValueOnce({ classId: 'class-1', totalStudents: 25, month: {}, fees: {} });
    await getClassAnalytics('class-1');
    expect(api).toHaveBeenCalledWith('/classroom/analytics/classes/class-1');
  });

  it('setFeeStatus PATCHes exactly one status change', async () => {
    api.mockResolvedValueOnce({ fee: { id: 'f1', studentId: 's1', classId: 'c1', period: '2026-08', status: 'paid', updatedAt: '' } });
    await setFeeStatus('s1', '2026-08', 'paid');
    expect(api).toHaveBeenCalledWith('/classroom/students/s1/fees/2026-08', {
      method: 'PATCH',
      body: { status: 'paid' },
    });
  });
});
