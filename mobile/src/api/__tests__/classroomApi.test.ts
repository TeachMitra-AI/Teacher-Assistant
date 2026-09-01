// Light coverage of the request-shaping logic in classroomApi.ts (query
// strings, method/body composition) — the wrapper functions themselves are
// otherwise a direct, mechanical port of the already-tested web client.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { listClasses, getDailyAttendance, saveAttendance, setFeeAmount, getClassAnalytics, downloadFeesReport } from '../classroomApi';
import { SharingUnavailableError } from '../../lib/exportPdf';

jest.mock('../client', () => ({ api: jest.fn(), ApiError: jest.requireActual('../client').ApiError }));
const { api } = jest.requireMock('../client') as { api: jest.Mock };

jest.mock('../session', () => ({ getToken: jest.fn().mockResolvedValue('mock-token') }));
const { getToken } = jest.requireMock('../session') as { getToken: jest.Mock };

describe('classroomApi', () => {
  beforeEach(() => {
    api.mockReset();
    getToken.mockClear().mockResolvedValue('mock-token');
    (FileSystem.downloadAsync as jest.Mock).mockClear().mockResolvedValue({ uri: 'file:///mock-cache/fees.xlsx', status: 200 });
    (Sharing.isAvailableAsync as jest.Mock).mockClear().mockResolvedValue(true);
    (Sharing.shareAsync as jest.Mock).mockClear().mockResolvedValue(undefined);
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

  it('downloadFeesReport downloads the export with an auth header, then shares it', async () => {
    await downloadFeesReport('class-1', '2026-08');
    expect(FileSystem.downloadAsync).toHaveBeenCalledWith(
      expect.stringContaining('/classroom/classes/class-1/fees/export?period=2026-08'),
      expect.stringContaining('fees-2026-08.xlsx'),
      { headers: { Authorization: 'Bearer mock-token' } }
    );
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      'file:///mock-cache/fees.xlsx',
      { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dialogTitle: 'Fees report — 2026-08' }
    );
  });

  it('downloadFeesReport throws on a non-200 response instead of sharing', async () => {
    (FileSystem.downloadAsync as jest.Mock).mockResolvedValueOnce({ uri: 'file:///mock-cache/fees.xlsx', status: 404 });
    await expect(downloadFeesReport('class-1', '2026-08')).rejects.toThrow('Could not download the fee report.');
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('downloadFeesReport throws SharingUnavailableError when the device cannot share', async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValueOnce(false);
    await expect(downloadFeesReport('class-1', '2026-08')).rejects.toBeInstanceOf(SharingUnavailableError);
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('setFeeAmount PATCHes exactly one amount change', async () => {
    api.mockResolvedValueOnce({
      fee: { id: 'f1', studentId: 's1', classId: 'c1', period: '2026-08', status: 'paid', amount: 500, expectedAmount: 500, updatedAt: '' },
    });
    await setFeeAmount('s1', '2026-08', 500);
    expect(api).toHaveBeenCalledWith('/classroom/students/s1/fees/2026-08', {
      method: 'PATCH',
      body: { amount: 500 },
    });
  });
});
