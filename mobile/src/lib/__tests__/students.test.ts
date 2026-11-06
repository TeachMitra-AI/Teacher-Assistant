import { compareByRollNumber, sortByRollNumber } from '../students';

describe('sortByRollNumber', () => {
  it('orders numeric roll numbers numerically, not alphabetically (Roll 2 before Roll 10)', () => {
    const list = [
      { name: 'Zoya', rollNumber: '10' },
      { name: 'Asha', rollNumber: '2' },
      { name: 'Ben', rollNumber: '1' },
    ];
    expect(sortByRollNumber(list).map((s) => s.rollNumber)).toEqual(['1', '2', '10']);
  });

  it('puts students without a roll number after every numbered student', () => {
    const list = [
      { name: 'Ravi', rollNumber: null },
      { name: 'Asha', rollNumber: '2' },
      { name: 'Ben', rollNumber: '1' },
    ];
    expect(sortByRollNumber(list).map((s) => s.name)).toEqual(['Ben', 'Asha', 'Ravi']);
  });

  it('falls back to name when roll numbers tie or are all missing', () => {
    const list = [
      { name: 'Zoya', rollNumber: null },
      { name: 'Asha', rollNumber: null },
      { name: 'Ben', rollNumber: null },
    ];
    expect(sortByRollNumber(list).map((s) => s.name)).toEqual(['Asha', 'Ben', 'Zoya']);
  });

  it('does not mutate the original array', () => {
    const list = [{ name: 'Zoya', rollNumber: '2' }, { name: 'Asha', rollNumber: '1' }];
    const original = [...list];
    sortByRollNumber(list);
    expect(list).toEqual(original);
  });

  it('handles a mix of numeric and non-numeric roll numbers without throwing', () => {
    const list = [
      { name: 'Chetan', rollNumber: '3A' },
      { name: 'Asha', rollNumber: '2' },
      { name: 'Ben', rollNumber: '' },
    ];
    expect(sortByRollNumber(list).map((s) => s.name)).toEqual(['Asha', 'Chetan', 'Ben']);
  });

  it('sorts roll numbers with letters by their digits, in the same order as the server and web', () => {
    const list = [
      { name: 'None', rollNumber: null },
      { name: 'B1', rollNumber: 'B1' },
      { name: 'A10', rollNumber: 'A10' },
      { name: 'Ten', rollNumber: '10' },
      { name: 'A2', rollNumber: 'A2' },
      { name: 'Two', rollNumber: '2' },
    ];
    expect(sortByRollNumber(list).map((s) => s.name)).toEqual(['Two', 'Ten', 'A2', 'A10', 'B1', 'None']);
  });

  it('compares a leading number numerically too', () => {
    const list = [{ name: 'Ten', rollNumber: '10A' }, { name: 'Two', rollNumber: '2A' }];
    expect(sortByRollNumber(list).map((s) => s.name)).toEqual(['Two', 'Ten']);
  });

  it.each([
    ['letter case', 'a1', 'A1'],
    ['leading zeros', 'A01', 'A1'],
  ])('ties roll numbers differing only by %s, falling back to name', (_label, first, second) => {
    const list = [{ name: 'Zoya', rollNumber: first }, { name: 'Asha', rollNumber: second }];
    expect(sortByRollNumber(list).map((s) => s.name)).toEqual(['Asha', 'Zoya']);
  });

  it('never calls localeCompare with options, which Hermes may ignore', () => {
    const spy = jest.spyOn(String.prototype, 'localeCompare');
    sortByRollNumber([{ name: 'A10', rollNumber: 'A10' }, { name: 'A2', rollNumber: 'A2' }]);
    expect(spy.mock.calls.every((args) => args.length === 1)).toBe(true);
    spy.mockRestore();
  });
});

describe('compareByRollNumber', () => {
  it('is a stable-friendly comparator usable directly with Array.prototype.sort', () => {
    const a = { name: 'A', rollNumber: '5' };
    const b = { name: 'B', rollNumber: '5' };
    expect(compareByRollNumber(a, b)).toBeLessThan(0); // same roll number -> tie-break by name
  });
});
