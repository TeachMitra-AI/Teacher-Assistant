import { attendancePercentage, toggleStatus, computeDirty, computeLiveSummary, buildSaveMarks } from '../attendance';
import type { AttendanceRosterEntry, AttendanceStatus } from '../../types';

const ROSTER: AttendanceRosterEntry[] = [
  { studentId: 's1', name: 'Asha', rollNumber: '1', status: 'present' },
  { studentId: 's2', name: 'Ben', rollNumber: '2', status: 'absent' },
  { studentId: 's3', name: 'Chetan', rollNumber: '3', status: 'unmarked' },
];

function statusMap(entries: [string, AttendanceStatus][]): Map<string, AttendanceStatus> {
  return new Map(entries);
}

describe('attendancePercentage', () => {
  it('rounds to one decimal place', () => {
    expect(attendancePercentage(2, 1)).toBe(66.7);
  });

  it('returns null when nothing is marked (never present/0 = 0%)', () => {
    expect(attendancePercentage(0, 0)).toBeNull();
  });

  it('returns 100 when everyone marked is present', () => {
    expect(attendancePercentage(5, 0)).toBe(100);
  });
});

describe('toggleStatus', () => {
  it('sets the tapped status when currently unmarked', () => {
    expect(toggleStatus('unmarked', 'present')).toBe('present');
    expect(toggleStatus('unmarked', 'absent')).toBe('absent');
  });

  it('clears back to unmarked when tapping the already-active state', () => {
    expect(toggleStatus('present', 'present')).toBe('unmarked');
    expect(toggleStatus('absent', 'absent')).toBe('unmarked');
  });

  it('switches directly from one state to the other', () => {
    expect(toggleStatus('present', 'absent')).toBe('absent');
    expect(toggleStatus('absent', 'present')).toBe('present');
  });
});

describe('computeDirty', () => {
  it('is false when the working map matches what was loaded from the server', () => {
    const statuses = statusMap([
      ['s1', 'present'],
      ['s2', 'absent'],
      ['s3', 'unmarked'],
    ]);
    expect(computeDirty(ROSTER, statuses)).toBe(false);
  });

  it('is true when any single row differs from the loaded roster', () => {
    const statuses = statusMap([
      ['s1', 'present'],
      ['s2', 'absent'],
      ['s3', 'present'], // was unmarked
    ]);
    expect(computeDirty(ROSTER, statuses)).toBe(true);
  });

  it('treats a student missing from the working map as unmarked', () => {
    const statuses = statusMap([
      ['s1', 'present'],
      ['s2', 'absent'],
    ]);
    expect(computeDirty(ROSTER, statuses)).toBe(false);
  });
});

describe('computeLiveSummary', () => {
  it('tallies present/absent/unmarked and the live percentage from the working map, not the loaded roster', () => {
    const statuses = statusMap([
      ['s1', 'present'],
      ['s2', 'present'], // flipped from absent, unsaved
      ['s3', 'unmarked'],
    ]);
    expect(computeLiveSummary(ROSTER, statuses)).toEqual({
      present: 2,
      absent: 0,
      unmarked: 1,
      percentage: 100,
    });
  });

  it('matches the server formula exactly for a mixed roster', () => {
    const statuses = statusMap([
      ['s1', 'present'],
      ['s2', 'absent'],
      ['s3', 'unmarked'],
    ]);
    expect(computeLiveSummary(ROSTER, statuses)).toEqual({
      present: 1,
      absent: 1,
      unmarked: 1,
      percentage: 50,
    });
  });
});

describe('buildSaveMarks', () => {
  it('builds one mark per roster row, defaulting missing entries to unmarked', () => {
    const statuses = statusMap([['s1', 'present']]);
    expect(buildSaveMarks(ROSTER, statuses)).toEqual([
      { studentId: 's1', status: 'present' },
      { studentId: 's2', status: 'unmarked' },
      { studentId: 's3', status: 'unmarked' },
    ]);
  });

  it('sends "unmarked" explicitly for a student toggled back off, matching the server delete-row contract', () => {
    const statuses = statusMap([
      ['s1', 'unmarked'], // was present, toggled back off
      ['s2', 'absent'],
      ['s3', 'unmarked'],
    ]);
    expect(buildSaveMarks(ROSTER, statuses)).toEqual([
      { studentId: 's1', status: 'unmarked' },
      { studentId: 's2', status: 'absent' },
      { studentId: 's3', status: 'unmarked' },
    ]);
  });
});
