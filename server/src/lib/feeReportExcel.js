// Builds the fee report as a real Excel workbook (not CSV) specifically so
// the Status column can carry the same green/yellow/red coloring the Fees
// and Reports tabs show on screen — a plain CSV has no concept of color at
// all, so matching the UI required switching file formats
// (docs/fee-tracking-amounts-plan.md).
const ExcelJS = require('exceljs');

// Same hex values as client/src/index.css's .classroom-att-btn.{paid,partial,pending}
// light-theme rules, so the downloaded file visually matches the app. 'overpaid'
// matches the blue used for the Reports tab's Overpaid tile (#1d4ed8) — a
// subset of 'paid' (amount > expectedAmount), same convention as the client.
const STATUS_STYLE = {
  paid: { fill: 'FFF0FDF4', font: 'FF15803D', label: 'Paid' },
  partial: { fill: 'FFFFFBEB', font: 'FFB45309', label: 'Partial' },
  pending: { fill: 'FFFEF2F2', font: 'FFB91C1C', label: 'Pending' },
  overpaid: { fill: 'FFEFF6FF', font: 'FF1D4ED8', label: 'Overpaid' },
};

function isOverpaid(s) {
  return s.expectedAmount != null && s.amount > s.expectedAmount;
}

/**
 * @param {{
 *   className: string,
 *   period: string,
 *   perStudent: Array<{name: string, rollNumber?: string|null, status: 'paid'|'partial'|'pending', amount: number, expectedAmount: number|null}>,
 *   paid: number, partial: number, pending: number,
 *   totalCollected: number, totalExpected: number, totalPending: number,
 * }} report
 * @returns {Promise<import('exceljs').Buffer>}
 */
async function buildFeeReportWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Fees ${report.period}`);

  sheet.columns = [
    { header: 'Student Name', key: 'name', width: 24 },
    { header: 'Roll Number', key: 'rollNumber', width: 14 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Amount Paid', key: 'amount', width: 14 },
    { header: 'Amount Expected', key: 'expected', width: 16 },
    { header: 'Extra Paid', key: 'extra', width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };

  let overpaidCount = 0;
  let totalExtra = 0;
  for (const s of report.perStudent) {
    const overpaid = isOverpaid(s);
    const extra = overpaid ? s.amount - s.expectedAmount : 0;
    if (overpaid) {
      overpaidCount += 1;
      totalExtra += extra;
    }
    const style = overpaid ? STATUS_STYLE.overpaid : STATUS_STYLE[s.status];
    const row = sheet.addRow({
      name: s.name,
      rollNumber: s.rollNumber || '',
      status: style.label,
      amount: s.amount,
      expected: s.expectedAmount ?? '',
      extra: overpaid ? extra : '',
    });
    const statusCell = row.getCell('status');
    statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
    statusCell.font = { color: { argb: style.font }, bold: true };
  }

  const totalRow = sheet.addRow({
    name: 'TOTAL',
    rollNumber: '',
    status: `Paid: ${report.paid} · Partial: ${report.partial} · Pending: ${report.pending} · Overpaid: ${overpaidCount} (₹${report.totalPending} still owed)`,
    amount: report.totalCollected,
    expected: report.totalExpected,
    extra: totalExtra,
  });
  totalRow.font = { bold: true };

  return workbook.xlsx.writeBuffer();
}

module.exports = { buildFeeReportWorkbook };
