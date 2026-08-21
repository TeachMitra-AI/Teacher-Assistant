import { buildInitialExamMeta, mergeExamMeta, parseExamMeta } from '../examMeta';
import type { User } from '../../types';

const baseUser: User = {
  id: 'u1',
  name: 'Demo Teacher',
  email: 'teacher@example.com',
  role: 'teacher',
  preferences: {},
  school: { id: 's1', name: 'Govt Primary School, Rampur', code: 'RAMPUR01' },
};

describe('buildInitialExamMeta', () => {
  it('prefills from the user/school identity when no site-wide defaults are set', () => {
    const meta = buildInitialExamMeta(baseUser, undefined);
    expect(meta).toEqual({
      schoolName: 'Govt Primary School, Rampur',
      teacherName: 'Demo Teacher',
      customInstructions: '',
      showDate: false,
      showTime: false,
    });
  });

  it('prefers displayName over name, and site-wide defaults over the identity fallback', () => {
    const user: User = { ...baseUser, displayName: 'Ms. Sharma' };
    const meta = buildInitialExamMeta(user, {
      schoolName: 'Custom School', showDate: true, showTime: true, defaultInstructions: 'No calculators.',
    });
    expect(meta.schoolName).toBe('Custom School');
    expect(meta.teacherName).toBe('Ms. Sharma');
    expect(meta.showDate).toBe(true);
    expect(meta.showTime).toBe(true);
    expect(meta.customInstructions).toBe('No calculators.');
  });
});

describe('parseExamMeta', () => {
  it('returns {} for null/undefined/empty input', () => {
    expect(parseExamMeta(null)).toEqual({});
    expect(parseExamMeta(undefined)).toEqual({});
    expect(parseExamMeta('')).toEqual({});
  });

  it('returns {} for malformed JSON rather than throwing', () => {
    expect(parseExamMeta('{not json')).toEqual({});
  });

  it('returns {} when the parsed JSON has no examMeta key', () => {
    expect(parseExamMeta(JSON.stringify({ format: 'quiz' }))).toEqual({});
  });

  it('reads back a previously stored examMeta', () => {
    const stored = JSON.stringify({ format: 'quiz', examMeta: { schoolName: 'X', maxMarks: '20' } });
    expect(parseExamMeta(stored)).toEqual({ schoolName: 'X', maxMarks: '20' });
  });
});

describe('mergeExamMeta', () => {
  it('produces a fresh structured JSON string when none existed before', () => {
    const result = mergeExamMeta(null, { schoolName: 'X' });
    expect(JSON.parse(result)).toEqual({ examMeta: { schoolName: 'X' } });
  });

  it('preserves other keys already stored (e.g. generator config) alongside the new examMeta', () => {
    const existing = JSON.stringify({ format: 'quiz', difficulty: 'easy' });
    const result = mergeExamMeta(existing, { schoolName: 'X' });
    expect(JSON.parse(result)).toEqual({ format: 'quiz', difficulty: 'easy', examMeta: { schoolName: 'X' } });
  });

  it('falls back to a fresh object when the existing structured value is malformed', () => {
    const result = mergeExamMeta('{not json', { schoolName: 'X' });
    expect(JSON.parse(result)).toEqual({ examMeta: { schoolName: 'X' } });
  });
});
