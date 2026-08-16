// Classroom Management — fee/payment status (docs/classroom-feature-plan.md §11).
//
// V1 is deliberately Paid/Pending only — no amount/paidAt/note anywhere in
// this module, matching the columns' "reserved but unused" status on
// FeeRecord (schema.prisma). A student with no FeeRecord row for a period
// reads as "pending" without a DB row existing yet, same "derive the default,
// don't backfill" convention as Query.title falling back to queryText.
//
// Shared by GET .../fees and GET .../fees/export (§13) so their numbers can
// never drift apart.

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{classId: string, teacherId: string, period: string}} params
 */
async function getClassFeeStatus(prisma, { classId, teacherId, period }) {
  const [students, records] = await Promise.all([
    prisma.student.findMany({ where: { classId, teacherId, active: true }, orderBy: { name: 'asc' } }),
    prisma.feeRecord.findMany({ where: { classId, teacherId, period } }),
  ]);

  const byStudent = new Map(records.map((r) => [r.studentId, r.status]));
  const perStudent = students.map((s) => ({
    studentId: s.id,
    name: s.name,
    rollNumber: s.rollNumber,
    status: byStudent.get(s.id) || 'pending',
  }));

  const paid = perStudent.filter((s) => s.status === 'paid').length;
  return { period, totalStudents: perStudent.length, paid, pending: perStudent.length - paid, perStudent };
}

/** Teacher-wide (all classes) paid/pending counts for one period (Analytics). */
async function getTeacherFeeCounts(prisma, { teacherId, period }) {
  const [totalStudents, records] = await Promise.all([
    prisma.student.count({ where: { teacherId, active: true } }),
    prisma.feeRecord.findMany({ where: { teacherId, period }, select: { status: true, studentId: true } }),
  ]);
  const paidStudentIds = new Set(records.filter((r) => r.status === 'paid').map((r) => r.studentId));
  return { period, totalStudents, paid: paidStudentIds.size, pending: totalStudents - paidStudentIds.size };
}

module.exports = { getClassFeeStatus, getTeacherFeeCounts };
