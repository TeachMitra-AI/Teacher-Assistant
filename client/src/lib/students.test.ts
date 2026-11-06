import { describe, expect, test } from 'vitest';
import { sortByRollNumber } from './students';

const names = (list: { name: string }[]) => list.map((s) => s.name);

describe('sortByRollNumber', () => {
  test('compares roll numbers as numbers, not text', () => {
    const list = [{ name: 'Ten', rollNumber: '10' }, { name: 'Two', rollNumber: '2' }, { name: 'One', rollNumber: '01' }];
    expect(names(sortByRollNumber(list))).toEqual(['One', 'Two', 'Ten']);
  });

  test('puts other roll numbers after numeric ones, and missing ones last', () => {
    const list = [
      { name: 'None', rollNumber: null },
      { name: 'Blank', rollNumber: '  ' },
      { name: 'Letter', rollNumber: 'A1' },
      { name: 'Five', rollNumber: '5' },
    ];
    expect(names(sortByRollNumber(list))).toEqual(['Five', 'Letter', 'Blank', 'None']);
  });

  test('breaks ties on name, and leaves the input array alone', () => {
    const list = [{ name: 'Zoya', rollNumber: '1' }, { name: 'Asha', rollNumber: '1' }];
    expect(names(sortByRollNumber(list))).toEqual(['Asha', 'Zoya']);
    expect(names(list)).toEqual(['Zoya', 'Asha']);
  });

  test('sorts roll numbers with letters by their digits, in the same order as the server and mobile', () => {
    const list = [
      { name: 'None', rollNumber: null },
      { name: 'B1', rollNumber: 'B1' },
      { name: 'A10', rollNumber: 'A10' },
      { name: 'Ten', rollNumber: '10' },
      { name: 'A2', rollNumber: 'A2' },
      { name: 'Two', rollNumber: '2' },
    ];
    expect(names(sortByRollNumber(list))).toEqual(['Two', 'Ten', 'A2', 'A10', 'B1', 'None']);
  });

  test('compares a leading number numerically too', () => {
    const list = [{ name: 'Ten', rollNumber: '10A' }, { name: 'Two', rollNumber: '2A' }];
    expect(names(sortByRollNumber(list))).toEqual(['Two', 'Ten']);
  });

  test.each([
    ['letter case', 'a1', 'A1'],
    ['leading zeros', 'A01', 'A1'],
  ])('roll numbers differing only by %s tie, and fall back to name', (_label, first, second) => {
    const list = [{ name: 'Zoya', rollNumber: first }, { name: 'Asha', rollNumber: second }];
    expect(names(sortByRollNumber(list))).toEqual(['Asha', 'Zoya']);
  });
});
