// Builds the school-wide attendance report as a real Excel workbook — same
// approach as lib/feeReportExcel.js (one row per person, a bold TOTAL row),
// reusing that established convention rather than inventing a new one.
const ExcelJS = require('exceljs');

/**
 * @param {{
 *   month: string,
 *   schoolName: string,
 *   teachers: Array<{ name: string, email: string, summary: {
 *     present: number, absent: number, late: number, half_day: number,
 *     on_leave: number, on_duty: number, flagged_review: number, pending_regularization: number,
 *   } }>,
 * }} report
 * @returns {Promise<import('exceljs').Buffer>}
 */
async function buildAttendanceReportWorkbook(report) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Attendance ${report.month}`);

  sheet.columns = [
    { header: 'Teacher', key: 'name', width: 26 },
    { header: 'Email', key: 'email', width: 28 },
    { header: 'Present', key: 'present', width: 10 },
    { header: 'Absent', key: 'absent', width: 10 },
    { header: 'Late', key: 'late', width: 8 },
    { header: 'Half day', key: 'half_day', width: 10 },
    { header: 'On leave', key: 'on_leave', width: 10 },
    { header: 'On duty', key: 'on_duty', width: 10 },
    { header: 'Needs review', key: 'flagged_review', width: 13 },
    { header: 'Missing checkout', key: 'pending_regularization', width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };

  const totals = {
    present: 0,
    absent: 0,
    late: 0,
    half_day: 0,
    on_leave: 0,
    on_duty: 0,
    flagged_review: 0,
    pending_regularization: 0,
  };
  for (const t of report.teachers) {
    sheet.addRow({ name: t.name, email: t.email, ...t.summary });
    for (const key of Object.keys(totals)) totals[key] += t.summary[key];
  }

  const totalRow = sheet.addRow({ name: 'TOTAL', email: '', ...totals });
  totalRow.font = { bold: true };

  return workbook.xlsx.writeBuffer();
}

module.exports = { buildAttendanceReportWorkbook };
