import { feeBadgeText, isOverpaid, FEE_STATUS_LABEL } from '../feeBadge';
import type { StudentFeeStatus } from '../../types';

function student(overrides: Partial<StudentFeeStatus> = {}): StudentFeeStatus {
  return { studentId: 's1', name: 'Asha', rollNumber: '1', status: 'pending', amount: 0, expectedAmount: 500, ...overrides };
}

describe('feeBadgeText', () => {
  it('shows "No fee amount set" when the class has no fee amount', () => {
    expect(feeBadgeText(student({ expectedAmount: null }))).toBe('No fee amount set');
  });

  it('shows what is owed when pending', () => {
    expect(feeBadgeText(student({ status: 'pending', amount: 0, expectedAmount: 500 }))).toBe('Owes ₹500');
  });

  it('shows paid amount and remaining owed when partial', () => {
    expect(feeBadgeText(student({ status: 'partial', amount: 200, expectedAmount: 500 }))).toBe('Paid ₹200 · Owes ₹300');
  });

  it('shows just the paid amount when paid exactly', () => {
    expect(feeBadgeText(student({ status: 'paid', amount: 500, expectedAmount: 500 }))).toBe('Paid ₹500');
  });

  it('shows the extra amount when overpaid', () => {
    expect(feeBadgeText(student({ status: 'paid', amount: 600, expectedAmount: 500 }))).toBe('Paid ₹600 · ₹100 extra');
  });
});

describe('isOverpaid', () => {
  it('is true when amount exceeds expectedAmount', () => {
    expect(isOverpaid(student({ amount: 600, expectedAmount: 500 }))).toBe(true);
  });

  it('is false when amount does not exceed expectedAmount', () => {
    expect(isOverpaid(student({ amount: 500, expectedAmount: 500 }))).toBe(false);
  });

  it('is false when no fee amount is set', () => {
    expect(isOverpaid(student({ amount: 600, expectedAmount: null }))).toBe(false);
  });
});

describe('FEE_STATUS_LABEL', () => {
  it('has a label for every fee status', () => {
    expect(FEE_STATUS_LABEL).toEqual({ paid: 'Paid', partial: 'Partial', pending: 'Pending' });
  });
});
