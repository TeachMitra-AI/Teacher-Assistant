// Classroom Management fee/payment status (docs/classroom-feature-plan.md, docs/fee-tracking-amounts-plan.md).
// Status is derived from amount vs expectedAmount, never stored: a student with no FeeRecord for a period reads
// as "pending". Shared by GET .../fees and GET .../fees/export so their numbers match.

/**
 * paid: amount >= expectedAmount. partial: something paid, not enough. pending: nothing paid.
 * A null `expectedAmount` (no class feeAmount when the record was touched) falls back to paid (amount > 0) / pending.
 * @param {number} amount
 * @param {number | null} expectedAmount
 */
function deriveFeeStatus(amount, expectedAmount) {
  const paidSoFar = amount || 0;
  if (expectedAmount == null) return paidSoFar > 0 ? 'paid' : 'pending';
  if (paidSoFar <= 0) return 'pending';
  if (paidSoFar >= expectedAmount) return 'paid';
  return 'partial';
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{classId: string, teacherId: string, period: string}} params
 */
async function getClassFeeStatus(prisma, { classId, teacherId, period }) {
  const [cls, students, records] = await Promise.all([
    prisma.schoolClass.findUnique({ where: { id: classId }, select: { feeAmount: true } }),
    prisma.student.findMany({ where: { classId, teacherId, active: true }, orderBy: { name: 'asc' } }),
    prisma.feeRecord.findMany({ where: { classId, teacherId, period } }),
  ]);

  const classFeeAmount = cls?.feeAmount ?? null;
  const byStudent = new Map(records.map((r) => [r.studentId, r]));
  const perStudent = students.map((s) => {
    const record = byStudent.get(s.id);
    const amount = record?.amount || 0;
    // A student with no record yet has no snapshot — fall back to the
    // class's current fee amount (matches "derive the default" above).
    const expectedAmount = record ? record.expectedAmount : classFeeAmount;
    return {
      studentId: s.id,
      name: s.name,
      rollNumber: s.rollNumber,
      status: deriveFeeStatus(amount, expectedAmount),
      amount,
      expectedAmount,
    };
  });

  const paid = perStudent.filter((s) => s.status === 'paid').length;
  const partial = perStudent.filter((s) => s.status === 'partial').length;
  const pending = perStudent.length - paid - partial;
  const totalCollected = perStudent.reduce((sum, s) => sum + s.amount, 0);
  const totalExpected = perStudent.reduce((sum, s) => sum + (s.expectedAmount || 0), 0);
  // Summed per student, not (totalExpected - totalCollected), so one student's overpayment can't hide another's unpaid balance.
  const totalPending = perStudent.reduce((sum, s) => sum + Math.max((s.expectedAmount || 0) - s.amount, 0), 0);

  return {
    period,
    totalStudents: perStudent.length,
    paid,
    partial,
    pending,
    feeAmount: classFeeAmount,
    totalCollected,
    totalExpected,
    totalPending,
    perStudent,
  };
}

/** Teacher-wide (all classes) fee counts/totals for one period (Analytics). */
async function getTeacherFeeCounts(prisma, { teacherId, period }) {
  const [students, records, classes] = await Promise.all([
    prisma.student.findMany({ where: { teacherId, active: true }, select: { id: true, classId: true } }),
    prisma.feeRecord.findMany({ where: { teacherId, period } }),
    prisma.schoolClass.findMany({ where: { teacherId }, select: { id: true, feeAmount: true } }),
  ]);

  const classFeeById = new Map(classes.map((c) => [c.id, c.feeAmount]));
  const recordByStudent = new Map(records.map((r) => [r.studentId, r]));

  let paid = 0;
  let partial = 0;
  let totalCollected = 0;
  let totalExpected = 0;
  for (const s of students) {
    const record = recordByStudent.get(s.id);
    const amount = record?.amount || 0;
    const expectedAmount = record ? record.expectedAmount : classFeeById.get(s.classId) ?? null;
    const status = deriveFeeStatus(amount, expectedAmount);
    if (status === 'paid') paid += 1;
    else if (status === 'partial') partial += 1;
    totalCollected += amount;
    totalExpected += expectedAmount || 0;
  }

  const totalStudents = students.length;
  const pending = totalStudents - paid - partial;
  return { period, totalStudents, paid, partial, pending, totalCollected, totalExpected };
}

module.exports = { deriveFeeStatus, getClassFeeStatus, getTeacherFeeCounts };
