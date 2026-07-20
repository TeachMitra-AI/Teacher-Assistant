// Deterministic-ish test fixtures: two schools (different districts), one
// user per role, and a couple of Query/Feedback rows — enough to exercise
// RBAC and cross-school tenant isolation. Callers pass a unique `prefix`
// (e.g. the test filename) so fixtures from different test files never
// collide on the shared throwaway DB (School.code and User[schoolId,name]
// are both unique).
const bcrypt = require('bcryptjs');

const PIN = '123456';

async function makeSchool(prisma, { code, name, district, state = 'Test State' }) {
  return prisma.school.create({ data: { code, name, district, state } });
}

async function makeUser(prisma, { schoolId, name, role }) {
  const pinHash = await bcrypt.hash(PIN, 10);
  return prisma.user.create({ data: { schoolId, name, role, pinHash } });
}

/**
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} prefix short, unique per test file, e.g. 'rbac' or 'tenant'
 */
async function createFixtures(prisma, prefix) {
  const schoolA = await makeSchool(prisma, {
    code: `${prefix}SCHA`.toUpperCase().slice(0, 20),
    name: `${prefix} School A`,
    district: `${prefix}-district-1`,
  });
  const schoolB = await makeSchool(prisma, {
    code: `${prefix}SCHB`.toUpperCase().slice(0, 20),
    name: `${prefix} School B`,
    district: `${prefix}-district-2`,
  });

  const teacherA = await makeUser(prisma, { schoolId: schoolA.id, name: 'Teacher A', role: 'teacher' });
  const teacherA2 = await makeUser(prisma, { schoolId: schoolA.id, name: 'Teacher A2', role: 'teacher' });
  const schoolAdminA = await makeUser(prisma, { schoolId: schoolA.id, name: 'School Admin A', role: 'school_admin' });
  const resourcePersonA = await makeUser(prisma, { schoolId: schoolA.id, name: 'Resource Person A', role: 'resource_person' });
  const superAdmin = await makeUser(prisma, { schoolId: schoolA.id, name: 'Super Admin', role: 'super_admin' });

  const teacherB = await makeUser(prisma, { schoolId: schoolB.id, name: 'Teacher B', role: 'teacher' });
  const schoolAdminB = await makeUser(prisma, { schoolId: schoolB.id, name: 'School Admin B', role: 'school_admin' });

  const queryA = await prisma.query.create({
    data: {
      userId: teacherA.id,
      schoolId: schoolA.id,
      queryText: `${prefix} query from teacher A`,
      language: 'en',
      context: JSON.stringify({ subject: 'Mathematics' }),
      responseText: 'Sample response A',
    },
  });
  const queryB = await prisma.query.create({
    data: {
      userId: teacherB.id,
      schoolId: schoolB.id,
      queryText: `${prefix} query from teacher B`,
      language: 'en',
      context: JSON.stringify({ subject: 'Science' }),
      responseText: 'Sample response B',
    },
  });

  return {
    PIN,
    schoolA,
    schoolB,
    teacherA,
    teacherA2,
    schoolAdminA,
    resourcePersonA,
    superAdmin,
    teacherB,
    schoolAdminB,
    queryA,
    queryB,
  };
}

module.exports = { createFixtures, PIN };
