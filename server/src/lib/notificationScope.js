// Who a sender may notify, using the same scoping as schoolScope() in routes/admin.js:
//   super_admin      -> all schools
//   resource_person  -> all schools in the same district as their own school
//   school_admin     -> their own school only
//   teacher          -> nobody (requireRole rejects it before the send route)
// A separate copy because routes/admin.js doesn't export it and this feature shouldn't touch that file.
const { prisma } = require('./db');

/**
 * Returns the school ids in scope for `user`, or null meaning every school (super_admin only).
 * @param {{ role: string, schoolId: string }} user
 * @returns {Promise<string[]|null>}
 */
async function schoolScope(user) {
  if (user.role === 'super_admin') return null;
  if (user.role === 'school_admin') return [user.schoolId];
  if (user.role === 'resource_person') {
    const school = await prisma.school.findUnique({ where: { id: user.schoolId } });
    if (!school || !school.district) return [user.schoolId];
    const schools = await prisma.school.findMany({
      where: { district: school.district },
      select: { id: true },
    });
    return schools.map((s) => s.id);
  }
  return [];
}

module.exports = { schoolScope };
