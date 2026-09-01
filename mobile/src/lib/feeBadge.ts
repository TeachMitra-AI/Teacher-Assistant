// Ported verbatim from client/src/components/classroom/ReportsPanel.tsx's
// feeBadgeText/isOverpaid/STATUS_LABEL — the same fee-status badge text a
// teacher sees on the web Reports tab, kept identical so a screenshot from
// either platform reads the same.
import type { FeeStatus, StudentFeeStatus } from '../types';

export const FEE_STATUS_LABEL: Record<FeeStatus, string> = { paid: 'Paid', partial: 'Partial', pending: 'Pending' };

export function isOverpaid(s: StudentFeeStatus): boolean {
  return s.expectedAmount != null && s.amount > s.expectedAmount;
}

export function feeBadgeText(s: StudentFeeStatus): string {
  if (s.expectedAmount == null) return 'No fee amount set';
  const owed = s.expectedAmount - s.amount;
  switch (s.status) {
    case 'paid': {
      const extra = s.amount - s.expectedAmount;
      return extra > 0 ? `Paid ₹${s.amount} · ₹${extra} extra` : `Paid ₹${s.amount}`;
    }
    case 'partial':
      return `Paid ₹${s.amount} · Owes ₹${owed}`;
    default:
      return `Owes ₹${owed}`;
  }
}
