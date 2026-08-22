// Builds the fee report as a real Excel workbook (not CSV) specifically so
// the Status column can carry the same green/yellow/red coloring the Fees
// and Reports tabs show on screen — a plain CSV has no concept of color at
// all, so matching the UI required switching file formats
// (docs/fee-tracking-amounts-plan.md).
const ExcelJS = require('exceljs');

// Same hex values as client/src/index.css's .classroom-att-btn.{paid,partial,pending}
// light-theme rules, so the downloaded file visually matches the app.
const STATUS_STYLE = {
  paid: { fill: 'FFF0FDF4', font: 'FF15803D', label: 'Paid' },
  partial: { fill: 'FFFFFBEB', font: 'FFB45309', label: 'Partial' },
  pending: { fill: 'FFFEF2F2', font: 'FFB91C1C', label: 'Pending' },
};

/**
 * @param {{
 *   className: string,
 *   period: string,
 *   perStudent: Array<{name: string, rollNumber?: string|null, status: 'paid'|'partial'|'pending', amount: number, expectedAmount: number|null}>,
 *   paid: number, partial: number, pending: number,
 *   totalCollected: number, totalExpected: number,
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
  ];
  sheet.getRow(1).font = { bold: true };

  for (const s of report.perStudent) {
    const row = sheet.addRow({
      name: s.name,
      rollNumber: s.rollNumber || '',
      status: STATUS_STYLE[s.status].label,
      amount: s.amount,
      expected: s.expectedAmount ?? '',
    });
    const style = STATUS_STYLE[s.status];
    const statusCell = row.getCell('status');
    statusCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: style.fill } };
    statusCell.font = { color: { argb: style.font }, bold: true };
  }

  const totalRow = sheet.addRow({
    name: 'TOTAL',
    rollNumber: '',
    status: `Paid: ${report.paid} · Partial: ${report.partial} · Pending: ${report.pending}`,
    amount: report.totalCollected,
    expected: report.totalExpected,
  });
  totalRow.font = { bold: true };

  return workbook.xlsx.writeBuffer();
}

module.exports = { buildFeeReportWorkbook };
